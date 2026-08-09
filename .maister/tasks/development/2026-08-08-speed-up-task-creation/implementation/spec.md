# Specification: Speed Up Task Creation, Progress Feedback, Popup-Close Reliability, Modularize app.ts

## TL;DR
Split the single 629-line `src/scripts/app.ts` into 15 flat files under `src/scripts/` — 10 files in Phase A (existing code relocated verbatim, a pure behavior-preserving refactor, verified independently first) and 5 new files in Phase B (created fresh, not pre-created as empty skeletons) — then implement 5 behavioral changes into that structure: `localStorage` template caching (4h TTL), `fetch(keepalive:true)` for create/link REST calls (partial popup-close survival), two `openMessageDialog` calls per work item (start + `Promise.allSettled`-gated completion with a partial-failure summary), parallelized `getTeamSettings`/`getWorkItem`, and a template classifier splitting per-template creates into independent (parallel) and ordered (`justCreatedTasks`-dependent, sequential) groups. `app.ts` keeps its exact path, AMD module id `scripts/app`, and `create(context): void` export. No test framework exists; verification is manual only, against a live Azure DevOps org, reusing the Phase 3 manual reproduction procedure as the Green-gate check.

## Key Decisions
- Modularize first, then add behavior (Critical Decision 1, scope-clarifications.md) — separates refactor risk from behavioral risk into two independently-verifiable passes, the only real bisection lever with zero test coverage.
- Shared `ctx: WebContext` becomes `export let ctx` in a new `context.ts`, read directly by `orchestrator.ts`/`templateBuilder.ts`/`templates.ts` — no parameter-threading refactor of functions the research called "untouched."
- Extraction is incremental: `logging.ts`, `types.ts`, `context.ts` first, to smoke-test the never-before-exercised AMD cross-file `import` pattern in this repo before extracting the rest.
- Native `Promise`/`async`/`await` for all new/touched code; `Q` remains only in relocated-but-otherwise-untouched pure helpers (requirements.md Q2).
- "Ordered group" sequencing is keyed on `justCreatedTasks.push()` timing (synchronous, inside the create-success callback), not on link-write completion — preserves the pre-existing, already-incomplete waiting semantics rather than accidentally fixing them.
- Exact REST endpoint/`api-version`/headers for `createWorkItem`/`updateWorkItem` are not derivable from the repo and must be captured via live devtools network inspection at implementation time (user has confirmed live ADO org access).
- Preserve exactly, do not fix: the `GetChildTypes` `bugsBehavior` enum-vs-string-literal bug, and the `ctx`-vs-`VSS.getWebContext()` inconsistency (`GetChildTypes` calls `VSS.getWebContext()` directly at 10 call sites, `createWorkItem` at 1, instead of reusing `ctx` — verified against the current source; preserve every call site exactly).

## Open Questions / Risks
- The `openMessageDialog` API has no programmatic close handle (confirmed against SDK typings, ADR-004) — dialogs are one-click-dismiss, not auto-closing; this is an accepted, already-communicated limitation, not an open implementation question.
- Popup-close survival remains partial, not a full guarantee: any ordered-group create not yet dispatched at teardown, and any not-yet-dispatched link-to-parent/`ToAllOtherChilds` call, remain exposed (ADR-002, clarification Q2) — already accepted, re-flagged here so the Green-gate check verifies the narrower outcome, not 100% survival.
- The 4-hour `localStorage` TTL has no manual "clear cache" affordance — already-accepted trade-off (ADR-003), not a new decision.
- AMD/RequireJS cross-file relative `import` resolution has never been exercised in this repo (previously one `.ts` file) — the incremental extraction order exists specifically to surface this risk early and cheaply.
- Exact REST endpoint/`api-version`/headers for the Keepalive Fetch Client must be captured live before that component can be implemented — flagged as a hard dependency of Core Requirement 8, not guessable from source.

## Goal
Restructure `src/scripts/app.ts` into a maintainable multi-file module layout, then make "Create linked tasks" faster (cached templates, parallel reads/creates) and more resilient to popup close (keepalive writes, visible progress/failure feedback) — without changing the extension's trigger, entry point, or any behavior not explicitly targeted by the five changes.

