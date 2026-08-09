# Platform Lifecycle Findings: VSS SDK Async Model, Frame Handshake, and Popup/Dialog Teardown

## TL;DR
The VSS SDK (`vss-web-extension-sdk@1.104.0`) frame model is: the host page creates an extension's iframe on demand via `VSS.Contributions.Controls.createExtensionHost($container, contribution, ...)`, inserting it into a **caller-supplied DOM container** (`vss.d.ts:7658`). For a `ms.vss-web.action` menu item (this extension's contribution type), that container lives wherever the menu/toolbar UI that triggered it lives. Official Microsoft docs confirm work items can be shown either as a full page or **inside a dialog** ("peek panel"), and explicitly state that once that dialog closes, contributions scoped to the work item form get unloaded — only a separate `ms.vss-work-web.work-item-notifications` **observer** contribution "lives outside the form and isn't destroyed when the form dialog closes" (Microsoft Learn, `add-workitem-extension.md`, "Listen for events" section — High confidence, direct quote). This is the most concrete documented match to the reported bug: this extension's `create-linked-tasks-button-test` contribution targets `ms.vss-work-web.work-item-toolbar-menu`/`work-item-context-menu` (form-scoped, not the observer type), so when the parent work item is opened in a dialog/peek panel and that panel is closed, the extension's iframe — and any REST calls it has in flight — is torn down. Standard browser behavior aborts in-flight `fetch`/`XHR` when the owning document/iframe is removed from the DOM (Medium-High confidence, general web-platform behavior, not Azure-DevOps-specific). `IHostNavigationService.reload()` is explicitly documented as reloading "the parent frame" (`vss.d.ts:679-684`), which is the only lifecycle event that would definitely also kill a persistent/hub-level frame — consistent with the reported "stops on popup close, but a full page refresh is the real reset."

## Open Questions / Risks
- No Azure DevOps org was available to reproduce live (consistent with the constraint already noted in `roadmap.md`). All frame-teardown claims are corroborated by direct Microsoft Learn documentation quotes plus first-principles reasoning from the local typings and general browser iframe-removal semantics — not confirmed by a live repro, so root-cause confidence is **Medium-High**, not Verified.
- Direct primary-source confirmation ("closing the work item peek dialog unloads the toolbar-menu action's iframe specifically") was not found for `ms.vss-web.action`/`work-item-toolbar-menu` by name — the strongest direct quote covers the sibling `work-item-notifications` observer contribution's contrast ("lives outside the form... isn't destroyed"), which implies by direct contrast that in-form contributions (including toolbar/context-menu actions) ARE destroyed. This is a documented contrast, not a documented statement about the toolbar-menu type itself — flagged Medium confidence for that specific inferential step.
- Developer Community bug reports found by title (iframe reloads on work item save/update) look topically related but their content could not be fetched (client-rendered SPA pages returned only nav chrome to `WebFetch`) — cited by title/URL only, not content, and given Low confidence / not usable as corroborating evidence.
- Whether the *specific* container DOM node for a `ms.vss-work-web.work-item-toolbar-menu` action is a child of the dialog's own iframe/DOM subtree (and thus removed when the dialog is dismissed) vs. some other persistent host region is an inference from `createExtensionHost`'s `$container` parameter (`vss.d.ts:7658`) plus the documented dialog-unload behavior for form-scoped contributions — not a line-by-line confirmed fact about this exact target. Medium confidence.

---

## 1. VSS SDK async/lifecycle model (local typings, `src/node_modules/vss-web-extension-sdk/typings/vss.d.ts`)

**Confidence: High** (all direct file:line citations, SDK v1.104.0 typings actually shipped by this extension).

