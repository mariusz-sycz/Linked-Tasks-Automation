# Gap Analysis: Speed Up Task Creation + Modularize app.ts

## TL;DR
Nothing the 5 speed-up/reliability changes need is missing at the platform level (fetch/localStorage/native Promise/SDK dialog/token APIs all resolve today with zero config change) — the gap is entirely implementation work inside `src/scripts/app.ts`, most of it net-new (template cache, keepalive fetch client, progress dialogs, template classifier, failure aggregation) rather than modification of existing logic. The user-added modularization scope is the dominant risk driver: it touches literally every function in the file (including ones the research design explicitly called "unaffected/untouched"), on a file with zero test coverage, and surfaces one real structural hazard — module-level mutable state (`let ctx: WebContext`) shared by several "pure, untouched" helper functions — that the research's Integration Points table didn't anticipate because it assumed a single-file edit. Two decisions need the user's input before planning/implementation can proceed cleanly: (1) whether to modularize before, after, or interleaved with the 5 behavioral changes, and (2) how to handle the shared `ctx` state across the new module boundary.

## Key Decisions
- Treat the 5 speed-up/reliability changes as the primary behavioral gap and the modularization as an orthogonal structural gap — they compose but should be reasoned about (and likely sequenced) separately, since one is behavior-preserving-by-definition and the other deliberately changes behavior.
- Model the module split around the research design's existing "Key Components" table (Template Cache, Keepalive Fetch Client, Auth Token Provider, Progress Dialog Controller, Template Classifier) plus natural groupings of the currently-untouched pure helpers — this reuses design work already done rather than inventing a new boundary scheme from scratch.
- Flag the module-level `ctx` global as a first-class structural risk, not a footnote — it's read by functions the research doc calls "unaffected" (`createWorkItemFromTemplate`, `getTemplate`, `getTemplates`) and by `AddTasks`, so any module split touches their file location and import surface even though their logic bodies stay identical.

## Open Questions / Risks
- The 4-hour `localStorage` TTL cache has no manual "clear cache" affordance if a template is edited mid-window — this is an already-accepted trade-off from the research phase (ADR-003), re-surfaced here only because the Data Lifecycle module's framework would otherwise flag it as a gap; not treated as a new decision.
- `GetChildTypes` (×3 call sites) and `createWorkItem` (×1 call site) call `VSS.getWebContext()` directly instead of reusing the module-level `ctx` — a pre-existing inconsistency that the module split must preserve exactly, not "clean up" as a drive-by.
- AMD/RequireJS cross-file relative `import`/`require` resolution for the new module boundary is expected to work transparently (confirmed via `tsconfig.json`'s glob `include` and `toolbar.html`'s path-based `VSS.require`), but has never been exercised in this repo (currently one `.ts` file) — recommend smoke-testing the pattern with the first extracted file before committing to the full ~13-file split.

## Summary
- **Risk Level**: High
- **Estimated Effort**: High
- **Detected Characteristics**: modifies_existing_code, creates_new_entities, involves_data_operations, has_reproducible_defect

## Task Characteristics
- Has reproducible defect: yes — the popup-close data-loss bug is a real, confirmed defect (user-reported, root-caused in research, with concrete manual reproduction steps — see Defect Analysis below). "Reproducible" here means manually, deterministically reproducible; no automated repro exists because no test framework exists in the project (confirmed, zero drift from codebase analysis).
- Modifies existing code: yes — every touched behavior (caching, transport, dialogs, parallelization) lives inside the existing `AddTasks`/`createWorkItem`/`linkItems`/`create` functions; the modularization scope additionally relocates every remaining function in the file.
- Creates new entities: yes — five genuinely new components with zero existing precedent in the file (Template Cache, Keepalive Fetch Client, Auth Token Provider, Progress Dialog Controller, Template Classifier), plus ~13 new source files as a direct consequence of the modularization scope.
- Involves data operations: yes — `localStorage`-backed template caching is a client-side data lifecycle (write-on-miss, read-with-TTL-check, implicit expiry) even though it has no user-facing CRUD UI; see Data Lifecycle Analysis below for why the standard CRUD/orphan framework only partially applies.
- UI heavy: no — the two `openMessageDialog` calls are native SDK modal dialogs invoked with a plain message string; no template/view/component/stylesheet files exist or are touched, no routes/forms/buttons/nav change. Doesn't meet the `ui_heavy` detection bar (no component files, no styling, no navigation change) even though there is a small, real user-visible surface change (see User Journey Impact).