## User Stories
- As a user of the "Create linked tasks" action, I want to see immediate on-screen acknowledgment after clicking, so that I know the extension has started working instead of getting silence.
- As a user, I want a completion summary showing how many of my child tasks were created (and which failed, if any), so that I don't have to manually verify every task was created.
- As a user, I want tasks that have already started creating to survive me closing the work-item popup, so that I don't lose work I've already triggered.
- As a user invoking the action repeatedly within a session, I want template lookups to be fast on repeat invocations, so that I'm not waiting on redundant network round trips for data that rarely changes.
- As a maintainer, I want the codebase split into focused, single-purpose files instead of one 629-line file, so that future changes are easier to locate, review, and reason about.

## Core Requirements

### Modularization (Phase A — behavior-preserving, must land and be verified before Phase B)

1. Split `src/scripts/app.ts` into the following **15 files**, all flat under `src/scripts/`, exactly matching the module boundary below. `app.ts` **must keep its exact path and AMD module id `scripts/app`** (`src/toolbar.html:21` depends on this by exact string) and its `export function create(context: any): void` signature.

   **Phase A files** (10 — existing code relocated verbatim, no new logic; these are the ones extracted and verified before Phase B begins):

   | File | Contents (moved from `app.ts`) | Depends on |
   |---|---|---|
   | `app.ts` | `create()` (611-628) — becomes the thin orchestrator entry point | `orchestrator.ts`, `context.ts` |
   | `orchestrator.ts` | `AddTasks()` (24-70) — in Phase A, wired only to the Phase-A files below; gains wiring to the Phase-B files (Template Cache / Template Classifier / Progress Dialog Controller) when Phase B lands | `context.ts`, `templates.ts`, `childTypes.ts`, `workItemCreation.ts` (Phase A); plus `templateClassifier.ts`, `progressDialogController.ts`, `templateCache.ts` (Phase B) |
   | `context.ts` (new file, structural — holds relocated state, no new logic) | Module-level `ctx: WebContext` state (currently `app.ts:22` + the assignment at `app.ts:615`), exported as `export let ctx: WebContext` | VSS SDK ambient typings only |
   | `types.ts` (new file, structural — holds relocated type aliases, no new logic) | `WitClient`, `WorkClient`, `WorkItemFields` type aliases (`app.ts:10-20`) | VSS SDK ambient typings only |
   | `logging.ts` | `logInfo`/`logError` (603-609) | none |
   | `workItemCreation.ts` | `createWorkItem` (104-199), `createChildFromTemplate` (72-83), `getRelatedWorkItems` (85-102), `linkItems` (201-229) | `templateBuilder.ts`, `templateFilters.ts`, `templates.ts` (for `getTemplate`, called at current `app.ts:74`), `types.ts` (for `WitClient`/`WorkItemFields`), `context.ts`, `logging.ts` — **in Phase B additionally depends on `keepaliveFetchClient.ts`**, replacing the direct `witClient.createWorkItem`/`updateWorkItem` calls |
   | `templateBuilder.ts` | `createWorkItemFromTemplate` (231-282, pure JSON-Patch builder; reads `ctx.user.uniqueName` at line 271) | `context.ts`, `types.ts`, `templateFilters.ts` (for `replaceReferenceToParentField`, called at current `app.ts:246`) |
   | `templateFilters.ts` | `checkRules` (284-300), `IsValidTemplateWIT` (302-352), `matchField` (354-388), `IsValidTemplateTitle` (390-414), `IsPropertyValid` (456-471), `replaceReferenceToParentField` (473-484), `extractJSON` (416-445), `IsJsonString` (447-454) | `logging.ts`, `types.ts` (for `WorkItemFields`) |
   | `childTypes.ts` | `GetChildTypes` (541-601, contains the known, explicitly out-of-scope `bugsBehavior` bug — move verbatim, do not fix; calls `VSS.getWebContext()` directly at multiple sites within the function rather than using `ctx` — preserve every call site exactly as-is, do not normalize), `findWorkTypeCategory` (486-493) | `types.ts` (for `WitClient`); VSS SDK ambient typings |
   | `templates.ts` | `getTemplate` (495-498), `getTemplates` (510-538), `SortTemplates` (501-508) — gains the Template Cache's cache-check-first wrapper in Phase B | `context.ts`, `types.ts` — **in Phase B additionally depends on `templateCache.ts`** |

   **Phase B files** (5 — genuinely new code, no existing source to relocate; created fresh when Phase B implements the requirement that needs them, not pre-created as empty skeletons during Phase A):

   | File | Contents (new code) | Depends on |
   |---|---|---|
   | `templateCache.ts` | Template Cache component — see Core Requirement 6 | `context.ts`, `types.ts` |
   | `keepaliveFetchClient.ts` | Keepalive Fetch Client — see Core Requirement 9 | `authTokenProvider.ts`, `types.ts` |
   | `authTokenProvider.ts` | `VSS.getAccessToken()` wrapper | VSS SDK ambient typings only |
   | `progressDialogController.ts` | Start/completion `openMessageDialog` calls — see Core Requirement 11 | VSS SDK ambient typings only |
   | `templateClassifier.ts` | Independent-vs-ordered `linkTo` rule scan — see Core Requirement 8 | `types.ts`, `templateFilters.ts` (for `extractJSON`, reusing the same `linkTo`-parsing path `createWorkItem` already uses) |

   **Phase A vs. Phase B boundary, explicitly**: Phase A extracts and relocates the 10 files above with zero new files beyond `context.ts`/`types.ts` (which hold relocated state/types, not new logic) — the 5 Phase-B files listed above do not exist yet when Phase A completes. Each Phase-B file is created fresh, for the first time, when its corresponding Core Requirement (6, 8, 9, or 11) is implemented — never as an empty placeholder created ahead of need. This keeps Phase A's "behavior-preserving, zero new logic" property literal and avoids violating the minimal-implementation standard's "every new function must have an immediate caller."