### `IExtensionInitializationOptions` — `vss.d.ts:305-340`
```
305 interface IExtensionInitializationOptions {
312     explicitNotifyLoaded?: boolean;
321     usePlatformScripts?: boolean;
327     usePlatformStyles?: boolean;
333     moduleLoaderConfig?: ModuleLoaderConfiguration;
339     extensionReusedCallback?: (contribution: Contribution) => void;
340 }
```
- `explicitNotifyLoaded` (line 312): "Set to true if the extension will explicitly call notifyLoadSucceeded or notifyLoadFailed itself... If false (**the default**) the extension is considered ready as soon as init is called." `toolbar.html` calls bare `VSS.init()` with no options object, so this defaults to `false` — the host's loading indicator stops as soon as `VSS.init()` runs, independent of whether the extension's own async work (template fetch, task creation) has completed. This is neutral to the popup-close bug but relevant to sub-question (b): the host's own built-in loading indicator cannot be repurposed as a "creation in progress" indicator without opting into `explicitNotifyLoaded: true` and deliberately delaying `notifyLoadSucceeded()` — which is a poor fit anyway since notify-loaded gates the *initial* frame-ready state, not repeated per-click operations.
- `usePlatformScripts` (line 321): pulls in the host's script loader/config so `VSS.require` can load VSS modules (Controls, REST clients, etc.). Implicitly turned on by any `VSS.require` call — already true for this extension since `toolbar.html` uses `VSS.require` to load `scripts/app`.
- `extensionReusedCallback` (line 339): "Optional callback method that gets invoked when this extension frame is reused by another contribution which shares the same URI of the contribution that originally caused this extension frame to be loaded." This is the one documented mechanism in the local typings for an extension frame surviving/being reused across separate activations — but note the condition: reuse only happens for a **contribution that shares the same URI**, and only when the host actually decides to reuse a frame rather than create a new one via `createExtensionHost`. The typings do not state the trigger/scope Under which the host chooses reuse vs. fresh-create (see Section 2 for what could be pieced together from `VSS/Contributions/Controls`).

### `IHostHandshakeData` / `IExtensionHandshakeData` — `vss.d.ts:356-404`
- `IHostHandshakeData` (356): host→extension handshake payload — `pageContext`, `initialConfig`, `extensionContext`, `contribution` (the contribution that caused the frame to load), `sandboxedStorage`.
- `IExtensionHandshakeData` (387): extension→host handshake payload — `notifyLoadSucceeded: boolean` (392), `extensionReusedCallback` (398, mirrors line 339), `vssSDKVersion` (403).
- This confirms the frame is instantiated **per triggering contribution invocation** via a handshake, not a long-lived worker/service-style context; there is no documented "detached background execution context" independent of a hosted DOM frame in this SDK generation.

### `IXDMObjectRegistry` — `vss.d.ts:283-300`
Cross-document-messaging object registry underlying `VSS.register`/`VSS.getService` — confirms all host↔extension communication is proxied over a `postMessage`-based channel (`IXDMChannel`, `addChannel(window, targetOrigin)` at line 277) between two real `Window`/iframe objects. If either side's window/iframe is torn down, the channel and any pending proxied calls necessarily break — this is the mechanistic basis for the popup-close hypothesis (Section 3).

### `VSS.init` / core module functions — `vss.d.ts:2767-2860` (module `"VSS/SDK"`, re-exported as global `VSS`)
```
2767 function init(options: IExtensionInitializationOptions): void;
2782 function require(modules: string[] | string, callback?: Function): void;
2787 function ready(callback: () => void): void;
2791 function notifyLoadSucceeded(): void;
2795 function notifyLoadFailed(e: any): void;
2837 function register(instanceId: string, instance: Object | {...}): void;
```
Confirms the extension-side API surface actually used by `toolbar.html`/`app.ts` (`VSS.init()`, `VSS.require`, `VSS.register`) is the complete lifecycle surface available — there is no separate "background task" or "keep-alive" API in this module.

### `IHostNavigationService` — `vss.d.ts:679-689`
```
679 interface IHostNavigationService {
684     * Reloads the parent frame
685     reload();
```
"Reloads the **parent frame**" — i.e., the top-level Azure DevOps page, not just the extension's own iframe. This is the SDK-documented mechanism matching the user's own framing of "stops only on a full page refresh": a full parent-frame reload is a categorically bigger, more destructive event than a dialog/panel close, because it tears down *every* iframe on the page (including any hub-level or persistent one), not just a dialog-scoped one. **High confidence** — direct quote, unambiguous.

