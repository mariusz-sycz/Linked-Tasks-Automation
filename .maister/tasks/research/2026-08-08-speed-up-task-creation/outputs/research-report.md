# Research Report: Speed Up Task Creation, Add Progress Feedback, Fix Popup-Close Reliability

## TL;DR
The click-to-first-task delay is a single, strictly sequential `Q`-promise chain with zero UI feedback and two needlessly nested (but independent) REST calls; real but *partial* parallelization headroom exists in the per-template create loop. All three sub-questions (preload/async, progress UI, popup-close survival) converge on the same root constraint: the extension's only contribution (`ms.vss-web.action` → invisible, dialog-scoped `toolbar.html`) has no pre-click load moment, no visible rendering surface, and is very likely torn down when its hosting work-item dialog closes. Cheap, no-manifest-change wins exist for (a) (caching, safe parallelization) and a partial fix for (b) (modal end-of-run summary); a robust fix for (b) and (c), and true pre-click preload for (a), all require adding a persistent/visible contribution surface not scoped to the work-item dialog.

## Key Decisions
- Recommend splitting remediation into a **point-fix track** (no manifest change: caching, safe parallelization, modal summary) and an **architecture track** (new contribution surface) rather than treating the three sub-questions as independent problems — three gatherers converged on the same structural cause from unrelated angles.
- Recommend `localStorage` (native or SDK-shimmed) as the template-caching mechanism over `IExtensionDataService` (no latency advantage, adds a REST round trip) or IndexedDB (unnecessary complexity, unshimmed by the SDK, risk of silent failure in sandboxed iframes).
- Recommend NOT blanket-parallelizing the per-template create loop — only templates without `justCreatedTasks`-referencing `linkTo` rules can safely run concurrently without changing existing template behavior.

## Open Questions / Risks
- The popup-close root cause rests on a documented category contrast (observer vs. form-scoped contributions), not a verbatim Microsoft statement about this exact contribution type, and has not been live-verified (no Azure DevOps org available for this research).
- Whether the toolbar iframe is ever reused (vs. always freshly created) across repeated clicks is unresolved — affects only the viability of an in-memory cache layer, not the core recommendations.
- Runtime resolution of the `q` AMD promise library in the packaged `.vsix` is unconfirmed — relevant if a redesign continues using `Q` rather than switching to native `Promise`/`async`/`await` (compile target already supports it).

---