2. Extraction is **incremental**, not a single big-bang commit: extract `logging.ts`, `types.ts`, `context.ts` first (lowest-risk, zero/near-zero internal dependencies) and smoke-test that AMD cross-file `import`/`require` resolves correctly under `module: "amd"` (compile via `tsc -p tsconfig.json`, then `grunt serve` + a live manual click-through) before extracting the remaining Phase-A files. This validates a pattern never before exercised in this single-file repo.

3. The dependency graph among the 15 files is a DAG (no circular imports) — see the "Depends on" columns above for the exact edges, including the cross-cutting `types.ts` dependency shared by `workItemCreation.ts`, `templateFilters.ts`, `childTypes.ts`, `templates.ts`, `templateCache.ts`, `keepaliveFetchClient.ts`, and `templateClassifier.ts`. Base layer (no internal dependencies): `context.ts`, `types.ts`, `logging.ts`. Verify no cycle is introduced during extraction — in particular, `templateBuilder.ts` → `templateFilters.ts` and `templateClassifier.ts` → `templateFilters.ts` must not be met by any reverse edge from `templateFilters.ts` back to either.

4. Each relocated function keeps its existing logic body, name, and behavior byte-for-byte (aside from the file it lives in and its `import`/`export` wiring) during Phase A. Phase A must **not**: fix the `GetChildTypes` `bugsBehavior` bug, normalize the `ctx`-vs-`VSS.getWebContext()` inconsistency (including all of `GetChildTypes`'s multiple direct `VSS.getWebContext()` call sites, not just a subset), change naming conventions (mixed `camelCase`/`PascalCase` stays mixed), or otherwise "clean up" anything not explicitly listed above.

5. `tsconfig.json`'s existing glob `include: ["scripts/**/*.ts"]` already picks up new files with zero config change; `gruntfile.js`'s `exec:tsc` and `copy:static` tasks need no changes for the split itself (confirmed — `copy:static` only copies `toolbar.html`/`vss-extension.json`/`VSS.SDK.min.js`, never `app.ts` by name).

### Behavioral Changes (Phase B — implemented into the Phase A module structure)

6. **Template Cache** (`templateCache.ts`, wired into `templates.ts`): before calling `getTemplates`/`getTemplate`, check `localStorage` for a fresh (within-TTL) entry keyed by `(project.id, team.id, childTypes)` (per ADR-003). On hit, skip the REST round trip and use the cached template references/bodies. On miss, call through to the existing wrapped `witClient` calls as today, then write the result to `localStorage` with a timestamp. TTL default is 4 hours. No event-driven invalidation and no manual "clear cache" affordance — explicitly out of scope (ADR-003, already accepted).

7. **`getTeamSettings`/`getWorkItem` parallelization** (`orchestrator.ts`): replace the current nested structure (`workClient.getTeamSettings(team).then(() => witClient.getWorkItem(workItemId).then(...))`, `app.ts:38-48`) with concurrent dispatch (`Promise.all`), preserving identical downstream data usage.

8. **Template Classifier** (`templateClassifier.ts`): scan each template's `linkTo` rules (same JSON extracted by `IsValidTemplateWIT`/`createWorkItem` via `extractJSON`) and classify a template as **ordered** if any `linkTo` entry references one of these six `justCreatedTasks`-derived rule names (case-insensitive, matching existing comparison style): `ToAllJustCreatedTasks`, `PreviouslyCreatedTask`, `PreviouslyJustCreatedTask`, `SecondPreviouslyJustCreatedTask`, `FirstJustCreatedTask`, `SecondJustCreatedTask`. Every other template (including `ToAllOtherChilds` and templates with no `linkTo`) is **independent**. This classification feeds `orchestrator.ts`'s dispatch split (Core Requirement 10) and must stay in sync with `createWorkItem`'s `linkTo` branch logic if that logic is ever extended later (not in this task's scope, but noted for maintainers per ADR-005 consequences).