### `IHostDialogService` — `vss.d.ts:636-674`
`openDialog()`/`openMessageDialog()` open **modal** dialogs in the host frame (`IHostDialogOptions.modal`, line 524). Explicitly modal — not a fit for a "non-blocking" progress surface (relevant to ruling this API out for sub-question (b), even though the primary progress-UI investigation is out of this gatherer's scope). No lifecycle statement here about surviving dialog close.

### Contribution hosting mechanics — `vss.d.ts:7562-7659` (module `"VSS/Contributions/Controls"`)
```
7568 export interface IExtensionHost {
7576     getRegisteredInstance<T>(instanceId: string, contextData?: any): IPromise<T>;
7580     getLoadPromise(): IPromise<any>;
7581 }
...
7600 export interface IContributionHostBehavior {
7604     showLoadingIndicator?: boolean;
...
7658 export function createExtensionHost($container: JQuery, contribution: ..., initialConfig?: any, webContext?: ..., postContent?: any, uriReplacementProperties?: any, uriPropertyName?: string, iframeFirstPartyContent?: boolean, contributionHostBehavior?: IContributionHostBehavior): IPromise<IExtensionHost>;
```
This is the concrete mechanism by which any contribution's iframe (including a `ms.vss-web.action` handler like this extension's `toolbar.html`) gets created: the **caller** (host page code responsible for rendering the toolbar/context-menu/dialog) picks a `$container` jQuery element and calls `createExtensionHost`. The extension's iframe is a **child of whatever container the host UI code chose** — there is no separate, container-independent "run this extension detached from any UI surface" API in this typings file. **Medium-High confidence** inference: for a menu action fired from a work item opened in a dialog, the natural/only documented place to put that container is inside the dialog's own DOM subtree (the dialog is the UI surface that owns the toolbar/context menu that triggered the action), which is removed from the document when the dialog is dismissed.

---

## 2. Popup/panel close root cause — external corroboration

**This is the critical finding for sub-question (c).**

### Direct, high-confidence documentation match
Microsoft Learn — "Extend the work item form" (`https://learn.microsoft.com/en-us/azure/devops/extend/develop/add-workitem-extension?view=azure-devops`, fetched 2026-08-08, `ms.date: 2026-04-03`, applies to `azure-devops`/`azure-devops-2022`/`azure-devops-server`):

> "Observers listen to work item events without any UI on the form. Use observers to listen for the `onSaved` event, **since observers live outside the form and aren't destroyed when the form dialog closes.**"

And, in the `onSaved` event row (repeated for both the form-group and observer contribution types):

> "Fired after a work item is saved. **For work items in a dialog, you should target the `ms.vss-work-web.work-item-notifications` type to ensure the event fires since once the dialog closes, this contribution type gets unloaded.**"

**Confidence: High** for the literal claims quoted (they are direct quotes from the current, dated Microsoft Learn page). **Medium** for applying them specifically to `ms.vss-web.action` targeting `ms.vss-work-web.work-item-toolbar-menu`/`work-item-context-menu` (this extension's actual contribution type/targets) rather than to the `ms.vss-work-web.work-item-form-group`/`-page` types the quotes were written in the context of — the quotes establish a clear **category distinction** (contributions hosted inside the work item form's own UI vs. the standalone `work-item-notifications` observer type that explicitly "lives outside the form"), and this extension's toolbar/context-menu action is a form-scoped, non-observer contribution, so it falls on the "destroyed when the dialog closes" side of that documented line. This is the closest primary-source statement available; it is not a verbatim statement about the toolbar-menu action type by name.

Root-cause chain, assembled from the above plus Section 1:
1. `create-linked-tasks-button-test` is `type: "ms.vss-web.action"` targeting `ms.vss-work-web.work-item-toolbar-menu` and `ms.vss-work-web.work-item-context-menu` (per `sources.md`, confirmed against `vss-extension.json`) — both are work-item-form-scoped menu surfaces, not the `work-item-notifications` observer type.
2. When the parent work item is opened in a dialog/peek panel (Microsoft's own term, "form dialog"), form-scoped contributions are documented as unloaded once that dialog closes.
3. The extension's iframe is created via `createExtensionHost($container, ...)` (`vss.d.ts:7658`) into a container that belongs to the triggering UI (the dialog's toolbar/menu) — so "unloaded" concretely means the iframe (and its `window`) is removed from the DOM.
4. Removing an iframe from the DOM aborts any in-flight `fetch`/`XMLHttpRequest` originating from that iframe's `window` — this is standard, engine-level browser behavior, not Azure-DevOps-specific: per the WHATWG Fetch/HTML navigation-and-unload algorithms, when a browsing context (iframe) is discarded, its fetch group is terminated with a fatal reason, aborting in-flight requests; Chromium's "abortable fetch" documentation and multiple browser-engine bug trackers (Mozilla Bugzilla #1165237 "fetch() not aborted upon document unload", #1084399) confirm this is the expected/normalized behavior across engines, with some historical edge-case bugs about *not* aborting when it should have. **Confidence: Medium-High** — well-established general web-platform behavior, cross-checked against multiple independent sources, but not an Azure-DevOps-specific citation.
5. This precisely matches the reported symptom: creation of subsequent child tasks/links (each a separate REST call in the sequential `Q` chain per `app.ts`) stops mid-flight when the popup/dialog is closed, because the iframe issuing those calls is torn down — while a full top-level page refresh (`IHostNavigationService.reload()`, "reloads the parent frame") is a distinct, strictly larger teardown event that the user correctly identifies as the "real" reset point, since it would tear down even a hypothetically more persistent hosting surface.

### `ms.vss-web.action` HTML page — confirms "background iframe" framing
Microsoft Learn — "Add a menu action" (`https://learn.microsoft.com/en-us/azure/devops/extend/develop/add-action?view=azure-devops`, fetched 2026-08-08):
> "The end user doesn't see the content on this page. **It runs in the background** to handle the contributed menu item being selected."

This confirms the action's HTML page (this extension's `toolbar.html`) is explicitly documented as a hidden/background iframe purpose-built to run the `execute()` handler — consistent with `app.ts`'s design of doing all the real work (team settings → work item → child types → templates → create → link) inside that same hidden iframe with no separate visible page. It says nothing about the iframe's lifetime beyond "runs in the background," i.e., it does not contradict or confirm the dialog-unload behavior above; it is corroborating context, not a lifecycle claim. **Confidence: High** for the quote itself, **not applicable** to the teardown question directly.

