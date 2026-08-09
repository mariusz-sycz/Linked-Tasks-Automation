# Research Plan: Speed Up Task Creation, Add Progress Feedback, Fix Popup-Close Reliability

## TL;DR
Mixed research: verify the click-to-first-task delay directly in `src/scripts/app.ts` (a single strictly-sequential `Q` promise chain — team settings → parent work item → child types → templates → per-template create → link — with zero UI feedback), then pair that with VSS SDK platform research (bundled typings + official Microsoft Learn docs) on async/background execution limits, client-side caching surfaces, built-in progress-UI controls, and iframe/panel lifecycle semantics. Four gatherers: one on the existing codebase, three on platform capabilities (async/lifecycle, storage/caching, progress-UI), since the local `vss-web-extension-sdk` typings already surfaced concrete candidate APIs for all three but the popup-survival question needs external/platform-doc confirmation the typings can't fully answer. Small project (single ~630-line source file) — gatherer count kept low to match scope.

## Key Decisions
- **Codebase gatherer scoped to app.ts + build/manifest files only** — this is the entire runtime logic surface (no other modules); build/config files matter because they define what ships and how the extension is loaded/hosted.
- **Platform research split into 3 gatherers by capability area (async/lifecycle, storage, progress-UI)** rather than 1 generic "external" gatherer — the local SDK typings (`vss-web-extension-sdk/typings/vss.d.ts`) already point to distinct, non-overlapping API families (`IExtensionDataService`/`ISandboxedStorage` vs. `VSS/Controls/StatusIndicator` vs. iframe/XDM handshake + `IExtensionInitializationOptions`) worth investigating independently.
- **Lifecycle/popup-survival gatherer must use WebSearch/WebFetch against Microsoft Learn / Azure DevOps extension docs**, not just local typings — the typings describe API shape but not iframe teardown/reuse semantics when a work item is opened in a peek/panel view, which is the crux of finding (c).
- **No dedicated "documentation" gatherer** — project docs (vision/roadmap/tech-stack) are already read and summarized in this plan/sources file; the standards folder has no backend-async or lifecycle guidance to add. Folding a thin documentation pass into the codebase gatherer avoids a near-empty instance.

## Open Questions / Risks
- Whether the "popup panel" in the brief refers to Azure DevOps's work-item **peek/dialog view** (opened via `openWorkItem`/`openNewWorkItem` dialog) or a **linked-item panel opened on top of another work item** — the codebase gatherer should capture exact contribution targets (`ms.vss-work-web.work-item-toolbar-menu`, `ms.vss-work-web.work-item-context-menu`) so the lifecycle gatherer can map them precisely to the correct Azure DevOps host UI surface.
- No Azure DevOps org is available for live behavioral verification (same limitation noted in `roadmap.md` for the TypeScript migration) — all findings will be evidence/documentation-based with explicit confidence levels, not live-tested.
- `vss-web-extension-sdk` is pinned at `v1.104.0`; external platform docs may describe newer SDK behavior. Gatherers must note version applicability when citing external sources.

## Research Overview

**Research question**: How can the Linked Tasks Automation extension be changed to (a) preload/cache templates asynchronously after plugin load and create child tasks + links asynchronously so the user isn't blocked waiting after clicking "create"; (b) surface a visible, non-blocking progress indicator while creation is in flight; and (c) keep creating tasks in the background even if the Azure DevOps popup panel hosting the extension is closed, stopping only on a full page refresh?

**Research type**: Mixed — technical codebase analysis (how creation currently works) + platform/SDK capability research (what the Azure DevOps Extension SDK allows for async work, caching, progress UI, and iframe lifecycle).

**Scope**: See `planning/research-brief.md` for full included/excluded/constraints. In short: browser-only, VSS SDK v1.104.0, AMD/RequireJS, `src/scripts/app.ts` is the only logic module; TypeScript migration itself and any server-side change are out of scope.

## Methodology

