# Synthesis: Speed Up Task Creation, Add Progress Feedback, Fix Popup-Close Reliability

## TL;DR
All three sub-questions trace back to one root constraint: the extension's single contribution (`ms.vss-web.action` → `toolbar.html`) is a transient, invisible, dialog-scoped iframe with no pre-click load moment, no host-frame-visible surface, and — per Microsoft's own documented contrast with the `work-item-notifications` observer type — is very likely torn down the instant the parent work item's dialog/peek panel closes. Async preload has a cheap partial fix (cache after first click; safely parallelize independent REST calls) but a *true* pre-click preload, a *visible* in-flight progress bar, and *popup-close survival* all point to the same structural fix: adding a persistent/visible contribution surface (hub or work-item-form-page) decoupled from the dialog's lifecycle. Point-fixes exist for (a) and partially for (b); (c) has no point-fix at all within the current contribution type.

## Key Decisions
- Treat "add a persistent/non-dialog-scoped contribution surface" as the single architectural fork the solution-design phase must resolve first — it is the shared prerequisite for a robust fix to (b) and (c), and materially upgrades (a). — three independent gatherers converged on it from unrelated angles (lifecycle, storage, progress-UI).
- Recommend splitting the fix into a **no-manifest-change track** (cache-after-first-click, parallelize independent REST calls, selectively parallelize order-independent template creates) that can ship immediately, and an **architecture track** (new contribution surface) that resolves (b)/(c) properly — not either/or, sequential.
- Do not pursue IndexedDB or `IExtensionDataService` as the primary caching mechanism — neither offers an advantage over `localStorage` for this data size/latency profile.

## Open Questions / Risks
- Popup-close root cause (Medium-High confidence) rests on a documented *category contrast* (observer vs. form-scoped contributions), not a verbatim statement about `ms.vss-web.action`/`work-item-toolbar-menu` by name, and could not be live-verified (no ADO org available).
- Whether the current code's `justCreatedTasks`-only-partial serialization can be safely narrowed to "only templates with `justCreatedTasks`-referencing `linkTo` rules" without behavior change needs careful implementation-time verification, not just design-time reasoning.
- Runtime resolution of the `q` promise library in the packaged AMD bundle is unconfirmed (open question inherited from the codebase gatherer) — relevant if any redesign keeps using `Q` rather than switching to native `Promise`/`async`/`await`.
- Whether the shimmed-`localStorage` path or native path is active in the real deployment target (dev.azure.com vs. on-prem) is unconfirmed; affects only a narrow write-loss race, not the overall caching recommendation.

---

## Research Question

How can the Linked Tasks Automation extension be changed to (a) preload/cache templates asynchronously after plugin load and create child tasks + links asynchronously so the user isn't blocked waiting after clicking "create"; (b) surface a visible, non-blocking progress indicator (progress bar or notice) while creation is in flight; and (c) keep creating tasks in the background even if the Azure DevOps popup panel hosting the extension is closed, stopping only on a full page refresh?

---

## Executive Summary

The codebase gatherer traced the entire click-to-created-task path in `src/scripts/app.ts` and found a single, strictly sequential `Q`-promise chain (`getTeamSettings` → `getWorkItem` → `GetChildTypes` → `getTemplates` → per-template `getTemplate`+`createWorkItem`, chained one at a time) with **zero UI feedback anywhere** — no spinner, no disabled button, not even a completion callback back to `toolbar.html`. Two of the six network round trips (`getTeamSettings`, `getWorkItem`) are independent of each other but coded as nested/sequential, and the per-template create loop is serialized wholesale even though only templates whose `linkTo` rules reference `justCreatedTasks`-derived helpers (`PreviouslyCreatedTask`, `ToAllJustCreatedTasks`, etc.) have a genuine ordering dependency — real, but partial, parallelization headroom exists. Link creation (parent link and same-batch `linkTo` rules) is already fire-and-forget, but nothing tracks when it actually finishes.