### Extensibility Points reference — target confirmation
Microsoft Learn — "Extensibility Points" (`https://learn.microsoft.com/en-us/azure/devops/extend/reference/targets/overview?view=azure-devops`, fetched 2026-08-08) lists `ms.vss-work-web.work-item-toolbar-menu` under "Azure Boards menu and toolbar" as "Work item for context menu" with target ID `ms.vss-work-web.work-item-toolbar-menu` — confirms this target ID is current/valid in the present-day docs (extension pinned SDK v1.104.0 is older, but the contribution *type* target itself is still documented as live). No lifecycle/peek-vs-full-page distinction is called out on this reference page specifically. **Confidence: High** for target validity; **N/A** for lifecycle.

### Sources found but not usable as evidence
- `https://developercommunity.visualstudio.com/t/Azure-DevOps-Extension-iframe-reloads-on/10764556` and `.../11093217` ("Work Item Extension iframe reloads on first work item update/save") — titles strongly suggest a directly relevant, previously-reported bug about extension iframes reloading tied to work item save/update actions, which would be strong corroborating evidence. However, `WebFetch` against these URLs returned only site navigation chrome (client-side-rendered SPA, content not present in server HTML) — **the actual report content could not be retrieved**. Listed here for the user/synthesizer to optionally open directly in a browser; **not used as a citation for any claim above**. Confidence if later confirmed: would be High (direct prior-art bug report); currently: not counted as evidence.
- `microsoft/vss-web-extension-sdk` GitHub issue #38, "Alternative to ms.vss-work-web.work-item-toolbar-menu" — fetched; concerns a *different* problem (the toolbar menu extension point becoming unavailable in a TFS 2017.1 UI redesign) and contains no lifecycle/teardown discussion. Not usable as evidence for this question.
- `using-host-dialog.md` (`IHostPageLayoutService.openCustomDialog`, the newer-SDK dialog API) — fetched; explicitly does not discuss iframe/content persistence after dialog close ("the documentation is silent" on this). Confirms the newer `azure-devops-extension-sdk` docs have the same documentation gap as the legacy SDK on this exact question — useful as a "gap noted, not filled" data point, not as positive evidence either way.

---

## 3. Patterns for surviving panel close (documented options)

No API in the local typings or fetched Microsoft docs describes a "run detached from any hosting iframe" execution mode — the SDK's execution model is fundamentally "your code runs inside an iframe that a host UI surface owns," per Section 1. Given that constraint, the documented/inferable options for making creation resilient to the *dialog* (not full-page) closing are:

