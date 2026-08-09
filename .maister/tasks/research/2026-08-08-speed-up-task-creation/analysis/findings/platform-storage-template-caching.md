# Platform Storage — Client-Side Template Caching Options

## TL;DR
- Three viable in-browser caching mechanisms exist for this VSS SDK v1.104.0 extension: `IExtensionDataService` (network round-trip to Azure DevOps REST storage), `window.localStorage` (synchronous, and *transparently* usable — the SDK auto-shims it to a host-relayed store only when the browser blocks real localStorage), and IndexedDB (native browser API the SDK does **not** manage at all). For a small, structured JSON template cache, plain `window.localStorage` (or the SDK's shim of it) is the simplest and fastest option; `IExtensionDataService` adds real network latency and should only be used if cross-device/cross-session durability beyond one browser is required; IndexedDB is unnecessary complexity for this data size but is the fallback if the localStorage quota (effectively a few MB, shared with the whole shimmed blob) becomes a problem. **Confidence: High** for the mechanisms themselves (confirmed directly in the SDK source, not just typings); **Medium** for real-world latency numbers (no official published SLA found).
- **Critical architectural finding**: the extension has exactly one contribution (`create-linked-tasks-button-test`, type `ms.vss-web.action`, `uri: toolbar.html`), and `toolbar.html`'s script only calls `VSS.init()` / registers its handler — the file itself is only fetched into an iframe when Azure DevOps actually needs to invoke the action (menu click), because a static `ms.vss-web.action` contribution declares its menu text/icon/title directly in the manifest and does not need the iframe loaded just to render the toolbar/context menu. This means there is **no "plugin load" moment before the click** for this contribution type — "preload right after plugin load" as literally stated is not architecturally reachable without adding a new, earlier-loading contribution (e.g. a hub or work-item-form-page contribution) whose only job is to warm the cache. **Confidence: Medium** — inferred from code structure + general contribution-model docs; not found as an explicit statement in Microsoft's docs (see Open Questions).
- Because `window.localStorage` (real or shimmed) is scoped to the extension's own origin/publisher rather than to the short-lived toolbar.html iframe instance, a cache written during one invocation **does** survive the iframe being torn down and reloaded on the next click — so even without a new preload-only contribution, the *second and subsequent* clicks in a browser session can serve templates from cache while the *first* click still pays the fetch cost. This directly informs part (a) of the research question.

## Open Questions / Risks
- No official Microsoft Learn page was found that explicitly states "action-type contribution iframes are not loaded until invoked" — this is inferred from `src/toolbar.html`/`src/vss-extension.json` structure and general knowledge of the contribution model. Recommend the synthesizer flag this as an assumption to sanity-check against the platform-lifecycle gatherer's findings (frame-reuse / `extensionReusedCallback` behavior) before committing to a design.
- Whether the *shimmed* localStorage path (host-relayed, batched every 50ms) or the *real* localStorage path is active for this extension's actual hosting environment (dev.azure.com vs. on-prem Azure DevOps Server, and per-browser third-party-storage-partitioning policy) could not be confirmed without a live org — both paths are transparently exposed as `window.localStorage` by the SDK, so application code doesn't need to branch on it, but the write-loss risk on the shimmed path (writes batched 50ms after `setItem`, lost if the frame is torn down inside that window) is a real edge case worth a short comment in the implementation, not a blocker.
- No published, authoritative quota number for `IExtensionDataService` documents/collections was found (Microsoft Learn's data-storage page describes behavior and the 100,000-document cap on `getDocuments`, but not a byte-size quota per document/collection). Treat any specific MB figure as unconfirmed.
- Whether IndexedDB literally throws inside the sandboxed iframe (vs. just being redundant/unused) was not verified live; reasoned from the same "opaque origin blocks storage APIs" mechanism that motivated the SDK's own localStorage shim — the SDK provides no equivalent shim for IndexedDB, so if the shim path is active for localStorage, IndexedDB is very likely equally broken in that same environment. **Confidence: Medium** (mechanistic inference, not directly observed).

---

## 1. `IExtensionDataService`

**Source**: `src/node_modules/vss-web-extension-sdk/typings/vss.d.ts:711-784` (interface), `:2760` (`VSS.ServiceIds.ExtensionData = "ms.vss-web.data-service"`, confirmed at runtime in `src/node_modules/vss-web-extension-sdk/lib/VSS.SDK.js:828`), implementation class `ExtensionDataService` at `vss.d.ts:25934-25941` (module `"VSS/SDK/Services/ExtensionData"`).

### Methods (evidence: `vss.d.ts:711-784`)
```ts
interface IExtensionDataService {
    getValue<T>(key: string, documentOptions?: IDocumentOptions): IPromise<T>;
    setValue<T>(key: string, value: T, documentOptions?: IDocumentOptions): IPromise<T>;
    getDocument(collectionName: string, id: string, documentOptions?: IDocumentOptions): IPromise<any>;
    getDocuments(collectionName: string, documentOptions?: IDocumentOptions): IPromise<any[]>;
    createDocument(collectionName: string, doc: any, documentOptions?: IDocumentOptions): IPromise<any>;
    setDocument(collectionName: string, doc: any, documentOptions?: IDocumentOptions): IPromise<any>;
    updateDocument(collectionName: string, doc: any, documentOptions?: IDocumentOptions): IPromise<void>;
    deleteDocument(collectionName: string, id: string, documentOptions?: IDocumentOptions): IPromise<void>;
}
```
`IDocumentOptions` (`vss.d.ts:789-805`): `scopeType: string` ("Default" = project-collection-wide, or "User"), `scopeValue?: string` ("Current"/"Me"), `defaultValue?: any` (fallback for `getValue`). Comment on `getValue`/`setValue` (`vss.d.ts:717,726`): "default value is account-wide" — i.e. shared across all users of the installing collection unless `scopeType: "User"` is passed.

### How it's obtained in this SDK generation
`vss.d.ts:2760` / `VSS.SDK.js:828` confirm the service id is registered as `VSS.ServiceIds.ExtensionData`, retrieved via `VSS.getService<IExtensionDataService>(VSS.ServiceIds.ExtensionData)` (the generic `VSS.getService` declared at `vss.d.ts:2818`). **Caveat**: Microsoft's current published code sample (see External Sources below) shows the *newer* `azure-devops-extension-sdk` API shape — `SDK.getService(...).getExtensionDataManager(extensionId, accessToken)` — which does not exist in this project's bundled `vss-web-extension-sdk@1.104.0` typings (no `getExtensionDataManager` symbol found anywhere in `vss.d.ts`). For this project, the correct call is the classic `VSS.getService(VSS.ServiceIds.ExtensionData).then(dataService => dataService.getValue(...))` pattern, which the same doc page also shows as an older-style example. **Confidence: High** (directly cross-checked against the bundled typings, not assumed).

### Backing mechanism — REST calls, not local storage
`vss.d.ts:25937-25939`: the implementing class's doc comment states plainly: *"Provides a wrapper around the REST client for getting and saving extension setting values"*. Microsoft Learn confirms the exact endpoint shape (fetched 2026-08-08):
> `getValue()`/`setValue()` internally call `setDocument`/`getDocument` against the special collection name `$settings`, issuing requests like `GET _apis/ExtensionManagement/InstalledExtensions/{publisherName}/{extensionName}/Data/Scopes/User/Me/Collections/%24settings/Documents/myKey`.

This means **every** `getValue`/`getDocument` call is a live HTTPS round-trip to the Azure DevOps organization's REST API — there is no local caching layer built into the service itself. Using it as a template cache would still incur network latency on every read, just potentially less latency/complexity than re-deriving the template list from the Work Item Tracking REST APIs (`witClient.getTemplates`/`getTemplate`, see `src/scripts/app.ts:495-538`) if the extension-data blob is smaller or requires fewer round-trips. **Confidence: High** (primary-source typings comment + official docs agree).

### Quota / limits (confirmed)
- `getDocuments` (get-all-in-collection) is capped at **100,000 documents** per Microsoft Learn's data-storage page (quote, fetched 2026-08-08): *"This call retrieves all documents in a scoped collection, with a limit of 100,000 documents."*
- Document `id` (when using `createDocument`) is capped at **50 characters**.
- Concurrency uses an `__etag` field; `-1` means "don't care about version" (last-write-wins) — this is exactly the model `setValue`/`getValue` use internally.
- **No specific per-document or per-collection byte-size quota was found** in the fetched docs or via targeted search — treat as unconfirmed (see Open Questions). **Confidence: Low** on the byte-quota question specifically.

### Latency
No official published number. Given it is a REST call to the Azure DevOps organization's API (same network path as the extension's other REST calls, e.g. `witClient.getTemplate`), expect similar latency to the existing template-fetch calls the extension already makes in `src/scripts/app.ts:495-538` (i.e., no inherent latency *advantage* over just re-fetching templates from the Work Item Tracking REST API directly — its value is avoiding the multi-step `GetChildTypes` → `getTemplates` → per-template `getTemplate` chain, not avoiding network calls altogether). **Confidence: Medium** (reasoned from mechanism, not measured).

### Manifest scope requirement
`src/vss-extension.json:44-47` currently declares only `vso.work` and `vso.work_write` scopes. The Extension Data service typically requires no additional Azure Boards scope (it's a separate ExtensionManagement API surface tied to the extension's own installation, not to work-item data) — however, **this was not independently verified against a live install**; if adopted, confirm no manifest scope addition is silently required (would need a re-consent/re-install prompt for existing installs, a distribution-relevant concern). **Confidence: Low/unverified** — flag for solution design.

---

## 2. `ISandboxedStorage` / the SDK's `localStorage` shim

**Source (typings)**: `src/node_modules/vss-web-extension-sdk/typings/vss.d.ts:342-351` (interface), `:378-381` (embedded in `IHostHandshakeData`).
**Source (actual runtime mechanism — not visible in typings alone)**: `src/node_modules/vss-web-extension-sdk/lib/VSS.SDK.js:757-798` and `:835-897`.

### What the typings say
```ts
/**
* Storage that can be leveraged by sandboxed extension content. The host frame will
* store this data in localStorage for the extension's publisher id.
*/
interface ISandboxedStorage {
    /**
    * Used by the VSS.SDK to shim localStorage for sandboxed content - for a given publisher.
    */
    localStorage?: IDictionaryStringTo<string>;
}
```
This only appears as a field on `IHostHandshakeData.sandboxedStorage` (`vss.d.ts:381`) — data pushed from host to extension frame *once*, during the initial handshake. **There is no public `VSS.*` API to read/write it directly** in the typings; it is entirely internal plumbing.

### What actually happens (from `VSS.SDK.js`, not documented on Microsoft Learn)
This is the load-bearing finding, and it directly answers "how does this differ from calling `window.localStorage` directly":

1. On script load, `shimSandboxedProperties()` (`VSS.SDK.js:757`) probes `!!window.localStorage` in a try/catch (`:785-790`).
2. **If real `window.localStorage` throws or is unavailable** (the classic symptom of a sandboxed iframe with an opaque/`null` origin, i.e. missing `allow-same-origin` on the iframe's `sandbox` attribute) — the SDK **deletes** `window.localStorage` and replaces it via `Object.defineProperty` with an in-memory `Storage`-interface-compatible shim object (`:791-794`, class defined `:686-756`: implements `getItem`/`setItem`/`removeItem`/`clear`/`key`/`length` exactly like the real Storage interface).
3. **If real `window.localStorage` *is* available** (extension iframe served from a genuine distinct origin with normal storage access), the shim is skipped entirely and `window.localStorage` is just the browser's native implementation, scoped to the extension's own hosting origin.
4. Either way, application code calls `window.localStorage.getItem/setItem(...)` exactly the same — **the SDK makes this transparent**; app code never needs to branch on which path is active.
5. When the shim *is* active, every `setItem`/`removeItem`/`clear` call schedules (`VSS.SDK.js:759-767`) a **50ms-debounced** message (`updateHostSandboxedStorage`, `:893-897`) to the host frame via the XDM channel (`parentChannel.invokeRemoteMethod("updateSandboxedStorage", "VSS.HostControl", ...)`), which the host frame persists into **its own** `localStorage`, keyed by the extension's **publisher id** (per the interface doc comment) — i.e. on the Azure DevOps page's own origin (e.g. `dev.azure.com`), not the extension iframe's origin. On the *next* handshake (extension frame reload — e.g. re-clicking the toolbar action), the host sends this persisted blob back down (`:852-882`) and the shim merges it with anything the frame wrote before the handshake resolved.

### Consequences for this project's caching design
- **Persistence across the toolbar iframe's teardown/reload is real and by-design** in the shimmed path (host frame owns the durable copy), and trivially real in the native path (browser owns it, scoped to the extension's own origin — same guarantee any normal web page gets). Either way, a template cache written on click #1 is available on click #2, even after the popup/panel that hosted `toolbar.html` is closed. **Confidence: High** (verified in SDK source, not just typings).
- **Whole-blob write model**: the shimmed path serializes the *entire* shimmed storage object as one JSON string per sync (`VSS.SDK.js:895`: `JSON.stringify(shimmedLocalStorage || {})`) — there's no per-key partial write to the host. For a small template cache (a handful of KB of JSON) this is inconsequential; it would matter if the extension also stored large unrelated blobs in `localStorage`.
- **Write-loss race** (Open Question, flagged above): the 50ms debounce means a `setItem` immediately followed by iframe teardown (e.g. rapid popup close) could be lost in the shimmed path before the postMessage fires. Low risk for a template cache that's populated once per session and read many times, but worth a one-line comment in the implementation.
- **Namespacing**: because storage is keyed per **publisher**, not per **extension**, and is a flat key-value store, cache keys should be prefixed (e.g. `linked-tasks-automation:templates:v1`) defensively even though this publisher currently ships only this one extension.
- **Quota**: whichever path is active, the effective ceiling is the *host page's* (or browser's) native `localStorage` quota — typically ~5–10MB per origin in modern browsers (industry-standard figure, not Azure-DevOps-specific; no ADO-specific quota override was found). Comfortably enough for cached JSON templates.