The three platform gatherers, researching independently, converged on the same underlying constraint from three different directions. The storage gatherer found that this extension's contribution type (`ms.vss-web.action`, static menu-declared, no dynamic content) has **no "plugin load" moment before the click** — the iframe is only created when the user clicks, so literal "preload right after plugin load" is not reachable without a new, earlier-loading contribution; what *is* reachable without any manifest change is caching templates in `localStorage` (transparently shimmed by the SDK, confirmed to survive the toolbar iframe's teardown) so the second and later clicks in a session skip the fetch chain. The progress-UI gatherer found that `toolbar.html`'s iframe has an empty `<body>` and is never rendered visibly to the user — every in-DOM VSS control (`StatusIndicator`, `WaitControl`, `ToastNotification`, `GlobalProgressIndicator`) would render into that invisible iframe or, in `GlobalProgressIndicator`'s case, cannot even be confirmed to reach the host frame at all; the only API confirmed to cross into the visible host frame, `IHostDialogService.openMessageDialog`, is modal, making it a fit for a final "N of M created" summary but not live in-flight progress. The lifecycle gatherer found direct Microsoft documentation stating that work-item-form-scoped contributions (which this extension's toolbar/context-menu action is) are unloaded when the hosting dialog closes — in explicit contrast to the `work-item-notifications` observer type, which is documented to survive — and that removing an iframe from the DOM aborts its in-flight `fetch`/`XHR` calls (standard browser behavior). `IHostNavigationService.reload()`, which reloads the entire parent frame, is the one documented event matching the user's "only a full refresh stops it" framing, but it would only actually behave that way for a contribution surface that isn't already destroyed by a mere dialog close — which the current one is.

**The single most decision-relevant finding**: solving (b) and (c) robustly, and solving (a)'s "preload before first click" literally, all require the same structural change — moving (or adding) a contribution surface that is not scoped to the work-item dialog. Point-fixes exist for the rest: caching for repeat clicks, safe partial parallelization of the create chain, and a modal end-of-run summary dialog are all achievable today with no manifest change.

---

## Cross-Source Analysis

### Validated findings (confirmed by multiple sources / lines of reasoning)

| Finding | Confirmed by | Confidence |
|---|---|---|
| The extension has exactly one contribution, `ms.vss-web.action` → `toolbar.html`, form/dialog-scoped, not persistent | Codebase gatherer (manifest read) + Lifecycle gatherer (contribution-type analysis) + Storage gatherer (manifest read) + Progress-UI gatherer (manifest read) — four independent direct reads of the same 15-line manifest block, all agreeing | High |
| `toolbar.html`'s iframe renders no visible UI today | Codebase gatherer (full file read, confirms empty-ish body/no DOM) + Progress-UI gatherer (explicit empty-`<body>` finding) | High |
| No API in the current SDK generation lets code run detached from a hosted DOM frame | Lifecycle gatherer (exhaustive typings scan of `VSS/SDK` module) + Storage gatherer (independently concludes no "plugin load" moment for this contribution type) + Progress-UI gatherer (independently concludes no host-page control is reachable without a new surface) | Medium-High (three independent scans of the same typings file, same conclusion, but ultimately an absence-of-evidence argument) |
| `justCreatedTasks`-based linking imposes a genuine but *partial* ordering dependency, not a blanket one | Codebase gatherer only (this is a code-semantics question, single source, but backed by direct line citations for every `linkTo` rule branch) | High |
| `localStorage` (native or SDK-shimmed) survives the toolbar iframe's teardown/reload | Storage gatherer (verified directly in `VSS.SDK.js` runtime source, not just typings) | High |
| Removing an iframe from the DOM aborts its in-flight network requests | Lifecycle gatherer (general web-platform behavior, cross-checked against Chromium docs + two independent Mozilla Bugzilla reports) | Medium-High (not Azure-DevOps-specific, but well-established cross-engine behavior) |

### Contradictions (apparent, resolved)

There is no direct contradiction between findings, but there is an important **framing correction** the synthesis surfaces: the research question's premise — "stopping only on a full page refresh" — describes the *desired* end state, not the *current* behavior. The lifecycle gatherer's evidence indicates the current contribution type is already torn down on mere dialog close (a smaller event than a full refresh), so today's actual failure mode is likely *more* fragile than the user's framing suggests. `IHostNavigationService.reload()` (parent-frame reload) is the documented mechanism that matches "full refresh," but it only becomes the relevant stopping point *after* the extension is moved to a contribution surface that isn't already killed by the dialog closing. This is not a contradiction between gatherers — all four are consistent — but it is a distinction worth stating explicitly for solution design: "make it survive popup close" and "make full refresh the actual stopping point" are the same requirement, and neither is satisfiable without the architecture change.

### Confidence assessment summary

- **High confidence, direct evidence**: the current call graph and its lack of feedback (codebase); the single-contribution, invisible-iframe architecture (all four); `localStorage` surviving iframe teardown (storage); `IHostNavigationService.reload()` reloading the parent frame (lifecycle); no built-in VSS control renders visibly for this contribution type as-is (progress-UI).
- **Medium-High confidence, strong indirect evidence**: popup/dialog-close tearing down the extension's iframe and aborting in-flight requests (lifecycle) — a documented category contrast plus general web-platform behavior, not a verbatim per-contribution-type statement, and not live-verified.
- **Medium confidence, reasoned inference**: no "plugin load" moment exists for this contribution type before the click (storage); `GlobalProgressIndicator` cannot reach the host frame (progress-UI); IndexedDB is equally broken wherever the localStorage shim is needed (storage) — all inferred from code/typings structure and absence patterns, not directly observed.
- **Low confidence / unconfirmed**: `IExtensionDataService` byte-size quotas; whether the shimmed or native `localStorage` path is active in the real deployment target; runtime resolution of the `q` AMD module in the shipped bundle.

---

## Patterns and Themes

### Pattern 1: Single transient, invisible, dialog-scoped contribution as the root architectural constraint
**Description**: Every platform gatherer, researching a distinct capability area, hit the same wall: this extension has exactly one `ms.vss-web.action` contribution, and that contribution type has no pre-click load moment, no visible rendering surface, and (per documented contrast with the observer contribution type) is destroyed when its hosting dialog closes.
**Evidence**: `src/vss-extension.json:66-84` (all four gatherers); `src/toolbar.html:1-42` (codebase, progress-UI); Microsoft Learn "Extend the work item form" observer-vs-form-scoped contrast (lifecycle); static manifest-declared menu text meaning the iframe need never load before a click (storage).
**Prevalence**: This is not one finding among many — it is the organizing fact of the entire research question. All three sub-questions are downstream of it.
**Quality assessment**: High-quality, convergent, cross-gatherer evidence. This is the highest-value insight for solution design.

### Pattern 2: The create/link chain has real but *bounded* parallelization headroom
**Description**: Not everything in `AddTasks` is on a genuine critical path. `getTeamSettings`/`getWorkItem` are independent but nested; `getTemplates` and the sub-category fan-out in `GetChildTypes` are already parallelized via `Q.all`; only the per-template create loop is serialized unconditionally, and only a subset of templates (those with `justCreatedTasks`-referencing `linkTo` rules) actually need that ordering.
**Evidence**: `src/scripts/app.ts:38-108` (step-by-step dependency table), `:207-214` (`justCreatedTasks` ordering analysis).
**Prevalence**: Single-source (codebase gatherer) but exhaustively cited, line-by-line, for every rule branch.
**Quality assessment**: High confidence, directly falsifiable against the code as written.

### Pattern 3: Client-side caching is available today with zero manifest change, but only closes the gap for the *second* click onward
**Description**: `localStorage` (native or SDK-shimmed) is scoped to the extension's origin/publisher, not the short-lived iframe, so a cache populated on click #1 is available on click #2+ even after the popup that hosted the first click is closed and reopened. This requires no new contribution — just a check-cache-then-fetch-and-store change inside `create()`/`AddTasks()`.
**Evidence**: `VSS.SDK.js:686-798` (shim mechanism), `:835-897` (handshake sync); contrasted against `IExtensionDataService`, which is confirmed to be a REST wrapper with no latency advantage (`vss.d.ts:25937-25939` + Microsoft Learn data-storage page).
**Prevalence**: Single-source (storage gatherer), but backed by direct runtime source reads, not just typings — stronger than typical "Medium" inferential findings.
**Quality assessment**: High confidence on the mechanism; the "only helps click #2+" scope limit is the load-bearing caveat and is explicitly and consistently flagged.

### Pattern 4: No built-in control gives visible + non-blocking progress without a new host-visible surface
**Description**: `StatusIndicator`, `WaitControl`, `LongRunningOperation`, `ToastNotification`, and `GlobalProgressIndicator` all render in-DOM into whatever document instantiates them — for this extension that document is the invisible `toolbar.html` iframe. The one API confirmed to cross into the host frame, `IHostDialogService`, is modal by design.
**Evidence**: `vss.d.ts:14976-15299` (StatusIndicator/WaitControl/LongRunningOperation), `:13860-14012` (ToastNotification), `:29312-29494` (GlobalProgressIndicator, frame-locality caveat), `:636-674`/`:25877-25907` (IHostDialogService, host-frame-crossing + modal).
**Prevalence**: Single-source (progress-UI gatherer), exhaustive coverage of every relevant control in the pinned SDK version.
**Quality assessment**: High confidence — this is a closed, typings-verified search, not a sampling.

---

## Key Insights

### Insight 1: "Preload after plugin load" as literally stated is not architecturally possible for the current contribution type
**Evidence**: Storage gatherer, §4 — static `ms.vss-web.action` manifest properties (`text`/`title`/`icon`) mean the host never needs to load `toolbar.html` before the click; there is no "plugin load" event distinct from the click itself.
**Implication**: The brief's phrase "preload/cache templates asynchronously after plugin load" needs reinterpretation for solution design as either (a) "cache after first click, serve from cache on subsequent clicks" (achievable now) or (b) "add a new, earlier-loading contribution whose only job is to warm the cache before the toolbar action is ever invoked" (achievable, but a genuinely new manifest surface).
**Confidence**: Medium — code/manifest evidence is direct, but no single Microsoft document states this rule explicitly for `ms.vss-web.action`; it's inferred from contribution-model conventions.

### Insight 2: The popup-close bug is not really a "popup" problem — it's a "this contribution type is always dialog-scoped" problem
**Evidence**: Lifecycle gatherer, §2 — Microsoft's documented contrast between form-scoped contributions (destroyed on dialog close) and the observer type (survives). This extension's toolbar/context-menu action is form-scoped.
**Implication**: Any fix that keeps the trigger inside the work-item toolbar/context-menu inherits the same fragility, regardless of how the async work inside `app.ts` is restructured. The fix has to change *where the code runs*, not just *how it's sequenced*.
**Confidence**: Medium-High — direct documented contrast, not a verbatim statement about this exact contribution type; not live-verified.

### Insight 3: A safe concurrency redesign cannot blanket-parallelize template creation
**Evidence**: Codebase gatherer, §2.7 — `PreviouslyCreatedTask`/`FirstJustCreatedTask`/`SecondJustCreatedTask`/`ToAllJustCreatedTasks` rules depend on alphabetical-by-template-name creation order having already resolved and pushed to `justCreatedTasks`.
**Implication**: Any async redesign of the create loop must either (a) detect which templates' `linkTo` rules reference `justCreatedTasks`-derived helpers and serialize only those (running the rest concurrently), or (b) keep the create step ordered but decouple the *linking* calls (already fire-and-forget) from any "done" signal, or (c) show progress per-template as each resolves rather than fully parallelizing. Blanket parallelization would silently break existing template configurations that rely on positional linking rules.
**Confidence**: High — directly derived from reading every `linkTo` rule branch in the code.

### Insight 4: Client-side caching options are not equally good — `localStorage` dominates for this data profile
**Evidence**: Storage gatherer trade-off table (§5) — `IExtensionDataService` adds a REST round trip with no latency advantage over the existing template-fetch calls it would replace; IndexedDB adds async/transactional complexity with no capacity benefit for a few KB of JSON and is unshimmed (higher risk of silent failure in sandboxed-iframe deployments); an in-memory module cache dies with the iframe and cannot be relied upon without confirming frame reuse (unresolved cross-gatherer question).
**Implication**: `localStorage` should be the default recommendation for template caching; `IExtensionDataService` is only worth considering if cross-device/cross-browser durability becomes a stated requirement (not currently in scope).
**Confidence**: High on the mechanism-level comparison; Medium on absolute latency numbers (no measured data, only reasoned estimates).

### Insight 5: A modal "done" dialog is the cheapest available progress-adjacent UX improvement, but it is not what was asked for
**Evidence**: Progress-UI gatherer, trade-off table — `IHostDialogService.openMessageDialog` is the only API confirmed to render in the visible host frame from this contribution type, but it is modal (blocks user interaction with the host page until dismissed).
**Implication**: It's a reasonable stopgap for "tell the user something happened" (e.g., "5 of 5 tasks created" / error summary shown once creation finishes) but does not satisfy "visible, non-blocking, in-flight" progress — that requires the same new-contribution-surface investment identified in Insight 2.
**Confidence**: High on the API's behavior; the UX-fit judgment is a direct reading of the brief's own "non-blocking" requirement against documented modal semantics.

---

## Relationships and Dependencies

```
                        ┌─────────────────────────────────────────┐
                        │  Single contribution: ms.vss-web.action  │
                        │  → toolbar.html (invisible, dialog-scoped)│
                        └───────────────┬───────────────────────────┘
                                        │
        ┌───────────────────────────────┼───────────────────────────────┐
        │                               │                               │
        ▼                               ▼                               ▼
(a) No pre-click load moment    (b) No visible DOM surface      (c) Torn down on dialog close
  → true preload needs new        → in-DOM controls invisible;    → in-flight REST calls aborted
    earlier-loading contribution    only IHostDialogService          when popup/panel closes
  → localStorage cache DOES         crosses to host frame,          → IHostNavigationService
    survive iframe teardown,        but modal only                    .reload() is the only
    helps click #2+ today                                             documented full-teardown
        │                               │                               │
        └───────────────┬───────────────┴───────────────┬───────────────┘
                         ▼                               ▼
        Point-fix track (no manifest change):   Architecture track (new contribution surface,
        - cache after 1st click                 e.g. hub or work-item-form-page):
        - parallelize getTeamSettings/getWorkItem - resolves (b) fully (visible surface to host
        - selectively parallelize non-ordering-     StatusIndicator/WaitControl/ToastNotification)
          dependent template creates              - resolves (c) fully (not dialog-scoped)
        - modal end-of-run summary dialog          - enables true pre-click preload for (a)
```

**Component relationships**:
- `toolbar.html` (entry iframe) → `VSS.require` → compiled `scripts/app.js` (`app.ts`) → `witClient`/`workClient` REST calls. This chain is entirely intra-iframe; nothing crosses to the host frame except via `VSS.getService`-obtained contributed services (`IHostDialogService`, `IHostNavigationService`).
- `justCreatedTasks` is the one piece of shared state coupling template-creation order to linking correctness — it is local to a single `AddTasks(workItemId)` invocation, not persisted, and dies with the iframe regardless of any caching layer.
- `localStorage`/`ISandboxedStorage` sits *outside* the iframe's lifecycle (host-page- or browser-origin-scoped), which is exactly why it survives what the iframe itself cannot — this is the one piece of extension state that is already decoupled from the fragile contribution surface.

---

## Gaps and Uncertainties

- **No live Azure DevOps org for behavioral verification.** Every popup-close and frame-teardown claim is documentation- and first-principles-based, not observed. This is a project-wide constraint (also noted in the TypeScript migration research) and applies to this task in full.
- **`ms.vss-web.action`-specific dialog-teardown statement not found verbatim.** The strongest available evidence is a documented category contrast (observer vs. form-scoped), not a sentence naming the toolbar-menu/context-menu action type directly.
- **`q` AMD module runtime resolution in the shipped `.vsix` is unconfirmed** — no `q` package or bundled AMD `q` module was found copied into the build output, yet the code depends on it. This is orthogonal to the three sub-questions but relevant to any redesign that touches the promise chain.
- **Whether the toolbar iframe is ever reused (vs. always freshly created) across repeated clicks is unresolved.** `extensionReusedCallback` exists in the SDK and hints reuse is a real possibility, but neither the lifecycle nor storage gatherer could confirm it applies to this contribution type. This affects only the viability of an in-memory cache layered on top of `localStorage` — not the core recommendations.
- **`IExtensionDataService` byte-size quotas and manifest-scope requirements are unconfirmed** — low priority since `localStorage` is the recommended mechanism regardless.
- **Whether the shimmed or native `localStorage` path is active in the real deployment target** is unconfirmed — narrow risk (a 50ms write-loss race), not decision-relevant at the recommendation level.

---

## Synthesis by Framework (Mixed: Technical + Platform Capability)

### Component Analysis
- **What exists**: one contribution (`ms.vss-web.action`), one entry HTML page (`toolbar.html`, no visible DOM), one logic module (`app.ts`, ~630 lines, sequential `Q` chain).
- **How it's structured**: iframe-per-invocation, XDM-bridged to the host frame for the narrow set of "contributed services" (`IHostDialogService`, `IHostNavigationService`, `IExtensionDataService`); everything else (REST calls, DOM, in-memory state) is local to that iframe and dies with it.
- **How it works**: click → AMD load of `scripts/app` → nested sequential REST calls → per-template sequential create+link, with link calls fire-and-forget and untracked.
- **How it integrates**: only with Azure DevOps Work Item Tracking REST APIs (`vso.work`, `vso.work_write` scopes) and the narrow set of host-frame services reachable via `VSS.getService`.

### Pattern Analysis
- Design pattern: linear promise-chain orchestration (`Q.when()` seeded, `.then`-chained) — consistent throughout `app.ts`, no inconsistency across the file.
- Maturity: ad-hoc/established-by-accretion rather than deliberately designed for concurrency or feedback; the parallel fan-outs that do exist (`getTemplates`, `GetChildTypes` sub-categories) show the author *did* use `Q.all` where convenient, making the wholesale serialization of template creates look like an oversight rather than a deliberate constraint (confirmed as only partially necessary, Insight 3).
- Complexity: low — single file, no abstraction layers, easy to reason about exactly because of that.

### Flow Analysis
- Data flow: `workItemId` → parent work item fields → child work-item-type list → per-type templates → per-template child work items → links back to parent and between siblings.
- Control flow: single linear chain today; genuine parallelization opportunities identified at three points (team-settings/work-item fetch; templates-vs-child-types fan-out, already exploited; template-creates without `justCreatedTasks`-referencing rules).
- Error propagation: `createWorkItem`'s rejection handler only `console.log`s (`app.ts:189-198`) — no user-facing error surfacing exists today at all, which is itself a gap relevant to any progress-UI design (a "5 of 6 created, 1 failed" state needs to be representable).

### Constraint Analysis (platform capability)
- **Technical constraints**: no backend/server available (stateless browser extension); pinned SDK v1.104.0 (older generation, lacks `HostPageLayoutService`/toast APIs present in the newer `azure-devops-extension-sdk`); AMD/RequireJS module system; ES2015 compile target (native `Promise`/`async`/`await` are safe to adopt).
- **Platform constraints**: extension code only runs inside a hosted iframe; no detached/background execution mode exists in this SDK generation; only contributed services reach the host frame, and most of those (dialogs) are modal.
- **Business/scope constraints** (per research brief): full TypeScript migration and server-side changes are explicitly out of scope for this research.

### Applicability Assessment
- What fits: `localStorage` caching, safe partial parallelization of the create chain, and a modal end-of-run summary all fit within the current architecture with no manifest change.
- What doesn't fit without a bigger change: true pre-click preload, a genuinely visible non-blocking progress bar, and dialog-close-resilient background completion all require adding a contribution surface not scoped to the work-item dialog.
- Recommendation for solution design: treat this as two tracks — ship the no-manifest-change improvements first (they are net-positive regardless of what happens next), and separately evaluate the new-contribution-surface investment as the resolution for (b) and (c), since it delivers all three benefits at once rather than three separate point solutions.

---

## Conclusions

### Primary conclusions
1. The current click-to-first-task delay is fully explained by a strictly sequential `Q`-promise chain with two needlessly nested-but-independent REST calls and a wholesale (rather than selectively) serialized per-template create loop, with zero UI feedback anywhere in the flow. (High confidence, direct code citations.)
2. The extension's single contribution type structurally cannot satisfy "preload before click," "visible non-blocking progress," or "survive popup close" without adding a persistent/visible contribution surface — this is the shared root constraint behind all three sub-questions. (Medium-High confidence, convergent evidence from three independent platform-capability investigations.)
3. Meaningful, lower-risk improvements are available today without any manifest change: `localStorage`-based template caching (helps click #2 onward), parallelizing the two independent REST calls, selectively parallelizing template creates that don't depend on `justCreatedTasks`-derived linking rules, and a modal end-of-run summary dialog. (High confidence for mechanisms; the aggregate perceived-speed improvement is not independently measured.)

### Secondary conclusions
- The popup-close bug is likely *already* occurring on ordinary dialog close today, not only on some larger "popup" event — the user's own framing ("stops only on a full page refresh") describes the desired end state of a future fix, not the current behavior.
- Link creation is already fire-and-forget and off the critical path for "next template," but nothing tracks true end-of-batch completion — any progress UI needs a new aggregate-completion signal that doesn't exist in the code today.
- Error handling is effectively silent today (console-only); a progress/feedback redesign should also address surfacing partial-failure state, since the brief's "in flight" progress implicitly requires representing failures, not just successes.

### Direct answer to the research question
(a) Full "preload after plugin load" is not reachable for the current contribution type; the practical path is cache-after-first-click (`localStorage`, no manifest change, helps click 2+) plus safe partial parallelization of the create/link chain (parallelize `getTeamSettings`/`getWorkItem`; selectively parallelize template creates without `justCreatedTasks`-dependent `linkTo` rules) — true pre-click preload requires a new, earlier-loading contribution.
(b) No built-in control gives a visible, non-blocking, in-flight progress indicator without a new visible contribution surface; `IHostDialogService.openMessageDialog` is available today but is modal and better suited to a final summary than live progress.
(c) The root cause of popup-close breakage is that the extension's only contribution type is form/dialog-scoped and is torn down (aborting in-flight REST calls) when that dialog closes; the only documented path to "survives until full page refresh" is moving the triggering/execution surface to a contribution type not scoped to the work-item dialog (e.g., a hub), since the SDK provides no detached-execution mode.

### Recommendations (for the downstream brainstorming/design phase)
1. Ship the no-manifest-change improvements first: `localStorage` template caching, parallelize the two independent REST calls, selectively parallelize non-ordering-dependent template creates, and a modal completion/error summary dialog.
2. Evaluate a new persistent/visible contribution surface (hub or work-item-form-page) as a single architectural investment that resolves (b) and (c) together and upgrades (a) to true pre-click preload — present this as one decision, not three separate ones, since all three gatherers converged on the same fix.
3. Before implementation, verify live (in a real ADO org) whether dialog close actually tears down the toolbar/context-menu action's iframe as documented evidence suggests — this is the one load-bearing claim not yet empirically confirmed.