1. **Move the contribution off the dialog-scoped form surface onto a surface that Microsoft's docs confirm survives dialog close**: the `ms.vss-work-web.work-item-notifications` **observer** type is explicitly documented as living "outside the form" and not destroyed when the dialog closes (Section 2, direct quote). However, observers are event listeners (`onFieldChanged`/`onLoaded`/`onSaved`/etc.) tied to a work-item-form lifecycle, not a freestanding execution context invoked by a toolbar click — repurposing it to run arbitrary long-running creation logic triggered by a menu click (rather than in response to a form event) is an architectural mismatch, not a drop-in fix. **Confidence: Medium** — the survivability claim is directly documented; suitability for this specific use case is inferred, not documented.
2. **Trigger the long-running work from a persistent host-level UI surface instead of a per-dialog action iframe** — e.g., a `ms.vss-web.hub` (its own page/URI in Azure Boards navigation, per `vss.d.ts` and the Extensibility Points reference) is not scoped to any single work item's dialog and would not be torn down by closing a peek panel, only by full navigation away from the hub or page refresh. This is a bigger UX change (moves the "create" action out of the work item toolbar into a separate page) but is the clearest documented way to decouple the running work's iframe lifetime from the work-item-dialog's lifetime. **Confidence: Medium** — inferred from the general hub-contribution model (`vss.d.ts` `ms.vss-web.hub` interfaces + Extensibility Points reference), not a documented "this is how you make background work survive" recipe.
3. **`extensionReusedCallback`** (`vss.d.ts:339`, `398`) governs frame *reuse across same-URI contribution invocations*, not frame *survival across a hosting dialog being closed* — it does not address this bug. Ruled out. **Confidence: High** (directly read from the interface's own doc comment, which describes a different scenario).
4. **No server/backend fallback is available** — per `tech-stack.md`, this extension is stateless/browser-only with no backend, so "keep creating in the background via a server job" is architecturally out of scope, matching the research brief's exclusion.

None of these fully satisfy "keeps creating tasks in the background even if the popup is closed, stopping only on a full page refresh" without a structural change to *where* the extension's iframe lives (option 2), since the SDK provides no mechanism for code execution detached from a hosted DOM frame. This should be flagged explicitly to the synthesis/solution-design phase as a hard platform constraint, not just an implementation detail.

---

## Source List

**Local typings** (`src/node_modules/vss-web-extension-sdk/typings/vss.d.ts`, SDK v1.104.0 as pinned in `package.json`):
- `IXDMObjectRegistry` — lines 283-300
- `IExtensionInitializationOptions` — lines 305-340
- `ISandboxedStorage` — lines 346-351
- `IHostHandshakeData` — lines 356-382
- `IExtensionHandshakeData` — lines 387-404
- `IHostDialogService` / `IHostDialogOptions` — lines 517-674
- `IHostNavigationService` — lines 679-689
- `VSS.init`/`require`/`ready`/`notifyLoadSucceeded`/`notifyLoadFailed`/`register` (module `VSS/SDK`) — lines 2767-2839
- `IExtensionHost`, `IContributionHostBehavior`, `createExtensionHost` (module `VSS/Contributions/Controls`) — lines 7568-7658

**External (fetched 2026-08-08):**
- Microsoft Learn, "Extend the work item form" — https://learn.microsoft.com/en-us/azure/devops/extend/develop/add-workitem-extension?view=azure-devops (page dated `ms.date: 2026-04-03`, applies to current `azure-devops`, `azure-devops-2022`, `azure-devops-server`)
- Microsoft Learn, "Add a menu action" — https://learn.microsoft.com/en-us/azure/devops/extend/develop/add-action?view=azure-devops (same date stamp)
- Microsoft Learn, "Extensibility Points" — https://learn.microsoft.com/en-us/azure/devops/extend/reference/targets/overview?view=azure-devops (same date stamp)
- Microsoft Learn / GitHub source, "Using host dialogs" — https://github.com/MicrosoftDocs/azure-devops-docs/blob/main/docs/extend/develop/using-host-dialog.md (fetched via GitHub raw source; confirmed silent on iframe-persistence-after-close)
- `microsoft/vss-web-extension-sdk` GitHub issue #38 — https://github.com/Microsoft/vss-web-extension-sdk/issues/38 (checked, not directly relevant — different problem, repo archived 2023-01-27)
- General browser/web-platform behavior on iframe removal aborting in-flight requests (cross-checked, not Azure-DevOps-specific): Chrome for Developers, "Abortable fetch" — https://developer.chrome.com/blog/abortable-fetch; Mozilla Bugzilla #1165237 "fetch() not aborted upon document unload" — https://bugzilla.mozilla.org/show_bug.cgi?id=1165237; Mozilla Bugzilla #1084399 "XMLHttpRequests aborted when they should not be" — https://bugzilla.mozilla.org/show_bug.cgi?id=1084399

**Found but not usable as cited evidence** (content inaccessible or off-topic — listed for completeness/follow-up, not relied upon in any finding above):
- https://developercommunity.visualstudio.com/t/Azure-DevOps-Extension-iframe-reloads-on/10764556 (content not retrievable — SPA shell only)
- https://developercommunity.microsoft.com/t/Work-Item-Extension-iframe-reloads-on-fi/11093217 (content not retrievable — SPA shell only)