**Primary approach**: Evidence-based technical + platform capability research.
1. Read `src/scripts/app.ts` end-to-end to trace the exact call graph from button click to last REST call, annotating every async boundary and every synchronous/blocking gap.
2. Cross-reference the entry point (`toolbar.html` → `VSS.require`/`VSS.register` → `app.create`) and manifest (`vss-extension.json` contribution targets/scopes) to understand how and when the extension frame is instantiated relative to the host page/popup.
3. Research VSS SDK capabilities for each of the three sub-questions against both the bundled typings (`node_modules/vss-web-extension-sdk/typings/vss.d.ts`, authoritative for what's callable in v1.104.0) and official Microsoft Learn / Azure DevOps extension documentation (authoritative for lifecycle/behavioral semantics not expressed in typings alone).
4. Synthesize trade-offs per option (feasibility within VSS sandboxing, complexity, risk) rather than prescribing a single solution.

**Fallback strategy**: If official Microsoft docs are thin on iframe-survives-popup-close behavior, fall back to (a) Azure DevOps extension SDK GitHub issues/samples, (b) first-principles reasoning from the XDM/postMessage channel model documented in the typings (`IXDMObjectRegistry`, `IHostHandshakeData`, `explicitNotifyLoaded`), clearly flagged as lower-confidence/inferred.

**Analysis framework** (mixed):
- *Technical*: component identification (call graph, promise chain, DOM/iframe structure) → flow analysis (sequential vs. parallelizable steps) → bottleneck/root-cause mapping.
- *Platform capability*: option enumeration per sub-question → constraint check against VSS sandbox/scopes → trade-off table (feasibility, complexity, UX impact, confidence).

## Data Sources

See `planning/sources.md` for the full manifest. Summary by type:
- **Codebase**: `src/scripts/app.ts` (all logic), `src/toolbar.html` (entry point/frame init), `src/vss-extension.json` (contribution targets, scopes, manifest version), `src/gruntfile.js` + `src/configs/*.json` (build/packaging, confirms no server component), `src/package.json`/`src/tsconfig.json` (dependency versions, esp. `vss-web-extension-sdk` and `q`).
- **Local SDK typings** (ground truth for callable APIs in the pinned SDK version): `src/node_modules/vss-web-extension-sdk/typings/vss.d.ts` — `IExtensionInitializationOptions`, `IHostHandshakeData`/`IXDMObjectRegistry`, `IExtensionDataService`, `ISandboxedStorage`, `VSS/Controls/StatusIndicator` (`StatusIndicator`, `LongRunningOperation`, `WaitControl`), `VSS/Controls/Notifications` (`ToastNotification`), `GlobalProgressIndicator`.
- **Project documentation**: `.maister/docs/project/{vision,roadmap,tech-stack}.md` (already read — confirm stateless/no-backend constraint, SDK version, known technical debt), `.maister/docs/standards/build-tooling/packaging.md` (packaging conventions, not directly relevant to async behavior but confirms deployment model).
- **External/platform docs**: Microsoft Learn Azure DevOps extension SDK reference, `VSS.init`/lifecycle documentation, work item form/peek panel behavior, Azure DevOps extension samples repos (GitHub) for progress-indicator and background-task patterns.

## Research Phases

**Phase 1: Broad discovery**
- Enumerate all non-`node_modules` source files (`src/scripts/app.ts`, `src/toolbar.html`, `src/vss-extension.json`, `src/gruntfile.js`, `src/configs/*.json`, `src/package.json`) — already done, listed in sources.md.
- Enumerate relevant typings modules in `vss-web-extension-sdk/typings/vss.d.ts` by grepping for storage, notification/progress, dialog/navigation, and handshake/lifecycle interfaces — already scouted (see Key Decisions).

**Phase 2: Targeted reading**
- Read `app.ts` fully (done) to build the exact call graph: `create()` → `AddTasks()` → `getTeamSettings` → `getWorkItem` → `GetChildTypes` → `getTemplates` → sequential `chain.then(createChildFromTemplate)` loop → `createWorkItem` → `linkItems` (fire-and-forget, no `.then` chained back into the main flow).
- Read the specific typings sections identified: `IExtensionInitializationOptions` (`explicitNotifyLoaded`, `usePlatformScripts`), `IHostHandshakeData`/`IExtensionHandshakeData` (frame handshake, `extensionReusedCallback`), `IExtensionDataService` (account/project/user-scoped document storage), `ISandboxedStorage` (localStorage shim), `VSS/Controls/StatusIndicator` block (`StatusIndicator`, `LongRunningOperation`, `WaitControl` options), `VSS/Controls/Notifications` (`ToastNotification.toast()`).

**Phase 3: Deep dive**
- Trace exactly where the current chain blocks: is it CPU-blocking (no) or just strictly sequential network round-trips with no user feedback and no parallelism across independent template creates?
- Investigate whether `justCreatedTasks`-based linking rules (`ToAllJustCreatedTasks`, `PreviouslyCreatedTask`, etc.) impose a genuine ordering dependency that limits parallelization, vs. which steps (e.g., template fetch, independent child creates with no `linkTo` cross-references) could run concurrently.
- Research platform docs/samples for: (a) whether an extension iframe (loaded via `ms.vss-work-web.work-item-toolbar-menu`/`context-menu` action, hosted via `toolbar.html`) is torn down when a work-item peek/panel is closed, vs. persists until full page navigation; (b) documented patterns for showing a `StatusIndicator`/`WaitControl`/`ToastNotification` triggered from an action contribution without blocking the host; (c) whether `IExtensionDataService` or sandboxed `localStorage` is better suited for template caching (latency, scope, quota, staleness).

**Phase 4: Verification**
- Cross-reference every behavioral claim about iframe/action lifecycle against at least one external Microsoft Learn/SDK source, not inferred from typings alone.
- Where no external confirmation is found, explicitly mark the finding as inferred/lower-confidence per the brief's requirement to assign a confidence level to each finding.
- Sanity-check proposed async/parallel restructuring against the existing linking-rule semantics (no dropped/reordered links).

## Gathering Strategy

### Instances: 4 (max 8)

| # | Category ID | Focus Area | Tools | Output Prefix |
|---|------------|------------|-------|---------------|
| 1 | codebase | Current click-to-create flow in `app.ts`/`toolbar.html`/manifest & build config: exact call graph, async boundaries, blocking points, linking-rule ordering dependencies, contribution targets/scopes | Glob, Grep, Read | codebase |
| 2 | platform-lifecycle | VSS SDK async/background execution model: `VSS.init` options (`explicitNotifyLoaded`, `usePlatformScripts`), XDM frame handshake, action-contribution execution context, and — critically — iframe/panel teardown behavior when a work item opens in a peek/popup panel vs. full page | Read (local typings), WebSearch, WebFetch | platform-lifecycle |
| 3 | platform-storage | Client-side caching options for templates: `IExtensionDataService` (scope, latency, quota), `ISandboxedStorage`/localStorage shim, IndexedDB availability inside the sandboxed extension iframe, and preload-after-`VSS.init` patterns | Read (local typings), WebSearch, WebFetch | platform-storage |
| 4 | platform-progress-ui | Non-blocking progress UI within VSS Controls: `VSS/Controls/StatusIndicator` (`StatusIndicator`, `LongRunningOperation`, `WaitControl`), `VSS/Controls/Notifications` (`ToastNotification`), `GlobalProgressIndicator`, and any host-level status/banner APIs (`IHostDialogService`) suitable for an action-contribution context | Read (local typings), WebSearch, WebFetch | platform-progress-ui |

### Rationale
The codebase is small enough (one logic file) that a single codebase gatherer fully covers source (1). The remaining three map 1:1 to the brief's three sub-questions (a/preload+async, b/progress UI, c/popup survival) and to three distinct, non-overlapping API families already surfaced in the local SDK typings — splitting them avoids one gatherer trying to cover unrelated APIs (storage vs. UI controls vs. lifecycle) shallowly. This keeps the count at 4 rather than the default fallback's `configuration` category (there's no separate config layer beyond what's already covered by the codebase gatherer's build/manifest files) or an `external` catch-all (split by capability instead, since external sources are needed for lifecycle specifically, not uniformly).

## Success Criteria
- The exact current click-to-first-task delay is explained with a concrete call-graph trace citing `app.ts` line ranges (which calls are sequential vs. could be parallel, and why).
- At least 2 concrete options identified for async template preloading/caching, each with trade-offs (staleness, quota, complexity, VSS API used).
- At least 2 concrete options identified for async/parallelized task + link creation, each with trade-offs (ordering-dependency risk given `justCreatedTasks` linking rules, error handling, partial-failure UX).
- At least 2 concrete options identified for non-blocking progress feedback, each mapped to a specific VSS Controls API (`StatusIndicator`/`WaitControl`/`ToastNotification`/other) with trade-offs.
- A root-cause explanation for the popup-close bug, backed by iframe/action-lifecycle evidence (not just speculation), plus at least 1 option for making creation resilient to popup close, with an explicit statement of what "surviving until full page refresh" would require architecturally.
- Every finding carries an explicit confidence level (High/Medium/Low) and a source citation (file path + line, or external URL).

## Expected Outputs
- Research report (`findings.md` or equivalent, produced by the synthesis phase) with root-cause analysis, options with trade-offs, and confidence-rated findings for all three sub-questions.
- No implementation/spec output expected from this research task itself — output feeds a subsequent solution-brainstorming/design phase per the orchestrator workflow.