## Table of Contents
1. [Executive Summary](#executive-summary)
2. [Research Objectives](#research-objectives)
3. [Methodology](#methodology)
4. [Findings](#findings)
5. [Analysis and Insights](#analysis-and-insights)
6. [Conclusions](#conclusions)
7. [Recommendations](#recommendations)
8. [Appendices](#appendices)

---

## Executive Summary

**What was researched**: How the Linked Tasks Automation Azure DevOps extension can be changed to (a) preload/cache templates and create child tasks/links asynchronously so the user isn't blocked after clicking "create"; (b) show a visible, non-blocking progress indicator while creation is in flight; and (c) keep creating tasks in the background even if the popup/dialog hosting the extension is closed, stopping only on a full page refresh.

**How it was researched**: A codebase gatherer traced the exact call graph in `src/scripts/app.ts` end-to-end, citing every network round trip and its dependency relationships. Three platform-capability gatherers researched the Azure DevOps Extension SDK (VSS SDK v1.104.0, the version this project pins) against both the bundled local typings (ground truth for what's callable) and official Microsoft Learn documentation plus browser-platform references (ground truth for lifecycle/behavioral semantics not expressed in typings alone), split by capability area: async/lifecycle and popup teardown, client-side storage/caching, and progress-UI controls. No live Azure DevOps organization was available for behavioral verification; every platform claim is documentation- and first-principles-based, with confidence levels assigned accordingly.

**Key findings**: The current flow is a single sequential promise chain with no user feedback of any kind. Two REST calls (`getTeamSettings`, `getWorkItem`) are independent but coded as nested/sequential. The per-template create loop is serialized unconditionally, but only templates whose `linkTo` rules reference `justCreatedTasks`-derived helpers actually need that ordering — the rest is genuine parallelization headroom. On the platform side, the extension's single contribution (`ms.vss-web.action`, targeting the work-item toolbar/context menu) has no pre-click load moment, renders no visible DOM, and — per Microsoft's documented contrast between form-scoped and observer-type contributions — is very likely destroyed when the work item's hosting dialog closes, aborting in-flight REST calls.

**Main conclusions**: Meaningful improvements to (a) are achievable today with no manifest change (client-side caching for repeat invocations, safe partial parallelization). A partial improvement to (b) is achievable today (a modal end-of-run summary via `IHostDialogService`). A robust, "as literally requested" fix to (b) — visible, non-blocking, in-flight progress — and to (c) — surviving popup close, stopping only at full refresh — both require adding a new contribution surface that is not scoped to the work-item dialog. This same architectural change also upgrades (a) from "cache for the second click" to true pre-click preload. This convergence is the single most important input for the downstream solution-design phase.

---

## Research Objectives

**Primary research question**: How can the Linked Tasks Automation extension be changed to (a) preload/cache templates asynchronously after plugin load and create child tasks + links asynchronously so the user isn't blocked waiting after clicking "create"; (b) surface a visible, non-blocking progress indicator (progress bar or notice) while creation is in flight; and (c) keep creating tasks in the background even if the Azure DevOps popup panel hosting the extension is closed, stopping only on a full page refresh?

**Sub-questions**:
- Where exactly does the click-to-first-task delay come from in the existing code, and which steps are genuinely sequential vs. parallelizable?
- What client-side caching mechanisms does the VSS SDK offer for templates, and what are their latency/quota/persistence trade-offs?
- What VSS SDK controls exist for progress/status feedback, and can any of them render visibly without blocking the host page, given this extension's contribution type?
- Why does task creation break when the parent work item is opened in a popup/dialog, and what would it take to make it resilient to that specific event while still stopping on a full page refresh?

**Scope**:
- *Included*: current template-loading and task/link creation flow (`src/scripts/app.ts` and related files); VSS SDK APIs for async execution, background work, storage, and notifications; browser-side storage options (`localStorage`, IndexedDB, `IExtensionDataService`); Azure DevOps extension UI patterns for non-blocking progress; popup/panel lifecycle behavior and its effect on iframe execution/lifetime.
- *Excluded*: full TypeScript migration (tracked separately); server-side/backend changes (extension is stateless, browser-only).
- *Constraints*: must work within VSS SDK constraints (no custom backend/database); AMD/RequireJS, ES6+ codebase; any background/async behavior must respect Azure DevOps host iframe sandboxing and lifecycle events.

---

## Methodology

**Research type**: Mixed — technical codebase analysis combined with platform/SDK capability research.

**Approach**: Four parallel information-gathering passes, each producing a cited findings file:
1. **Codebase** (`src/scripts/app.ts`, `src/toolbar.html`, `src/vss-extension.json`, build/config files) — full call-graph trace, every async boundary and blocking point annotated.
2. **Platform lifecycle** (VSS SDK async/background execution model, XDM frame handshake, iframe/panel teardown behavior) — local typings plus Microsoft Learn documentation.
3. **Platform storage** (`IExtensionDataService`, `ISandboxedStorage`/`localStorage` shim, IndexedDB, preload-after-init patterns) — local typings, SDK runtime source, and Microsoft Learn documentation.
4. **Platform progress UI** (`VSS/Controls/StatusIndicator`, `VSS/Controls/Notifications`, `GlobalProgressIndicator`, `IHostDialogService`) — local typings and Microsoft Learn documentation.

**Data sources analyzed**:
- Codebase: `src/scripts/app.ts` (~630 lines, full read), `src/toolbar.html` (full read), `src/vss-extension.json` (full read), `src/gruntfile.js`, `src/configs/*.json`, `src/package.json`, `src/tsconfig.json`.
- Local SDK ground truth: `src/node_modules/vss-web-extension-sdk/typings/vss.d.ts` (SDK v1.104.0, ~30 relevant interface/module sections cited by line) and `src/node_modules/vss-web-extension-sdk/lib/VSS.SDK.js` (runtime source, used to verify actual shim behavior beyond what typings alone show).
- External documentation: 6 Microsoft Learn pages (extend-the-work-item-form, add-a-menu-action, extensibility-points overview, data-storage, contributions-overview, using-host-dialogs), 2 browser-engine references (Chromium "abortable fetch," 2 Mozilla Bugzilla reports on fetch/XHR-on-unload behavior), 1 developer blog on SDK migration, plus several GitHub issues and Developer Community threads surfaced but not usable as evidence (content inaccessible or off-topic — see Appendices).

**Analysis framework**: Mixed — technical component/pattern/flow analysis for the codebase trace; platform-capability option enumeration with constraint checks and trade-off tables for the three platform areas.

**Limitations**: No Azure DevOps organization was available for live behavioral verification (a project-wide constraint also noted during the prior TypeScript migration research). All platform-lifecycle claims are documentation- and first-principles-based; every finding below carries an explicit confidence level reflecting this.

---

## Findings

### Finding 1: The entire creation flow is a single sequential promise chain with zero UI feedback
**Category**: Technical / Implementation | **Confidence**: High

**Description**: `create()` (`src/scripts/app.ts:611`) calls `AddTasks(workItemId)` per work item, which chains `getTeamSettings` → `getWorkItem` → `GetChildTypes` → `getTemplates` → a per-template loop, each step nested inside the previous step's `.then`. `create()` itself returns `void` and is never awaited by `toolbar.html`; there is no spinner, disabled button, progress text, or completion callback anywhere in the flow.

**Evidence**:
```ts
// src/scripts/app.ts:611-627
export function create(context: any): void {
    ctx = VSS.getWebContext();
    if (context.workItemIds && context.workItemIds.length > 0) {
        context.workItemIds.forEach(function (workItemId: number) {
            AddTasks(workItemId);   // fire-and-forget, no await/return
        });
    }
    ...
}
```
Every `console.log`/`console.error` call in the file goes only to the devtools console (`app.ts`, throughout), never to the UI.

**Implications**: Any progress-UI design needs a new aggregate-completion signal — none currently exists at any layer (not `toolbar.html`, not `app.ts`, not the host).

---

### Finding 2: Two REST calls are independent but coded as nested/sequential
**Category**: Technical / Implementation | **Confidence**: High

**Description**: `workClient.getTeamSettings(team)` and `witClient.getWorkItem(workItemId)` (`app.ts:38,41`) do not depend on each other's results — `getWorkItem` is only nested inside `getTeamSettings`'s `.then` by code structure, not by data dependency.

**Evidence**: `src/scripts/app.ts:38-48` — dependency table in the codebase findings file confirms step 2 (`getWorkItem`) "does not depend on `teamSettings` result at all, only nested inside its `.then` by code structure."

**Implications**: These two calls can run concurrently via `Q.all`/`Promise.all` with no risk — the single lowest-risk, highest-confidence optimization identified in this research.

---

### Finding 3: The per-template create loop is serialized unconditionally, but only a subset of templates genuinely need that ordering
**Category**: Technical / Implementation | **Confidence**: High

**Description**: `chain = chain.then(createChildFromTemplate(...))` (`app.ts:63`) serializes every template's `getTemplate`+`createWorkItem` pair, one at a time. This exists to support `linkTo` rules that read a shared `justCreatedTasks` array (`ToAllJustCreatedTasks`, `PreviouslyCreatedTask`, `FirstJustCreatedTask`, `SecondJustCreatedTask`, `SecondPreviouslyJustCreatedTask`) in alphabetical-by-template-name order — but templates with no such rule, or only `ToAllOtherChilds` (which queries the parent's existing relations independently), gain nothing from serialization.

**Evidence**: `src/scripts/app.ts:36,63,116,134-186` (ordering-dependency analysis), `:501-508` (alphabetical `SortTemplates`).

**Implications**: A safe concurrency redesign must detect which templates' `linkTo` rules reference `justCreatedTasks`-derived helpers and serialize only those; blanket parallelization would silently break existing template configurations that rely on positional linking semantics.

---

### Finding 4: Link creation is already fire-and-forget, but nothing tracks true completion
**Category**: Technical / Implementation | **Confidence**: High

**Description**: `linkItems(...)` calls (parent link and every `linkTo` rule match, `app.ts:120,140,150,159,167,175,183`) are never `return`ed/awaited into the `chain` — they don't block progression to the next template, but there is also no promise that resolves when all of them have actually finished.

**Evidence**: `src/scripts/app.ts:104-199` (`createWorkItem`, full body walkthrough).

**Implications**: "Still running in background" state is currently unbounded/untracked — any progress or completion UI needs to introduce this tracking, since link calls could still be in flight after the last template's create call has resolved.

---

### Finding 5: This extension's contribution type has no pre-click load moment
**Category**: Platform / Architecture | **Confidence**: Medium

**Description**: `create-linked-tasks-button-test` (`ms.vss-web.action`) declares its menu text/icon/title statically in the manifest, so Azure DevOps never needs to load `toolbar.html`'s iframe to render the toolbar/context-menu entry — only when the user actually clicks it. There is no "plugin load" event distinct from the click itself for this contribution type.

**Evidence**: `src/vss-extension.json:67-83` (static `text`/`title`/`icon` properties); `src/toolbar.html:1-42` (full file — `VSS.init()` and registration only, no eager work).

**Implications**: "Preload templates asynchronously after plugin load," taken literally, is not architecturally reachable without adding a new, earlier-loading contribution (e.g., a hub or work-item-form-page contribution) dedicated to warming the cache.

---

### Finding 6: `localStorage` (native or SDK-shimmed) survives the toolbar iframe's teardown and reload
**Category**: Platform / Storage | **Confidence**: High

**Description**: The SDK transparently shims `window.localStorage` when the extension iframe has an opaque/sandboxed origin, relaying writes to the host frame's own `localStorage` keyed by publisher id; when the iframe has a normal origin, native `localStorage` is used directly. Either way, storage is scoped outside the iframe's own lifecycle, so a cache written on click #1 is available on click #2+, even after the popup that hosted click #1 is closed.

**Evidence**: `src/node_modules/vss-web-extension-sdk/lib/VSS.SDK.js:686-798` (shim class + `shimSandboxedProperties()`), `:835-897` (handshake sync logic) — verified in runtime source, not just typings.

**Implications**: Template caching for repeat invocations is achievable today with no manifest change — a check-cache-first-then-fetch-and-store change inside `create()`/`AddTasks()` is sufficient.

---

### Finding 7: No built-in VSS control renders visible, non-blocking progress for this contribution type as-is
**Category**: Platform / UI | **Confidence**: High

**Description**: `toolbar.html`'s `<body>` contains only a `<script>` block — the iframe is never rendered visibly. `StatusIndicator`, `WaitControl`, `LongRunningOperation`, and `ToastNotification` all render in-DOM into whatever document instantiates them (this invisible iframe). `GlobalProgressIndicator` is a per-frame singleton with no documented way for an extension to reach the host page's instance. The one API confirmed to render in the host frame, `IHostDialogService.openMessageDialog`, is modal.

**Evidence**: `src/node_modules/vss-web-extension-sdk/typings/vss.d.ts:14976-15299` (StatusIndicator/WaitControl/LongRunningOperation), `:13860-14012` (ToastNotification), `:29312-29494` (GlobalProgressIndicator), `:636-674`,`:25877-25907` (IHostDialogService); `src/toolbar.html:11-41` (empty body, script-only).

**Implications**: A genuinely visible, non-blocking, in-flight progress bar requires adding a new visible contribution surface (dialog-content control or work-item-form-page panel) to host these controls in — it cannot be achieved by a same-file code change to `toolbar.html`/`app.ts` alone.

---

### Finding 8: Form-scoped contributions (including this extension's toolbar/context-menu action) are documented as unloaded when the hosting dialog closes
**Category**: Platform / Lifecycle | **Confidence**: Medium-High

**Description**: Microsoft Learn documents that the `ms.vss-work-web.work-item-notifications` **observer** contribution type "lives outside the form and isn't destroyed when the form dialog closes" — stated in direct contrast to form-scoped contribution types, which are implied to be destroyed. This extension's `create-linked-tasks-button-test` targets `ms.vss-work-web.work-item-toolbar-menu`/`work-item-context-menu`, both form-scoped, non-observer types.

**Evidence**: Microsoft Learn, "Extend the work item form" (fetched 2026-08-08): *"Observers listen to work item events without any UI on the form. Use observers to listen for the `onSaved` event, since observers live outside the form and aren't destroyed when the form dialog closes."* Cross-referenced against `src/vss-extension.json:66-84` (this extension's actual contribution type/targets).

**Implications**: This is the closest available primary-source match to the reported bug's root cause; it is a documented category contrast, not a verbatim statement naming the toolbar-menu action type — hence Medium-High rather than High confidence. Live verification in a real ADO org is recommended before implementation.

---

### Finding 9: Removing an iframe from the DOM aborts its in-flight network requests (standard browser behavior)
**Category**: Platform / Lifecycle | **Confidence**: Medium-High

**Description**: When a browsing context (iframe) is discarded, its fetch group is terminated and in-flight `fetch`/`XMLHttpRequest` calls are aborted — this is general, cross-engine web-platform behavior, not Azure-DevOps-specific.

**Evidence**: Chrome for Developers, "Abortable fetch"; Mozilla Bugzilla #1165237 ("fetch() not aborted upon document unload") and #1084399 ("XMLHttpRequests aborted when they should not be") — both confirm this is expected engine behavior, cross-checked across independent sources.

**Implications**: Combined with Finding 8, this completes the root-cause chain: dialog close → form-scoped contribution's iframe destroyed → in-flight REST calls (each template's create/link call in the sequential chain) aborted mid-batch — precisely matching the reported symptom.

---

### Finding 10: `IHostNavigationService.reload()` is the one documented mechanism matching "full page refresh" as the true reset point
**Category**: Platform / Lifecycle | **Confidence**: High

**Description**: `IHostNavigationService.reload()` is documented as reloading "the parent frame" — the entire top-level Azure DevOps page, tearing down every iframe on it, not just a dialog-scoped one.

**Evidence**: `src/node_modules/vss-web-extension-sdk/typings/vss.d.ts:679-689` — direct doc-comment quote, unambiguous.

**Implications**: This only becomes the *actual* stopping point for creation once the extension is moved off a contribution surface that's already destroyed by a mere dialog close (Finding 8) — otherwise the dialog close itself is the (much earlier) stopping point today.

---

### Finding 11: No SDK API in this generation supports execution detached from a hosted DOM frame
**Category**: Platform / Architecture | **Confidence**: Medium-High

**Description**: Every extension code path runs inside an iframe created via `createExtensionHost($container, ...)`, a child of whatever DOM container the triggering host UI (e.g., the dialog's own toolbar) supplies. There is no separate "run this detached from any UI surface" API anywhere in the SDK's typings.

**Evidence**: `src/node_modules/vss-web-extension-sdk/typings/vss.d.ts:7568-7659` (`IExtensionHost`, `createExtensionHost`); cross-confirmed independently by the storage gatherer (no pre-click load moment, Finding 5) and progress-UI gatherer (no host-frame-reachable non-modal control, Finding 7).

**Implications**: A structural fix for popup-close resilience is only achievable by choosing a different, non-dialog-scoped contribution type to host the triggering/execution surface — not by any in-place code change.

---

### Finding 12: `IExtensionDataService` and IndexedDB are not recommended for template caching
**Category**: Platform / Storage | **Confidence**: High (mechanism) / Medium (IndexedDB inference)

**Description**: `IExtensionDataService` is confirmed to be a thin wrapper over Azure DevOps's own REST API for extension settings storage — every read is a live HTTPS round trip with no inherent latency advantage over the templates fetch it would replace. IndexedDB is not mentioned, shimmed, or managed anywhere in the SDK; since it's subject to the same sandboxed-origin restrictions as `localStorage` (which the SDK does shim), it risks silent failure in exactly the deployment scenarios where the `localStorage` shim is quietly compensating.

**Evidence**: `vss.d.ts:25937-25939` ("Provides a wrapper around the REST client for getting and saving extension setting values"); Microsoft Learn data-storage page (endpoint shape confirmation); exhaustive grep of `vss.d.ts`/`VSS.SDK.js` for `indexedDB` — zero matches.

**Implications**: `localStorage` is the recommended caching mechanism; `IExtensionDataService` is only worth revisiting if cross-device/cross-browser durability becomes a stated requirement (not currently in scope).

---

### Summary Table: All Findings

| # | Finding | Category | Confidence |
|---|---|---|---|
| 1 | Entire flow is one sequential promise chain, zero UI feedback | Technical | High |
| 2 | `getTeamSettings`/`getWorkItem` independent but nested | Technical | High |
| 3 | Per-template loop serialized unconditionally; only a subset needs it | Technical | High |
| 4 | Link creation fire-and-forget; no aggregate completion tracking | Technical | High |
| 5 | No pre-click load moment for this contribution type | Platform/Architecture | Medium |
| 6 | `localStorage` survives toolbar iframe teardown | Platform/Storage | High |
| 7 | No built-in control renders visible non-blocking progress as-is | Platform/UI | High |
| 8 | Form-scoped contributions documented as unloaded on dialog close | Platform/Lifecycle | Medium-High |
| 9 | Iframe removal aborts in-flight network requests | Platform/Lifecycle | Medium-High |
| 10 | `reload()` reloads the parent frame (true "full refresh" event) | Platform/Lifecycle | High |
| 11 | No detached-execution SDK API exists in this generation | Platform/Architecture | Medium-High |
| 12 | `IExtensionDataService`/IndexedDB not recommended for caching | Platform/Storage | High / Medium |

---

## Analysis and Insights

### Patterns identified

| Pattern | Description | Prevalence | Assessment |
|---|---|---|---|
| Single transient, invisible, dialog-scoped contribution | Root architectural constraint behind all three sub-questions | Organizing fact of the whole research question | High-quality, convergent across all 4 gatherers |
| Bounded parallelization headroom | Not everything is on the critical path; some fan-outs already use `Q.all` | Codebase-only, exhaustively cited | High confidence, directly falsifiable |
| `localStorage` decoupled from iframe lifecycle | The one piece of extension state already outside the fragile contribution surface | Storage gatherer, runtime-source-verified | High confidence |
| No visible-and-non-blocking control without a new surface | Every in-DOM control renders invisibly; the one host-reachable API is modal | Progress-UI gatherer, exhaustive typings scan | High confidence |

### Key insights (see synthesis.md for full detail)
1. "Preload after plugin load" as literally stated is architecturally unreachable for the current contribution type (Medium confidence).
2. The popup-close bug is a "this contribution type is always dialog-scoped" problem, not a narrow "popup" edge case (Medium-High confidence).
3. A safe concurrency redesign cannot blanket-parallelize template creation — only templates without `justCreatedTasks`-dependent rules qualify (High confidence).
4. `localStorage` dominates `IExtensionDataService`/IndexedDB for this caching use case (High confidence).
5. A modal "done" dialog is the cheapest available progress-adjacent UX win but does not satisfy "non-blocking, in-flight" as requested (High confidence on the API; direct reading against the brief's requirement).

### Relationships and dependencies

The single contribution (`ms.vss-web.action` → `toolbar.html`) is the common ancestor of all three sub-questions' constraints: no pre-click load moment (a), no visible DOM surface (b), and dialog-scoped teardown (c). `localStorage`/`ISandboxedStorage` is the one component already decoupled from that fragile surface, which is why it alone survives what the iframe cannot. `justCreatedTasks` is local, in-memory, per-invocation state — entirely orthogonal to caching, and the thing that constrains how far the create loop can be parallelized regardless of any architecture changes made for (b)/(c).

### Quality assessment (SWOT-style, of the current implementation)

- **Strengths**: existing fan-outs (`getTemplates`, `GetChildTypes` sub-categories) already use `Q.all` correctly; link creation is already decoupled (fire-and-forget) from the main chain; ES2015 compile target means native `Promise`/`async`/`await` are available if the team wants to move off `Q`.
- **Weaknesses**: zero UI feedback anywhere; two independent REST calls needlessly nested; per-template loop over-serialized; no error surfacing to the user (console-only); no aggregate "all done" signal.
- **Opportunities**: no-manifest-change wins available today (caching, safe parallelization, modal summary); a single architecture investment (new contribution surface) would resolve (b) and (c) together and upgrade (a).
- **Threats/Risks**: blanket parallelization would silently break templates using positional `linkTo` rules; the popup-close root cause is not live-verified; runtime resolution of the `q` module in the shipped bundle is unconfirmed.

---

## Conclusions

### Primary conclusions
1. The click-to-first-task delay is fully explained by a strictly sequential `Q`-promise chain with unnecessary nesting and unconditional per-template serialization, with no UI feedback anywhere. **Confidence: High.**
2. All three sub-questions share a single root architectural constraint — the extension's only contribution type has no pre-click load moment, no visible rendering surface, and is very likely torn down on dialog close. **Confidence: Medium-High.**
3. Meaningful, lower-risk improvements to (a) and a partial improvement to (b) are achievable today with no manifest change. **Confidence: High** on mechanisms.

### Secondary conclusions
- The popup-close bug likely already occurs on ordinary dialog close today — "stops only on a full page refresh" describes a desired future state, not current behavior.
- Any progress/completion UI redesign must also address the currently silent (console-only) error handling, since representing partial failure is implicit in "in-flight progress."

### Direct answer to the research question
See the synthesis document's "Direct answer" section for the full three-part answer; in short: (a) cache-after-first-click plus safe partial parallelization is achievable now, true pre-click preload needs a new contribution; (b) no built-in control gives visible non-blocking in-flight progress without a new visible surface, though a modal end-of-run summary is available today; (c) the root cause is dialog-scoped contribution teardown aborting in-flight REST calls, and the only documented fix is moving to a contribution type not scoped to the work-item dialog.

---

## Recommendations

| # | Recommendation | Priority | Effort | Rationale |
|---|---|---|---|---|
| 1 | Cache templates in `localStorage`, check-cache-first in `create()`/`AddTasks()` | High | Low | No manifest change; survives popup close; helps every click after the first |
| 2 | Parallelize `getTeamSettings`/`getWorkItem` via `Promise.all`/`Q.all` | High | Low | Zero-risk, independent calls, currently needlessly nested |
| 3 | Selectively parallelize template creates without `justCreatedTasks`-dependent `linkTo` rules | Medium | Medium | Real speedup; requires careful implementation-time verification against existing template behavior |
| 4 | Add a modal end-of-run summary via `IHostDialogService.openMessageDialog` | Medium | Low | Cheapest available feedback win; not a substitute for live progress |
| 5 | Evaluate adding a persistent/visible contribution surface (hub or work-item-form-page) | High (strategic) | Medium-High | Single investment that resolves (b) and (c) robustly and upgrades (a) to true pre-click preload |
| 6 | Live-verify the popup-close root cause in a real Azure DevOps org before implementing (c) | High | Low | The one load-bearing platform claim not yet empirically confirmed |

---

## Appendices

### Complete source list

**Codebase**: `src/scripts/app.ts`, `src/toolbar.html`, `src/vss-extension.json`, `src/gruntfile.js`, `src/configs/dev.json`, `src/configs/release.json`, `src/package.json`, `src/tsconfig.json`.

**Local SDK ground truth** (`vss-web-extension-sdk@1.104.0`): `src/node_modules/vss-web-extension-sdk/typings/vss.d.ts` (interfaces: `IExtensionInitializationOptions`, `IHostHandshakeData`, `IExtensionHandshakeData`, `IXDMObjectRegistry`, `IHostNavigationService`, `IHostDialogService`, `IExtensionDataService`, `ISandboxedStorage`, `IExtensionHost`/`createExtensionHost`, `StatusIndicator`/`WaitControl`/`LongRunningOperation`, `ToastNotification`, `GlobalProgressIndicator`); `src/node_modules/vss-web-extension-sdk/lib/VSS.SDK.js` (runtime shim/handshake behavior).

**External — Microsoft Learn (fetched 2026-08-08)**:
- "Extend the work item form" — https://learn.microsoft.com/en-us/azure/devops/extend/develop/add-workitem-extension?view=azure-devops
- "Add a menu action" — https://learn.microsoft.com/en-us/azure/devops/extend/develop/add-action?view=azure-devops
- "Extensibility Points" — https://learn.microsoft.com/en-us/azure/devops/extend/reference/targets/overview?view=azure-devops
- "Data and Setting Storage" — https://learn.microsoft.com/en-us/azure/devops/extend/develop/data-storage?view=azure-devops
- "Contribution model" — https://learn.microsoft.com/en-us/azure/devops/extend/develop/contributions-overview?view=azure-devops
- "Create modal dialogs in Azure DevOps extensions" — https://learn.microsoft.com/en-us/azure/devops/extend/develop/using-host-dialog?view=azure-devops

**External — browser platform / community**:
- Chrome for Developers, "Abortable fetch" — https://developer.chrome.com/blog/abortable-fetch
- Mozilla Bugzilla #1165237, #1084399 (fetch/XHR-on-unload behavior)
- Phong Cao (Medium), "Porting VSS Web Extension SDK to Azure DevOps Web Extension SDK" — https://phongthaicao.medium.com/porting-vss-web-extension-sdk-to-azure-devops-web-extension-sdk-86a6ce3f39c2
- `microsoft/vss-web-extension-sdk` GitHub issue #38 (checked, not directly relevant)
- `microsoft/azure-devops-extension-sdk` issue #25, `microsoft/azure-devops-extension-api` issue #140 (surfaced, not deeply read)

**Found but not usable as evidence** (content inaccessible — SPA shell only, or off-topic):
- https://developercommunity.visualstudio.com/t/Azure-DevOps-Extension-iframe-reloads-on/10764556
- https://developercommunity.microsoft.com/t/Work-Item-Extension-iframe-reloads-on-fi/11093217
- Power BI/Fabric community forum thread on sandboxed-iframe storage (different product, cited with caution only)

### Gaps and uncertainties
See synthesis.md, "Gaps and Uncertainties" section, for the full list — summarized: no live ADO org for verification; `ms.vss-web.action`-specific dialog-teardown statement not found verbatim; `q` AMD module runtime resolution unconfirmed; toolbar iframe reuse-across-clicks unresolved; `IExtensionDataService` byte-quota unconfirmed; shimmed-vs-native `localStorage` path in the real deployment target unconfirmed.

### Methodology details
Four-gatherer plan (codebase, platform-lifecycle, platform-storage, platform-progress-ui), fully documented in `planning/research-plan.md` and `planning/research-brief.md` within this task directory. Full findings files: `analysis/findings/codebase-task-creation-flow.md`, `analysis/findings/platform-lifecycle-async-and-popup.md`, `analysis/findings/platform-storage-template-caching.md`, `analysis/findings/platform-progress-ui-feedback.md`.

### Raw data references
Full pattern/insight synthesis with cross-source validation tables: `analysis/synthesis.md` (this task directory).