9. **Keepalive Fetch Client** (`keepaliveFetchClient.ts`): replace `witClient.createWorkItem(...)` (`app.ts:110`) and `witClient.updateWorkItem(...)` (used by `linkItems`, `app.ts:217`) with `fetch(url, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json-patch+json' }, body, keepalive: true })`. The JSON-Patch body shapes must replicate exactly what `createWorkItemFromTemplate` (create) and `linkItems`'s `document` array (link, `app.ts:205-215`) already build today — no field/shape changes. The bearer token comes from the Auth Token Provider (`authTokenProvider.ts`, wrapping `VSS.getAccessToken()`, zero existing usage in the repo). **The exact REST endpoint URL and `api-version` are not derivable from this repo** (the SDK's wrapped client fetches its implementation from the live host at runtime) and must be captured via live devtools network inspection against the confirmed-available Azure DevOps org before or during this component's implementation — this is a hard implementation-time dependency, not a design gap. Read-only calls (`getTeamSettings`, `getWorkItem`, `getWorkItemTypeCategories`, `getTemplates`, `getTemplate`) stay on the existing wrapped `witClient`/`workClient` — only create/link calls move to the Keepalive Fetch Client.

10. **Independent/ordered group dispatch** (`orchestrator.ts`, replacing the current single sequential `chain` at `app.ts:61-65`): templates classified as independent run concurrently, each via its own create → link-to-parent → (`ToAllOtherChilds`-only) related-links sequence. Templates classified as ordered run sequentially in the existing alphabetical order (`SortTemplates`, unchanged), one create's full resolution (including the synchronous `justCreatedTasks.push()`) completing before the next ordered template's create is dispatched — mirroring today's `chain.then(...)` structure but using native `Promise`s. **Must preserve exactly**: `justCreatedTasks` indexing semantics (`.length - 2`, `.length - 3`, `[0]`, `[1]`) with push happening synchronously inside the create-success callback; the pre-existing fire-and-forget (non-awaited) nature of `linkTo`-rule `linkItems` calls inside `createWorkItem` (today, the outer chain never waits on lines 132/140/150/159/167/175/183's `linkItems` calls to resolve — this must remain non-waited, not accidentally become awaited).