### External corroboration (mixed reliability — see Open Questions)
Search results referencing "the sandbox properties of the iframe that embeds the extension does not include the `allow-same-origin` property" surfaced from community/support threads (one on a Fabric/Power BI community forum, which is a *different* Microsoft product's extensibility surface, so may not transfer directly) rather than an Azure-DevOps-specific Microsoft Learn page. The SDK's own defensive shim code (point 2 above) is stronger, primary-source evidence that *some* deployment/browser combinations for Azure DevOps extensions do hit this exact "sandboxed, opaque origin" condition — which is precisely why Microsoft built the shim in the first place. Treat "always sandboxed" as unconfirmed, but "the shim exists because it sometimes is" as solid.
**Confidence: High** on the shim's existence and mechanism; **Medium** on how often/where the shim path (vs. native path) is actually triggered in this extension's real deployment targets (dev.azure.com, modern Chrome/Edge).

---

## 3. IndexedDB

**Source**: exhaustive search of `src/node_modules/vss-web-extension-sdk/typings/vss.d.ts` and `src/node_modules/vss-web-extension-sdk/lib/VSS.SDK.js` for `indexedDB`/`IndexedDB` — **zero matches in either file**.

### Finding
The VSS SDK does **not** mention, shim, expose, or manage IndexedDB anywhere — neither in the public typings nor in the runtime shim logic that handles `localStorage`/`document.cookie`. This is a meaningful absence, not just "undocumented":

- The SDK's `shimSandboxedProperties()` function (`VSS.SDK.js:757-798`) exists *specifically* to work around the case where storage APIs throw inside a sandboxed/opaque-origin iframe. It handles `document.cookie` (`:768-783`) and `window.localStorage`/`sessionStorage` (`:784-797`) but has no equivalent branch for `window.indexedDB`.
- Since IndexedDB is subject to the exact same same-origin/sandboxed-iframe access rules as `localStorage` (both are Storage-partitioned, origin-scoped browser APIs — a sandboxed iframe without `allow-same-origin` gets a unique/opaque origin for *all* of these, not just localStorage), if the extension iframe is ever in the "opaque origin" condition that triggers the localStorage shim, `window.indexedDB` would be equally unusable (would throw, e.g. `SecurityError`, or simply return `undefined`) — but with **no fallback or shim provided**. App code calling `indexedDB.open(...)` directly could hard-fail in exactly the deployment scenarios where the localStorage shim is quietly saving the day.
- **Confidence: Medium** — this is a mechanistic inference from the presence/absence pattern in the SDK source, not a directly observed failure. No Azure-DevOps-specific documentation confirming or denying IndexedDB usability inside extension iframes was found via web search (search results were generic MDN/WHATWG sandboxing references, not ADO-specific).

### Practical implication
Given (a) the SDK provides zero support/shimming for IndexedDB and (b) the data being cached here (a handful of JSON work-item templates) is trivially small, **IndexedDB offers no benefit over `window.localStorage` for this use case** and adds real risk (silent failure in whichever environments actually hit the sandboxed/opaque-origin condition). Not recommended unless a future requirement needs storage far beyond `localStorage`'s ~5-10MB ceiling.

### Manifest / CSP
`src/vss-extension.json` (full file read) declares no `contentSecurityPolicy`-style property and no restricted-content scopes — CSP for the extension iframe is entirely host-controlled (Azure DevOps decides the `sandbox` attribute and CSP headers on the iframe it creates for `uri: toolbar.html`), not something this project's manifest can influence either way. **Confidence: High** (directly read the full manifest, `src/vss-extension.json:1-85`).

---

## 4. Preload-after-init pattern — is it architecturally possible for this contribution type?

**Source**: `src/toolbar.html:1-42` (full file), `src/vss-extension.json:66-84` (the single contribution block).

### Current wiring
```html
<script>
VSS.init();
var createChildTask = (function() { ... return { createTasks, execute } }());
VSS.register("create-linked-tasks-button-test", function (context) { return createChildTask; });
</script>
```
— `toolbar.html` calls `VSS.init()` unconditionally at parse time, then registers an object whose `execute(actionContext)` method (only invoked by the host later) is what triggers `AddTasks()`/template fetching in `src/scripts/app.ts`.

The manifest (`src/vss-extension.json:67-83`) declares:
```json
{
  "id": "create-linked-tasks-button-test",
  "type": "ms.vss-web.action",
  "targets": ["ms.vss-work-web.work-item-toolbar-menu", "ms.vss-work-web.work-item-context-menu"],
  "properties": { "text": "...", "title": "...", "icon": "...", "uri": "toolbar.html", "registeredObjectId": "create-linked-tasks-button-test" }
}
```
Critically, `text`, `title`, `toolbarText`, and `icon` are **static properties in the manifest itself** — the host can render the toolbar button/context-menu entry without ever needing to ask the iframe anything (contrast with an `action-provider` contribution type, which implements `IContributedMenuSource.getMenuItems()` and *would* require the iframe to be loaded to even populate the menu — this extension does not use that pattern).

### What this means
Because the menu item's label/icon are fully static, there is no product requirement for Azure DevOps to instantiate the `toolbar.html` iframe before the user actually invokes the action. This matches the well-established Azure DevOps contribution model (`ms.vss-web.action` vs. `ms.vss-web.hub`, see Microsoft Learn "Contribution model" page, fetched 2026-08-08) where only contributions that must render *content* (hubs, panels) or *dynamic* menu content (`action-provider`) are known to require eager/on-demand-at-parent-render iframe loading — a plain static `action` contribution's iframe purpose is solely to host the JS that runs `execute()` when clicked.

**Therefore**: "preload templates asynchronously right after the extension/plugin loads" cannot mean "immediately when Azure DevOps loads the work-item page," because **nothing of this extension loads at that point** — there is no code running, no `VSS.init()` call, nothing, until the user opens the toolbar/context menu and clicks the action. The earliest possible hook for this contribution, as currently structured, is the moment `toolbar.html`'s `VSS.init()` resolves — which is *already* effectively simultaneous with the click (the iframe is created because of the click). **Confidence: Medium** (strong code-level and manifest-level evidence combined with general contribution-model knowledge; no single Microsoft doc states this explicitly for `ms.vss-web.action` — flagged in Open Questions).

### Two real options this implies for sub-question (a)
1. **Accept the "first click always pays" cost, cache for subsequent clicks.** Since `window.localStorage`/`ISandboxedStorage` persists at the origin/host level (see section 2) independent of the `toolbar.html` iframe's lifetime, the very first invocation in a browser session fetches and caches templates; every subsequent invocation (even after the popup panel is closed and reopened) reads from cache instantly, only invalidating/refetching in the background. This requires **no new contribution**, just a code change inside `create()`/`AddTasks()` in `src/scripts/app.ts` to check-cache-first-then-fetch-and-store.
2. **Add a genuinely earlier-loading contribution** (e.g. `ms.vss-work-web.work-item-form-page` or a hidden hub) whose sole job is to run on work-item-form open and warm the same origin-scoped cache before the user ever opens the toolbar menu. This buys a true "preload before click" experience even on the very first interaction, at the cost of a new contribution + manifest scope entry (and, per `standards/build-tooling/packaging.md`, following this project's kebab-case contribution-id and addressable-file conventions). This should be evaluated by the synthesizer against user-perceived value (is "first click after opening a work item" common enough to be worth the extra contribution surface?).

---

## 5. Trade-off comparison table

| Dimension | `IExtensionDataService` | `localStorage` (native or SDK-shimmed, transparent) | IndexedDB | In-memory module cache |
|---|---|---|---|---|
| **Latency (read)** | Network round-trip to Azure DevOps REST API (same class of latency as existing `witClient.getTemplate(s)` calls in `app.ts:495-538`) — no inherent speed advantage over re-fetching templates directly. Confidence: Medium (reasoned, not measured) | Synchronous, in-process (real path) or one in-memory shim call resolved same-tick (shimmed path) — effectively zero latency once populated. Confidence: High | Native async API, low-single-digit ms typical for small payloads — but unmanaged by the SDK; risk of failure in sandboxed/opaque-origin scenarios (Section 3). Confidence: Medium | Zero latency if the frame is still alive; **but see persistence caveat below** | 
| **Quota** | 100,000 documents/collection (confirmed); per-document/collection byte size not documented (unconfirmed) | Effectively browser's `localStorage` ceiling (~5-10MB/origin, industry-standard, not ADO-specific) — ample for JSON templates | Effectively browser IndexedDB ceiling (much larger, often hundreds of MB+) — irrelevant here given tiny data size | Bounded only by process memory — irrelevant here |
| **Persists across `toolbar.html` iframe teardown (popup close)?** | Yes — server-side, durable, cross-device/cross-browser | Yes — origin-/publisher-scoped, survives iframe reload within the same browser (Section 2) | Yes in principle, if usable at all in this iframe context (unconfirmed) | **No** — a plain module-level JS variable dies with the iframe; only useful if the toolbar iframe itself is reused across invocations without reload (see platform-lifecycle gatherer's frame-reuse findings — open question, not resolved here) |
| **Staleness-invalidation complexity** | Same as any cache: need a version/etag or TTL strategy; `__etag` field is built in and could double as a cheap "did anything change" signal without a full re-fetch (`vss.d.ts:774` `updateDocument`) | Manual: simple TTL or explicit "invalidate on template-admin-known-events" logic needed; no built-in versioning beyond what you add to the stored JSON yourself | Same manual burden as localStorage, plus IndexedDB's own async transaction model adds code complexity for what is a simple flat cache | N/A — cache dies with the frame, so staleness is bounded to a single toolbar-menu session (arguably the *simplest* invalidation story, at the cost of no cross-click benefit) |
| **Implementation complexity (given current `Q`-promise, AMD, TS codebase)** | Low-medium: promise-based API matches existing `Q` chain style in `app.ts`; requires learning/testing a service not currently used by the extension at all (net-new dependency) | Low: `window.localStorage` is a synchronous Web API, trivially wrapped in a small helper; the SDK's transparency (Section 2) means zero extra code is needed to "activate" the shim | Medium: async, transactional API is a bigger surface change for a codebase that has no precedent for it, for no data-size benefit here | Lowest to write, but likely **does not solve the stated problem** (surviving popup close) unless frame reuse is confirmed — see below |

**Open cross-reference**: the "in-memory module-level cache" row's viability hinges entirely on whether the `toolbar.html` iframe is *reused* (same JS execution context, module state intact) across repeated invocations of the same action, versus torn down and recreated fresh each time. `IExtensionInitializationOptions.extensionReusedCallback` (`vss.d.ts:339`, `:395`) exists specifically to notify the extension when its frame *is* reused by a new contribution invocation — its mere existence suggests frame reuse is a real, SDK-acknowledged possibility, but confirming whether it applies to this specific `ms.vss-web.action` + toolbar/context-menu targeting (as opposed to e.g. hub navigation) is squarely the platform-lifecycle gatherer's territory. **This gatherer does not resolve that question** — noted here only so the synthesizer can merge the two findings sets: if frame reuse *is* confirmed for this contribution type, an in-memory cache becomes a valid zero-complexity option layered on top of (not instead of) the `localStorage` persistence layer (read-through: memory first, `localStorage` second, network last).

---

## Sources

### Local code/typings (this repository)
- `src/node_modules/vss-web-extension-sdk/typings/vss.d.ts:342-351` — `ISandboxedStorage` interface
- `src/node_modules/vss-web-extension-sdk/typings/vss.d.ts:356-382` — `IHostHandshakeData` (embeds `sandboxedStorage`)
- `src/node_modules/vss-web-extension-sdk/typings/vss.d.ts:711-784` — `IExtensionDataService` interface
- `src/node_modules/vss-web-extension-sdk/typings/vss.d.ts:789-805` — `IDocumentOptions`
- `src/node_modules/vss-web-extension-sdk/typings/vss.d.ts:2739-2761` — `VSS.ServiceIds` module (`ExtensionData` id)
- `src/node_modules/vss-web-extension-sdk/typings/vss.d.ts:25934-26010` (approx.) — `ExtensionDataService` implementation class doc comments
- `src/node_modules/vss-web-extension-sdk/lib/VSS.SDK.js:686-798` — `Storage` shim class + `shimSandboxedProperties()`
- `src/node_modules/vss-web-extension-sdk/lib/VSS.SDK.js:812-829` — `VSS.ServiceIds` runtime values
- `src/node_modules/vss-web-extension-sdk/lib/VSS.SDK.js:835-897` — `VSS.init()` handshake, sandboxed-storage merge/sync logic
- `src/toolbar.html:1-42` — current contribution entry point (full file)
- `src/vss-extension.json:1-85` — full manifest (contribution, scopes, files)
- `src/scripts/app.ts:495-538` — existing template-fetch calls (`getTemplates`/`getTemplate`) this caching layer would sit in front of

### External (Microsoft Learn, fetched 2026-08-08)
- Data and Setting Storage — Azure DevOps: https://learn.microsoft.com/en-us/azure/devops/extend/develop/data-storage?view=azure-devops (methods, scoping, 100,000-document limit, 50-char id limit, `__etag` model, REST endpoint shapes; code sample shown mixes old/new SDK generations)
- Contribution model — Azure DevOps: https://learn.microsoft.com/en-us/azure/devops/extend/develop/contributions-overview?view=azure-devops (contribution type mechanics; did not directly confirm iframe-load-timing for `ms.vss-web.action`)
- Extensibility points overview: https://learn.microsoft.com/en-us/azure/devops/extend/reference/targets/overview?view=azure-devops (referenced during search, not deeply fetched — candidate for follow-up if lifecycle timing needs stronger confirmation)

### External (community/secondary — lower reliability, see Open Questions)
- GitHub issue, `microsoft/azure-devops-extension-sdk` #25 — "Getting 404 error from SetValue of IExtensionDataManager" (surfaced in search, not deeply read; potential corroboration of REST-backed, failure-prone-if-misused nature of the data service)
- GitHub issue, `microsoft/azure-devops-extension-api` #140 — "Extension Data Storage IExtensionDataService does not work correctly when following docs" (surfaced in search, not deeply read; flags real-world friction with this API worth a follow-up read if `IExtensionDataService` is chosen)
- Community thread referencing Azure DevOps extension iframe `sandbox` attribute lacking `allow-same-origin` (surfaced via search; one matching source was on a Power BI/Fabric community forum, a different product — treat with caution per Open Questions)