## Gaps Identified

### Missing Features (net-new, zero existing precedent)
- **Template Cache**: No caching layer exists today — every invocation re-fetches templates fresh (`app.ts:510-538`, `495-498`). Needs: `localStorage` read/write, TTL check, cache key scheme scoped by `project.id`/`team.id`/work-item-type (per design ADR-003).
- **Keepalive Fetch Client**: No raw `fetch` usage exists today — all writes go through `witClient.createWorkItem`/`witClient.updateWorkItem` (SDK-wrapped, `app.ts:110`, `217`). Needs: `fetch(url, {..., keepalive:true})` with a `Bearer` token, JSON-Patch body construction reusing the existing shape, and the exact endpoint/`api-version` (must be captured live — confirmed not derivable from source, per codebase analysis and design's own Open Questions).
- **Auth Token Provider**: `VSS.getAccessToken()` has zero existing usage anywhere in the repo (confirmed by codebase analysis) — needs a thin wrapper feeding the Keepalive Fetch Client's `Authorization` header.
- **Progress Dialog Controller**: `IHostDialogService.openMessageDialog()` has zero existing usage — needs a start-dialog call (fire-and-forget, "Creating N tasks...") and a completion-dialog call gated on `Promise.allSettled(...)` of the per-template work, per work item ID (per clarification Q3).
- **Template Classifier**: No independent/ordered split exists today — the current `chain` (`app.ts:61-65`) is fully sequential for every template regardless of whether its `linkTo` rules actually depend on `justCreatedTasks`. Needs new logic scanning each template's `linkTo` array for the six `justCreatedTasks`-dependent rule names vs. everything else.
- **Failure aggregation for the completion dialog**: No mechanism exists today to collect per-template create/link outcomes into a summary — `createWorkItem`'s error branch (`app.ts:189-198`) currently only `console.log`s and is otherwise silently swallowed; `linkItems`'s error branch (`app.ts:223-228`) does the same. Per clarification Q4, the completion dialog must show "N of M tasks created" plus which failed — this requires threading structured success/failure results up through `createChildFromTemplate` → `AddTasks`, which doesn't exist in any form today.

### Incomplete Features (existing, needs restructuring)
- **`getTeamSettings`/`getWorkItem` concurrency** (`app.ts:38-48`): currently nested (`getTeamSettings().then(() => getWorkItem().then(...))`), needs to become concurrent (`Promise.all`/`Q.all`).
- **Per-template create chain** (`app.ts:61-65`): currently one linear `Q.when()`-seeded chain for all templates; needs to split into a parallel-dispatch independent group and a sequential ordered group while preserving today's `justCreatedTasks.push()`-timing-based (not link-write-completion-based) ordering semantics — codebase analysis already confirms this is the correct baseline to preserve, not "fix."

### Behavioral Changes Needed
- **Popup-close survival**: from "any in-flight request is aborted the instant the iframe tears down" to "requests already dispatched via `fetch(keepalive:true)` survive teardown; requests not yet dispatched (ordered-group creates waiting on a prior template's response, and any not-yet-dispatched link-to-parent/`ToAllOtherChilds` call) remain exposed" — a partial, explicitly-accepted improvement (ADR-002, clarification Q2), not a full guarantee.
- **Error visibility**: from "silent, console-only" to "surfaced in the completion dialog as a partial-failure summary" (clarification Q4) — the first user-facing error surface this extension has ever had.
- **Structural organization** (modularization): from "one 629-line file, functional style, no module boundaries" to "~13 files with explicit `import`/`export` boundaries, entry point unchanged." This is intended to be 100% behavior-preserving — see User Journey Impact for why that's the actual bar for success here, not a source of new features.

## Modularization: Proposed Module Boundary

Grounded in the research design's existing Key Components table (`high-level-design.md`, lines 131-141) plus grouping the currently-untouched pure helpers by natural cohesion. All files live under `src/scripts/` (flat, no subfolder — see Decisions Needed for whether to keep it flat) and compile via the existing `tsconfig.json` glob (`include: ["scripts/**/*.ts"]`, zero config change needed):

| New file | Contents (moved from app.ts unless marked "new") | Depends on |
|---|---|---|
| `app.ts` (**stays at this exact path — AMD module id `scripts/app` is load-bearing, `toolbar.html:21` requires it by this exact string**) | `create()` (611-628); becomes the thin orchestrator entry point | orchestrator module, context |
| `orchestrator.ts` | `AddTasks()` (24-70), wired to Template Cache / Template Classifier / Progress Dialog Controller | context, templates, childTypes, templateClassifier, workItemCreation, progressDialogController, templateCache |
| `context.ts` (**new**, structural) | Module-level `ctx: WebContext` state, currently `app.ts:22` + `create()`'s assignment at `app.ts:615` | VSS SDK only |
| `types.ts` (**new**, structural) | `WitClient`, `WorkClient`, `WorkItemFields` type aliases (`app.ts:10-20`) | SDK ambient typings only |
| `logging.ts` | `logInfo`/`logError` (603-609) | none |
| `templateCache.ts` (**new code**) | Template Cache component — `localStorage` read/write/TTL | context, types |
| `keepaliveFetchClient.ts` (**new code**) | Keepalive Fetch Client — `fetch(..., keepalive:true)` for create/link | authTokenProvider, types |
| `authTokenProvider.ts` (**new code**, small — see Decisions Needed on merging) | `VSS.getAccessToken()` wrapper | VSS SDK only |
| `progressDialogController.ts` (**new code**) | Start/completion `openMessageDialog` calls | VSS SDK only |
| `templateClassifier.ts` (**new code**) | Independent-vs-ordered `linkTo` rule scan | types |
| `workItemCreation.ts` | `createWorkItem` (104-199), `createChildFromTemplate` (72-83), `getRelatedWorkItems` (85-102), `linkItems` (201-229) | keepaliveFetchClient, templateBuilder, templateFilters, context, logging |
| `templateBuilder.ts` | `createWorkItemFromTemplate` (231-282, pure JSON-Patch builder — **reads `ctx.user.uniqueName` at line 271**) | context, types |
| `templateFilters.ts` | `checkRules` (284-300), `IsValidTemplateWIT` (302-352), `matchField` (354-388), `IsValidTemplateTitle` (390-414), `IsPropertyValid` (456-471), `replaceReferenceToParentField` (473-484), `extractJSON` (416-445), `IsJsonString` (447-454) — matches the design's own "filter/template-matching helpers" grouping (Integration Points table, last row) | logging |
| `childTypes.ts` | `GetChildTypes` (541-601, **contains the known, explicitly out-of-scope `bugsBehavior` bug — move verbatim, do not touch**), `findWorkTypeCategory` (486-493) | VSS SDK only (calls `VSS.getWebContext()` directly, does not use `ctx`) |
| `templates.ts` | `getTemplate` (495-498), `getTemplates` (510-538), `SortTemplates` (501-508) — natural place to add the Template Cache's cache-check-first wrapper (ADR-003) | context, types, templateCache |

Dependency graph is a DAG (verified by hand from the table above): `context`/`types`/`logging` sit at the base with no internal dependencies; `templateFilters`/`templateBuilder`/`childTypes`/`templates`/`templateCache`/`authTokenProvider`/`keepaliveFetchClient`/`templateClassifier`/`progressDialogController` depend only on the base layer; `workItemCreation` depends on several of those; `orchestrator` depends on everything; `app.ts` depends only on `orchestrator` and `context`. No circular imports are required by this boundary — worth re-verifying once the actual extraction starts, since it's easy to accidentally introduce a cycle (e.g., if `templateFilters` ever needed something from `workItemCreation`).

### Risks of splitting a working, well-understood, zero-test-coverage file
- **No regression safety net for extraction errors**: the TypeScript compiler will catch missing imports/wrong types, but not semantic drift — e.g., accidentally changing which `ctx` snapshot a function reads, or silently "fixing" the `VSS.getWebContext()` vs. `ctx` inconsistency noted above while relocating code. Every one of the ~13 files needs a manual before/after behavioral check, not just a compile check.
- **Module-level mutable state (`ctx`) crossing file boundaries**: today it's a single-file global; after the split it becomes cross-file shared state, imported by `orchestrator.ts`, `templateBuilder.ts`, `templates.ts`. This is the same fragility as today (nothing gets worse functionally) but it becomes visible/explicit as an `import` — genuinely new territory for this codebase (no existing precedent for shared mutable module state across files) and worth a deliberate choice rather than an incidental one (see Decisions Needed).
- **AMD/RequireJS untested pattern**: the repo has never had more than one `.ts` file, so cross-file relative `import`/`require` resolution under `module: "amd"` has never been exercised here, even though it's expected to work transparently (TypeScript compiles each file to its own anonymous `define()`, RequireJS resolves by request path — the same mechanism already proven for the external `TFS/*`/`q` module imports, just not yet for same-directory relative imports). Low probability of failure, but zero local precedent to lean on, and the manual-only verification loop makes a build-time surprise here costly to diagnose blind.
- **Build pipeline**: confirmed low-risk — `gruntfile.js`'s `exec:tsc` runs `tsc -p tsconfig.json` against the existing glob `include: ["scripts/**/*.ts"]`, so new files are picked up automatically; `copy:static` only copies `toolbar.html`/`vss-extension.json`/`VSS.SDK.min.js`, never referenced `app.ts` by name. No gruntfile or tsconfig changes needed for the split itself.
- **Verification cost multiplies**: the original 5-change scope already required manual-only verification (no test framework). Modularizing the entire file roughly triples the number of relocated call sites needing a "still behaves identically" check, on top of the 5 behavioral changes' own verification — this is the main driver behind the High risk/effort rating, more than any single technical unknown.

## User Journey Impact Assessment
(modifies_existing_code — internal reliability/perf work, not a new user-facing entity, but real before/after user experience exists)

| Dimension | Before | After | Assessment |
|-----------|--------|-------|------------|
| Reachability | Same toolbar/context-menu action, single click | Unchanged — same trigger, same entry point (`create(context)`, AMD id `scripts/app`, both load-bearing constraints preserved) | ✅ no change |
| Discoverability | N/A — no feedback of any kind after clicking | Two modal dialogs appear automatically (start, then completion) — not something the user "finds," just something that now happens | ✅ improvement, not a discoverability question (no new control to discover) |
| Flow Integration | Click → silence → (maybe) tasks appear later; closing the popup immediately could silently drop tasks with zero indication | Click → immediate "Creating N tasks..." acknowledgment → (if popup stays open) "N of M created" / failure summary; tasks created via already-dispatched requests now survive popup close | ✅ positive — no new required steps, same one-click model, adds acknowledgment + failure visibility that didn't exist |
| Multi-Persona | Single persona (any user with template-linked-task create permission) | Unchanged — no persona-specific behavior introduced | ✅ no change |

Modularization itself is designed to be **completely invisible** to this table — its entire purpose is zero user-facing effect. Any user-visible difference traceable to the file split (as opposed to the 5 behavioral changes) is a regression, not a feature.

## Data Lifecycle Analysis
(involves_data_operations — client-side cache, not a user data entity; standard CRUD/orphan framework applies only partially, noted below)

### Entity: cached template list (`localStorage`, keyed by project/team/work-item-type)

| Operation | Backend | UI | Access | Status |
|-----------|---------|-----|--------|--------|
| CREATE (write on miss) | `localStorage.setItem` with timestamp — new code, Template Cache component | none (invisible background write) | N/A — not user-triggered directly, happens as a side effect of template resolution | ✅ planned, no gap |
| READ (check on every invocation) | `localStorage.getItem` + TTL freshness check — new code | none | N/A | ✅ planned, no gap |
| UPDATE | Not applicable — re-populated wholesale on next miss, no partial-update path | — | — | N/A by design |
| DELETE / invalidate | TTL-based only (stale entries are treated as a miss and overwritten, never explicitly deleted); **no event-driven invalidation and no manual "clear cache" affordance** | none | none | ⚠️ accepted gap, already decided upstream (ADR-003) — see Open Questions/Risks, not re-opened as a new decision here |

**Why the standard CRUD-completeness/orphan framework only partially applies**: this entity has no user-facing display or input surface by design — it's a performance cache, not a piece of domain data the user creates/views/edits. "READ without CREATE UI" / "CREATE without READ UI" orphan patterns don't map onto it because there was never meant to be a UI layer here. The one real gap in the standard sense — no way to force-bypass a stale cache — was already surfaced and explicitly deferred in the research phase (high-level-design.md's Out of Scope), so it is reported here for completeness but not raised as a new `decisions_needed` item.

**Completeness assessment**: functionally complete for its intended scope (write-on-miss, TTL-gated read) once implemented; the only "incomplete" edge relative to a full CRUD entity (manual invalidation) is a knowingly-accepted trade-off, not an implementation gap to close now.

## Defect Analysis
(has_reproducible_defect — the popup-close data-loss bug)

### Reproduction Data
- **Steps**: On a parent work item with 2+ child templates where at least one template alphabetically after another has a `linkTo` rule referencing a `justCreatedTasks`-derived helper (e.g., `PreviouslyCreatedTask`), click "Create linked tasks," then close the work-item popup/dialog shortly after (before the first template's create response has been read).
- **Inputs**: Parent work item ID; ≥2 matching templates sorted alphabetically with an ordering dependency between them.
- **Expected**: All matching templates are created and linked, regardless of when the popup is closed.
- **Actual (today, pre-fix)**: The iframe tears down on popup close, aborting all in-flight `witClient`-wrapped REST calls immediately — any template create not yet responded to, and any dependent template waiting in the sequential chain, is silently never created. No error, no partial-success indication; the user has no way to know tasks are missing without manually checking.
- **Actual (post-fix, accepted partial improvement per ADR-002/clarification Q2)**: Requests already dispatched via `fetch(keepalive:true)` before teardown complete server-side regardless of popup state; requests not yet dispatched at teardown (ordered-group creates awaiting a prior response, and any not-yet-dispatched link-to-parent/`ToAllOtherChilds` link) remain exposed — same failure mode, narrower window. This is a designed, communicated limitation, not a bug to fully close in this task.

### Root Cause Hypothesis
Confirmed by research: the extension's single `ms.vss-web.action` contribution has no persistent lifecycle independent of the popup/dialog that hosts it — closing that host tears down the iframe, which aborts any REST call still in flight via the SDK's wrapped client (standard `fetch`/XHR-on-iframe-removal browser behavior). `fetch(keepalive:true)` addresses the "already dispatched" half of this; there is no mechanism in the no-new-surface design that can address the "not yet dispatched when torn down" half without escalating to a Hub/Hybrid architecture (rejected, ADR-001).

### Regression Risk Areas
- `createWorkItem`'s `linkTo` rule branches (`app.ts:122-188`) — six near-identical `if/else if` blocks, easy to introduce an off-by-one or copy-paste error when relocating alongside the transport-layer swap (SDK client → keepalive fetch) and the ordered/independent group split, simultaneously.
- `justCreatedTasks` indexing (`justCreatedTasks.length - 2`, `- 3`, `[0]`, `[1]`) — must retain identical timing semantics (push happens synchronously inside the create-success callback) once the ordered group is restructured to use native `Promise`s instead of the current `Q` chain.
- The pre-existing "fire-and-forget" behavior of `linkItems` calls within `createWorkItem` (never awaited by the outer chain today) — must be preserved exactly, not accidentally "fixed" into an awaited call, since that would be an unscoped behavior change with its own regression surface.

## Issues Requiring Decisions

### Critical (Must Decide Before Proceeding)

1. **Sequencing: modularize vs. implement the 5 behavioral changes — which first?**
   - Options:
     - **(A) Modularize first** (pure, behavior-preserving refactor across all ~13 files), manually verify the app still behaves identically to today, *then* implement the 5 behavioral changes into the new module structure.
     - **(B) Implement the 5 changes first** inside the existing monolithic file (as the research originally scoped), verify, *then* modularize as a final behavior-preserving pass.
     - **(C) Interleave**: write each new component (cache, keepalive client, dialogs, classifier) directly into its own new file from the start, and extract related pre-existing functions into sibling files as they're touched along the way.
   - Recommendation: **(A)**. With zero automated tests, the ability to bisect "is this regression from the refactor or from the new behavior" is the single biggest debugging lever available — Option A gives a clean, independently-verified baseline before any behavior changes; Option C conflates the two kinds of risk in the same verification pass and would be hardest to debug if something breaks.
   - Rationale: this changes the shape of the implementation plan's task groups fundamentally (separate modularization task groups gated on their own verification, vs. behavioral task groups that also happen to create new files) — needs to be settled before specification/planning.

2. **How should the shared `ctx: WebContext` module-level state be handled across the new module boundary?**
   - Options:
     - **Keep as shared exported state in `context.ts`** (e.g., `export let ctx: WebContext`, set once by `create()`, imported and read directly by `orchestrator.ts`, `templateBuilder.ts`, `templates.ts`) — minimal diff, preserves the exact current global-state pattern, just relocates it.
     - **Refactor to explicit parameter-passing** — thread `ctx`/`project`/`team` as parameters through every function that needs it, including `createWorkItemFromTemplate`, `getTemplate`, `getTemplates` — the research design's Integration Points table explicitly lists these as "unaffected... untouched," but that assumed a single-file edit; a parameter-threading refactor would change their signatures, which is arguably no longer "untouched" even if their logic is behavior-identical.
   - Recommendation: **keep as shared module state** (first option) — it minimizes the diff to functions the research explicitly scoped as untouched, and doesn't introduce a signature-changing refactor that wasn't asked for. Flagging because it's a real tension between "modularize everything" and "leave the untouched functions alone" that the research phase couldn't have anticipated.

### Important (Should Decide)

1. **New file naming/foldering convention**: flat under `src/scripts/` (e.g., `src/scripts/templateCache.ts`) vs. a subfolder (e.g., `src/scripts/modules/templateCache.ts`).
   - Default: flat, camelCase filenames matching the dominant existing convention (`getTemplate`, `createWorkItem`) — 13 files is small enough that a subfolder isn't yet earning its complexity, consistent with the minimal-implementation standard's guidance against unnecessary structure.

2. **Extract shared types into their own file?** (`WitClient`, `WorkClient`, `WorkItemFields`, currently `app.ts:10-20`)
   - Default: yes, into `types.ts` — needed by nearly every proposed module; avoids duplicate type declarations or accidental drift between files.

3. **Preserve the pre-existing `VSS.getWebContext()` vs. module-level `ctx` inconsistency exactly as-is, or normalize it while modularizing?** (`GetChildTypes` calls `VSS.getWebContext()` directly ×3, `createWorkItem` does the same ×1, instead of reusing `ctx`.)
   - Default: preserve exactly as-is; treat any normalization as separate, explicitly-scoped follow-up work, not a drive-by during the module split.

4. **Granularity of the module split**: the ~13-file breakdown above (one file per Key Components table entry plus grouped pure helpers) vs. a coarser split (e.g., fold `authTokenProvider.ts` into `keepaliveFetchClient.ts` since it's a ~5-line wrapper; fold `templateClassifier.ts` into `orchestrator.ts`).
   - Default: the ~13-file breakdown as proposed — it mirrors design work already done (Key Components table) and groups pure helpers by the design's own "filter/template-matching helpers" phrasing, but this is a judgment call the user may reasonably want coarser.

## Recommendations
- Resolve the two critical decisions (sequencing, `ctx` handling) before specification — both materially reshape the implementation plan's task-group structure.
- Treat modularization as its own verifiable milestone (manual smoke test: click → same network calls, same console output, same created/linked work items as today) independent of the 5 behavioral changes' own verification.
- Smoke-test the AMD cross-file `import`/`require` pattern with a single extracted file (e.g., `logging.ts`, lowest-risk, zero dependencies) before committing to extracting all ~13 files, given this repo has never exercised same-directory relative imports under `module: "amd"` before.
- Do not use the module split as an opportunity to also fix the `GetChildTypes` `bugsBehavior` bug or normalize the `ctx`-vs-`VSS.getWebContext()` inconsistency — both are explicitly out of scope and would conflate unrelated behavior changes with a refactor that's supposed to be behavior-preserving.
- Keep the new components (Template Cache, Keepalive Fetch Client, etc.) as concrete, single-purpose modules rather than introducing speculative abstraction (e.g., a generic pluggable-cache-backend interface) — consistent with the project's minimal-implementation standard and the fact that `localStorage` is the only backend this design needs.

## Risk Assessment
- **Complexity Risk**: High — full-file decomposition into ~13 files, a concurrency-model rewrite (sequential → parallel/sequential split), and a REST transport swap (wrapped client → raw fetch), landing together in the same task.
- **Integration Risk**: Low-Medium — single external consumer (`toolbar.html`), single public entry point, AMD module resolution via `tsconfig.json`'s existing glob include confirmed to need zero config changes; the untested part (cross-file relative imports under this project's specific AMD setup) is a new pattern for this repo but a standard, well-understood one for TypeScript/RequireJS generally.
- **Regression Risk**: High — zero automated tests against a diff that now spans the entire file rather than 5 touched regions; manual live-org verification is the only safety net, and its cost scales with the (now much larger) number of relocated call sites, not just the 5 new behaviors.