11. **Progress Dialog Controller** (`progressDialogController.ts`), wired per work item into `orchestrator.ts`/`app.ts`: for each `AddTasks(workItemId)` invocation, open a start dialog ("Creating N tasks...") via `IHostDialogService.openMessageDialog`, fire-and-forget (not awaited), as soon as the template count for that work item is known. Separately, track all of that work item's per-template create/link outcomes via `Promise.allSettled(...)`; when it resolves (only reachable if the popup/extension context is still alive), open a completion dialog reporting a partial-failure summary ("N of M tasks created", listing which templates failed) per clarification Q4. One start/completion dialog pair **per work item ID** — matching the existing per-ID `AddTasks(workItemId)` independence (clarification Q3), not one pair for the whole multi-select batch.

12. **Failure aggregation feeding the completion dialog**: thread structured success/failure results up from `createWorkItem`'s success/error branches (`app.ts:111-198`) and `linkItems`'s success/error branches (`app.ts:218-228`) through `createChildFromTemplate` to the per-work-item `Promise.allSettled` tracked by `AddTasks`/`orchestrator.ts`. Today these paths only `console.log` and are otherwise silently swallowed (`app.ts:189-198`, `223-228`) — this requirement adds the first user-facing error surface this extension has ever had, without removing the existing console logging.

### Explicitly Not Changed

13. `create()`'s external contract (`create(context: any): void`, AMD id `scripts/app`) and `toolbar.html`'s call site are unchanged — no new entry point, no new manifest contribution, no discovery UI.
14. `GetChildTypes`'s `bugsBehavior` numeric-enum-vs-string-literal comparison bug (`app.ts:557,568,574,577`) stays exactly as-is.
15. `GetChildTypes` (10 call sites) and `createWorkItem` (1 call site)'s direct `VSS.getWebContext()` calls, instead of reusing module-level `ctx`, stay exactly as-is — not normalized as a drive-by.
16. No version bumps to `package.json`/`vss-extension.json` — out of scope, handled at a separate release step.
17. No automated test framework is introduced.

## Reusable Components

### Existing Code to Leverage
- Every function currently in `src/scripts/app.ts` is reused verbatim (relocated, not rewritten) for the modularization pass — see the module boundary table in Core Requirement 1 for exact source line ranges and destination files.
- `createWorkItemFromTemplate`'s existing JSON-Patch body construction (`app.ts:231-282`) and `linkItems`'s existing `document` array shape (`app.ts:205-215`) are the exact templates the Keepalive Fetch Client's request bodies must replicate — no new body-building logic, just a new transport.
- `extractJSON`/`IsJsonString` (`app.ts:416-454`, relocating to `templateFilters.ts`) are reused as-is by the Template Classifier to parse each template's `linkTo` array — same parsing path `createWorkItem` already uses, no duplicate JSON-extraction logic.
- `SortTemplates` (`app.ts:501-508`, relocating to `templates.ts`) is reused unchanged to keep the ordered group's sequencing identical to today's alphabetical order.
- `tsconfig.json`'s glob `include` and `gruntfile.js`'s `exec:tsc`/`copy:static` tasks require zero changes — the existing build pipeline already supports multi-file `.ts` compilation and packaging.

### New Components Required
Per requirements.md (no external precedent exists — confirmed by both codebase analysis and gap analysis; this is genuinely greenfield work within the repo's own conventions, not a case of missed reuse):
- **Template Cache** (`templateCache.ts`) — no caching layer exists today; `localStorage` read/write/TTL logic is net-new.
- **Keepalive Fetch Client** (`keepaliveFetchClient.ts`) — no raw `fetch` usage exists today; all writes currently go through the SDK-wrapped client.
- **Auth Token Provider** (`authTokenProvider.ts`) — `VSS.getAccessToken()` has zero existing usage anywhere in the repo.
- **Progress Dialog Controller** (`progressDialogController.ts`) — `IHostDialogService.openMessageDialog()` has zero existing usage anywhere in the repo.
- **Template Classifier** (`templateClassifier.ts`) — no independent/ordered split exists today; the current chain is unconditionally sequential.
- **Failure aggregation** — no structured success/failure threading exists today; error branches are currently `console.log`-only dead ends.
- **`context.ts`/`types.ts`** — structural extraction of existing module-level state and type aliases into their own files, required by the module split itself (not new logic, but new files).

## Technical Approach

**Sequencing**: Phase A (modularization) must complete and be manually verified as behavior-identical to today before Phase B (behavioral changes) begins. This is the single biggest debugging lever available given zero automated test coverage — if something breaks during Phase B, the Phase A baseline lets you attribute the regression to specific behavioral logic rather than file-relocation noise.

**Phase A verification**: manual smoke test — click "Create linked tasks" against a live org before and after the full extraction, confirm identical network calls (devtools), identical console output, and identical created/linked work items. Run this check once after the first three low-risk files are extracted (AMD import smoke test) and again after the full 10-file Phase A split is complete.

**Phase B data flow** (per `high-level-design.md`'s Data Flow section, now spread across the new modules): `create()` (`app.ts`) → `AddTasks()` (`orchestrator.ts`) fires `getTeamSettings`/`getWorkItem` concurrently → `GetChildTypes` (`childTypes.ts`, unchanged, already-parallel category lookups) → Template Cache (`templateCache.ts`) checked before `templates.ts`'s `getTemplates`/`getTemplate` calls → Progress Dialog Controller opens the start dialog (fire-and-forget) → Template Classifier (`templateClassifier.ts`) splits templates → independent group runs concurrently via `workItemCreation.ts` (create → link-to-parent → `ToAllOtherChilds` links, all via the Keepalive Fetch Client for writes), ordered group runs sequentially in the existing order → all per-template outcomes tracked in one `Promise.allSettled` per work item → Progress Dialog Controller opens the completion dialog with the partial-failure summary once settled.

**Promise style**: native `Promise`/`async`/`await` for all new Phase B code and all restructured orchestration (`orchestrator.ts`, `workItemCreation.ts`'s touched paths). `Q` remains only in relocated-but-logically-untouched pure helpers (e.g., `getTemplates`'s existing `Q.all`, `GetChildTypes`'s existing `Q.all`) — no unscoped `Q`-removal sweep across the file.

**REST shape verification**: before writing the Keepalive Fetch Client's request-building code, capture the live `createWorkItem`/`updateWorkItem` request (URL, `api-version`, headers, `Content-Type: application/json-patch+json`) via browser devtools network tab against the confirmed-available live Azure DevOps org, using the existing (pre-Phase-B) SDK-driven flow as the reference. Do not guess or infer this shape from typings alone.

## Implementation Guidance

### Testing Approach
- No automated test framework exists in this project and none is introduced by this task (confirmed by codebase analysis, gap analysis, and requirements.md — tracked separately in `roadmap.md` Phase 2).
- Verification is manual only, via `grunt serve` (local HTTPS static server on `localhost:5501`) against a live Azure DevOps org with the extension installed, matching how the prior TypeScript-migration task in this repo was verified.
- Each implementation step group (both Phase A extraction steps and Phase B behavioral steps) should define 2-8 manual verification checks appropriate to that group's scope (e.g., "compile succeeds, `create()` still fires `AddTasks` for each work item ID, console output matches pre-change baseline" for an early extraction step; "start dialog appears immediately, completion dialog reports correct N of M, keepalive requests visible in devtools with `keepalive: true`" for the Progress Dialog Controller / Keepalive Fetch Client steps).
- Phase A's own manual check (Core Requirement 2's smoke test, repeated after the full split) doubles as the regression gate between modularization and behavioral work.
- Phase 9 (TDD Green Gate) re-walks the exact manual reproduction steps documented in `implementation/tdd-red-gate.md` — 2 templates with an ordering dependency, click create, close the popup shortly after — and confirms the narrower, accepted-partial "Green" outcome (already-dispatched keepalive requests complete server-side; not-yet-dispatched ordered-group/link requests remain exposed), not a 100% survival guarantee.

### Standards Compliance
- **Coding style** (`standards/global/coding-style.md`): new functions should match the nearest sibling's existing naming convention (mixed `camelCase`/`PascalCase` — do not impose a new single convention); no dead code left behind from the extraction (verify no orphaned/duplicate declarations across the split files).
- **Commenting** (`standards/global/commenting.md`): document the new caching/keepalive/dialog/classifier design choices inline, following the file's existing convention of explaining intentional design decisions (see precedent at current `app.ts:13-19`, `201-204`, `231-232`, `512-515`, `549-551`) — comment sparingly, no changelog-style "what changed" comments.
- **Error handling** (`standards/global/error-handling.md`): new Keepalive Fetch Client and failure-aggregation code should use the `logInfo`/`logError` prefixed helpers (relocated to `logging.ts`) for its own error paths, per this standard's traceability guidance — existing raw `console.log` call sites elsewhere are not required to be retrofitted (out of scope).
- **Minimal implementation** (`standards/global/minimal-implementation.md`): keep the new components (Template Cache, Keepalive Fetch Client, etc.) concrete and single-purpose — no speculative pluggable-backend abstractions (e.g., a generic cache-storage interface) when `localStorage` is the only backend this design needs; every new function must have an immediate caller.
- **Packaging** (`standards/build-tooling/packaging.md`): no changes needed to Grunt task naming, override files, or manifest file entries — this task doesn't touch the build/packaging surface.

## Out of Scope
- Full guarantee of popup-close survival (Hub/Hybrid architecture) — rejected in ADR-001, remains a future escalation path.
- Automated tests / test framework — no framework exists; tracked separately in `roadmap.md` Phase 2.
- Version bumps to `package.json`/`vss-extension.json` — separate release step.
- Normalizing the `ctx`-vs-`VSS.getWebContext()` inconsistency.
- Fixing the pre-existing `GetChildTypes` `bugsBehavior` bug.
- Event-driven or automatic cache invalidation on template edit — no Azure DevOps extensibility point exists for this (ADR-003).
- Programmatic auto-dismiss of the progress dialogs after a fixed delay — not implementable against the confirmed SDK API (ADR-004); dialogs are one-click-dismiss.
- Full migration off the `Q` promise library across untouched pure helper functions.
- `IExtensionDataService`-based cross-device/cross-browser cache durability — `localStorage` is sufficient.
- Any new contribution surface, Hub, observer, or work-item-form-page contribution.
- A subfolder/nested directory structure for the new files — flat under `src/scripts/` per scope-clarifications.md.

## Success Criteria

Adapted from `high-level-design.md`'s Success Criteria plus modularization-specific criteria:

1. On a second or later invocation within the same session and within the cache TTL, the `getTemplates`/`getTemplate` REST round trips are skipped entirely (served from `localStorage`).
2. `getTeamSettings` and `getWorkItem` execute concurrently on every invocation, not nested.
3. All templates whose `linkTo` rules do not reference `justCreatedTasks`-derived helpers create concurrently; only genuinely ordering-dependent templates remain serialized, with no change in their resulting links compared to current behavior.
4. For any template whose create request is dispatched (the `fetch` call issued) before the popup/work-item dialog closes, the corresponding work item exists in Azure DevOps afterward, even if the popup closed immediately after — verified via `keepalive:true` network-request semantics and the Phase 9 Green-gate manual reproduction.
5. The user sees an on-screen acknowledgment ("Creating N tasks...") essentially immediately after clicking, before any REST call resolves; when the popup remains open through completion, a summary dialog ("N of M tasks created" or a partial-failure breakdown) appears once all trackable promises for that work item have settled.
6. No behavior change for templates that remain in the ordered/sequential group — their created items and links match what the current implementation produces today.
7. `app.ts` retains its exact path, AMD module id `scripts/app`, and `create(context): void` export signature — `toolbar.html`'s `VSS.require(["scripts/app"], cb)` call site works unmodified.
8. No user-visible behavior difference is traceable to the file split alone — a manual smoke test (click → same network calls, same console output, same created/linked work items) confirms Phase A is behavior-identical to the pre-refactor baseline before Phase B begins.
9. The full 15-file structure (10 Phase A + 5 Phase B) compiles cleanly via the existing `tsc -p tsconfig.json` (no `tsconfig.json` changes needed) and packages correctly via the existing `grunt` build tasks (no `gruntfile.js` changes needed for the split itself).
