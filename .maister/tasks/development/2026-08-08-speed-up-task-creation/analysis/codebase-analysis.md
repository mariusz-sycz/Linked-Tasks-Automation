# Codebase Analysis Report

**Date**: 2026-08-08
**Task**: Implement the no-new-surface design for speeding up task creation
**Description**: Implement the no-new-surface design from research: localStorage template caching (4h TTL), fetch(keepalive:true) for create/link REST calls (popup-close survival), two openMessageDialog calls for progress feedback (start/completion), parallelize getTeamSettings/getWorkItem, and split per-template creates into independent (parallel) and ordered (justCreatedTasks-dependent, sequential) groups.
**Analyzer**: codebase-analyzer skill (2 Explore agents: File Discovery + Code Analysis, Context Discovery)

---

## TL;DR

All five changes land in a single 629-line file, `src/scripts/app.ts` — the only `.ts` source in the repo, with one runtime consumer (`src/toolbar.html`). Every line reference from the prior research (`high-level-design.md`) was re-verified against the current file and matches exactly — no drift. `fetch`, `localStorage`, and native `Promise`/`async`/`await` are all usable today with zero `tsconfig.json` changes (DOM lib ships by default under `target: "ES2015"`). `VSS.getAccessToken()` and `IHostDialogService.openMessageDialog()` are declared in the ambient SDK typings but have zero existing usage — this is genuinely greenfield code within an established file. There is no test framework and no automated tests in the project; verification will be manual (local `grunt serve` + live Azure DevOps org), matching how the prior TypeScript-migration task in this repo was verified.

## Key Decisions

- Treat exact REST endpoint URLs/`api-version` for `createWorkItem`/`updateWorkItem` as **not derivable from this repo** — `TFS/WorkItemTracking/RestClient` is loaded dynamically from the live host at runtime, not vendored locally. The `fetch(keepalive:true)` replacement must be built from live devtools network capture at implementation time, not guessed.
- Base "ordered group" sequencing for per-template creates on `justCreatedTasks.push()` timing (synchronous within `createWorkItem`'s resolve callback, line 116), not on link-write completion — the existing code already doesn't wait for `linkItems` calls inside `createWorkItem`'s `linkTo` branches (lines 132/140/150/159/167/175/183) to resolve before the outer `chain` proceeds, so preserving that pre-existing non-waiting behavior is the correct backward-compatible baseline.
- No `tsconfig.json` changes needed for `fetch`/`localStorage`/native `Promise` — DOM lib is included by default given `target: "ES2015"` with no explicit `lib` override.
- Leave the pre-existing `GetChildTypes` `bugsBehavior` enum-vs-string-literal comparison bug (`app.ts:557,568,574,577`) untouched — confirmed present, explicitly out of scope per the design doc.

## Open Questions / Risks

- `create()` fires `AddTasks(workItemId)` once per ID with no coordination when `context.workItemIds` contains multiple IDs (`app.ts:616-621`). The progress-dialog design (single start/completion pair vs. one pair per ID) needs to clarify behavior for this multi-ID case; the data flow as currently understood cleanly covers only the single-ID case.
- Zero automated tests exist in the project (confirmed by two independent searches, consistent with `roadmap.md`'s tracked technical debt and the design doc's explicit "Out of Scope: Automated tests" note). Verification of caching/keepalive/dialog behavior will be manual only.
- REST request/response shapes for `createWorkItem`/`updateWorkItem` (headers, exact URL, `api-version`) are not locally verifiable — flagged already in the design doc's Open Questions, reconfirmed here.

---

## Summary

The task touches exactly one file, `src/scripts/app.ts`, which is the sole compiled TypeScript unit in the project and has exactly one runtime consumer, `src/toolbar.html`. The codebase has no build-blocking obstacles: TypeScript's default DOM lib already exposes `fetch`, `localStorage`, and native `Promise`, and the SDK's `IHostDialogService`/`VSS.getAccessToken()` are reachable via the existing ambient triple-slash reference with no new imports required. The main engineering work is restructuring the existing `Q`-based sequential promise chain (`AddTasks`, lines 24-70, and the per-template `chain` built at lines 61-65) into parallel/sequential groups, and replacing three SDK-wrapped REST calls (`createWorkItem`, `updateWorkItem` used by `linkItems`) with raw `fetch(keepalive:true)` calls whose exact endpoint shape must be captured live rather than inferred from source.

---

## Files Identified

### Primary Files

**src/scripts/app.ts** (629 lines)
- The only `.ts` file in `src/scripts`; contains all logic touched by this task: `create()` (611-628), `AddTasks()` (24-70), `createChildFromTemplate()` (72-83), `getRelatedWorkItems()` (85-102), `createWorkItem()` (104-199), `linkItems()` (201-229), `createWorkItemFromTemplate()` (231-282), `getTemplate()` (495-498), `SortTemplates()` (501-508), `getTemplates()` (510-538), `GetChildTypes()` (541-601).
- Every line reference from the prior research design doc matches the current file exactly — safe to implement against those exact line numbers, no re-verification needed at implementation time.
- Currently uses `Q` (imported as `import * as Q from "q"`, line 8) for its own orchestration (`Q.all`, `Q.when`, hand-rolled `.then()` chain reduction) and consumes SDK-wrapped `IPromise<T>` results (from `witClient`/`workClient`) via `.then()` — both are thenable and freely interoperate today; there is no native `Promise`/`async`/`await` anywhere yet.

### Related Files

**src/toolbar.html**
- Sole entry point and sole external consumer of `app.ts`. Loads `VSS.SDK.min.js`, calls `VSS.init()`, and on action activation does `VSS.require(["scripts/app"], cb)` → `app.create(actionContext)`. Unaffected by this design (confirmed by design doc's Integration Points table marking it "Unchanged").

**src/tsconfig.json**
- Compiler config: `target: "ES2015"`, `module: "amd"`, `strict: true`, `types: []`, `outDir: "../build/scripts"`, `include: ["scripts/**/*.ts"]`. No explicit `lib` entry → default lib for `ES2015` target includes `DOM`, so `fetch`/`Response`/`Request`/`Headers`/`localStorage` typings are already available. No changes needed for this task.

**src/package.json**
- Declares `q` (with `@types/q` devDependency) and `vss-web-extension-sdk@^1.104.0`. No test framework, no `test` script.

**src/node_modules/vss-web-extension-sdk/typings/vss.d.ts**
- Ambient typings already reachable via `app.ts:1`'s triple-slash reference. Declares `VSS.getAccessToken(): IPromise<ISessionToken>` (line 2850), `ISessionToken.token: string` (474-490), `VSS.getService<T>` + `VSS.ServiceIds.Dialog` ("vss.dialogs", ~2745-2750), `IHostDialogService.openMessageDialog(message, options?): IPromise<IMessageDialogResult>` (line 654) with `IOpenMessageDialogOptions` (592-621, no timeout/auto-close option — confirms no programmatic dialog-close handle exists), and `BearerAuthHelpers.getBearerAuthHeader` in a separate `VSS/Authentication/Services` module (3647-3653, would need a new import, not required).

**src/node_modules/vss-web-extension-sdk/typings/tfs.d.ts**
- WIT/Work REST client method signatures (`createWorkItem`, `updateWorkItem`, `getTemplate`, `getTemplates`, `getTeamSettings`, `getWorkItem`, `getWorkItemTypeCategories`, etc.) used to confirm current call shapes.

**src/gruntfile.js**
- Build pipeline: `exec:tsc` (`tsc -p tsconfig.json` → `build/scripts/app.js` as AMD), `copy:static` (copies `toolbar.html`, `vss-extension.json`, `VSS.SDK.min.js` into `build/`), `serve` task (`grunt serve` → local HTTPS static server on `localhost:5501` for manual verification against a live Azure DevOps org). Not implicated by the touched code; no changes expected.

**src/vss-extension.json**
- Single `ms.vss-web.action` contribution pointing at `toolbar.html`. Unaffected by this change.

---

## Current Functionality

### Execution flow (current state, pre-change)

1. `toolbar.html` action handler → `VSS.require(["scripts/app"], cb)` → `app.create(actionContext)`.
2. `create()` (611-628): sync `VSS.getWebContext()`, then loops over `context.workItemIds`/`.id`/`.workItemId`, calling `AddTasks(workItemId)` **once per ID, fire-and-forget, uncoordinated** — relevant for the multi-ID progress-dialog question above.
3. `AddTasks(workItemId)` (24-70):
   - `workClient.getTeamSettings(team).then(...)` (line 38, round trip #1) → **nested inside its callback** → `witClient.getWorkItem(workItemId).then(...)` (line 41, round trip #2) — **currently sequential, not parallel; this is exactly what the "parallelize getTeamSettings/getWorkItem" change targets.**
   - `GetChildTypes(...)` (line 48) → round trip #3 (`getWorkItemTypeCategories`) then `Q.all([...])` of 0-3 `getWorkItemTypeCategory` calls (round trips #4-6, already parallel).
   - `getTemplates(childTypes)` (line 53) → one `witClient.getTemplates(...)` per child type, batched via `Q.all` (line 524, round trip set #7).
   - `templates.sort(SortTemplates)` (pure, sync).
   - Sequential `chain` built via `.forEach` (lines 61-65) over templates, each wrapped by `createChildFromTemplate(...)` — **this hand-rolled sequential chain is the mechanism the independent/ordered-group split must replace.**
4. `createChildFromTemplate` (72-83) → `getTemplate(template.id)` (line 74, round trip #8 per template) → validates → `createWorkItem(...)` (line 78).
5. `createWorkItem` (104-199): builds JSON-Patch via `createWorkItemFromTemplate` (pure, 231-282) → `witClient.createWorkItem(...)` (line 110, round trip #9 per template — **target for `fetch(keepalive:true)`**) → on success pushes to `justCreatedTasks`, then `linkItems(...)` for the parent link (line 120, round trip #10 — **also a `fetch(keepalive:true)` target**), then dispatches 0-N more fire-and-forget `linkItems(...)` calls per `linkTo` template rules (lines 132/140/150/159/167/175/183).
6. `linkItems` (201-229): single-op JSON-Patch, `witClient.updateWorkItem(document, newWorkItemId)` (line 217) — fire-and-forget, log-only error handling, `void` return.

### Key Components/Functions

- **`AddTasks`**: top-level per-work-item orchestrator; sequences team settings → work item → child types → templates → sequential create chain.
- **`GetChildTypes`**: resolves valid child work item types via category lookups; contains a known, out-of-scope `bugsBehavior` comparison bug.
- **`createWorkItemFromTemplate`**: pure function building the `createWorkItem` JSON-Patch body from template fields, parent fallback values, and `@me`/`@currentIteration` substitutions.
- **`linkItems`**: builds and sends a single `/relations/-` JSON-Patch add to link a work item to another (parent or related).
- **`logInfo`/`logError`**: the only two prefixed logging helpers (`'linked-tasks-automation: ' + msg`); most of the file instead calls raw `console.log` directly without this prefix.

### Data Flow

REST call sequence per invocation: `getTeamSettings` → `getWorkItem` (currently sequential) → `getWorkItemTypeCategories` (+ up to 3 parallel `getWorkItemTypeCategory`) → N parallel `getTemplates` → per-template sequential: `getTemplate` → `createWorkItem` → `linkItems` (parent) → 0-N fire-and-forget `linkItems` (related). No caching layer exists anywhere today (templates are fetched fresh every invocation) and no dialog/progress feedback exists.

---

## Dependencies

### Imports (What This Depends On)

- `TFS/WorkItemTracking/RestClient`, `TFS/WorkItemTracking/Contracts`, `TFS/Work/RestClient`, `TFS/Work/Contracts`, `TFS/Core/Contracts` — AMD modules provided at runtime by `VSS.SDK.min.js`, typed via ambient `vss.d.ts`/`tfs.d.ts`.
- `q` (`import * as Q from "q"`) — typed via `@types/q` devDependency; resolved at runtime via the AMD/RequireJS loader as module id `"q"`, no vendored copy bundled.
- Ambient globals `VSS`, `WebContext` from `vss.d.ts` (reachable via triple-slash reference, no import needed).
- **Net-new for this task, zero existing usage**: `VSS.getAccessToken()`, `VSS.getService(VSS.ServiceIds.Dialog)` / `IHostDialogService.openMessageDialog()`, `fetch`, `localStorage` — all typed and reachable with no new imports or tsconfig changes.

### Consumers (What Depends On This)

- **src/toolbar.html**: the only consumer; calls `app.create(actionContext)` via `VSS.require(["scripts/app"], cb)`. Single public entry point (`create`); no other exported function is referenced externally.
- **src/vss-extension.json**: wires the packaging/contribution surface (`files` array, single `ms.vss-web.action` contribution → `toolbar.html`) that makes the module resolvable at runtime; does not reference `app.ts` internals directly.

**Consumer Count**: 1 file (`toolbar.html`), 1 call site.
**Impact Scope**: Low (single consumer, single public entry point unchanged) but **High internal blast radius** — nearly every function in the 629-line file is part of the call graph being restructured (orchestration order, REST transport mechanism, and UI feedback all change within the same monolithic file).

---

## Test Coverage

### Test Files

None. Confirmed via repo-wide search (excluding `node_modules`/`.git`) for `*test*`/`*spec*` filenames — zero matches under `src/`. No test framework in `package.json` (no jest/mocha/karma/etc.), no `test` script.

### Coverage Assessment

- **Test count**: 0
- **Gaps**: entire file is untested; matches tracked technical debt in `.maister/docs/project/roadmap.md` ("No automated tests", deferred to a later phase) and the design doc's explicit "Out of Scope: Automated tests" note (`high-level-design.md` line 235).
- **Verification approach**: manual, via `grunt serve` (local HTTPS static server on `localhost:5501`, serving `toolbar.html`/`app.js`/`VSS.SDK.min.js`) against a live Azure DevOps org with the extension installed and `baseUri` pointed at localhost — same approach used for the prior TypeScript-migration task in this repo.

---

## Coding Patterns

### Naming Conventions

- Functions: mixed `camelCase` (`getTemplate`, `createWorkItem`) and `PascalCase` (`AddTasks`, `GetChildTypes`, `SortTemplates`) — no single consistent convention; new functions should match the nearest sibling's style rather than impose a new one.
- Logging: `logInfo`/`logError` prefix messages with `'linked-tasks-automation: '`, but most existing call sites bypass these helpers and call raw `console.log` directly — inconsistent today; new code should at minimum use the prefixed helpers for its own error paths for traceability, per `.maister/docs/standards/global/error-handling.md`.

### Architecture Patterns

- **Style**: single monolithic file, functional (no classes), heavy use of nested `.then()` promise chains and closures (`createChildFromTemplate` returns a thunk consumed by a hand-rolled sequential chain).
- **State Management**: no module-level state beyond function-local variables and closures; `justCreatedTasks` is accumulated within `AddTasks`'s scope across the per-template chain. No existing localStorage/caching pattern to follow — this is genuinely new territory in the file.
- **Promise conventions**: `Q` for internal orchestration, `IPromise` (SDK's own thenable) for REST client calls, freely interoperated via `.then()`. Introducing native `Promise`/`async`/`await` for the new `fetch`-based calls is safe under the current `ES2015` target but will be a new pattern alongside the existing `Q` usage — worth a brief inline note on why, per the file's established convention of documenting intentional type/pattern looseness (see comments at lines 13-19, 201-204, 231-232, 512-515, 549-551).
- **Error handling**: REST calls use `Q`'s two-argument `.then(onSuccess, onError)` form; `onError` only logs, never rethrows, no retry/backoff, no user-facing surface — no existing precedent for the richer error handling the global standards doc recommends. New `fetch`-based error paths are free to establish this precedent but have nothing existing to extend.

---

## Complexity Assessment

| Factor | Value | Level |
|--------|-------|-------|
| File count | 1 file (`app.ts`), 9+ functions/regions touched within it | High (by touch-point count within a single file) |
| Dependencies | 6 imports (`TFS/*` x5, `q`) + 4 net-new SDK/browser APIs (`fetch`, `localStorage`, `getAccessToken`, `openMessageDialog`) | Medium-High |
| Consumers | 1 file, 1 call site (`toolbar.html`) | Low |
| Test coverage | 0 tests, 0% | High (risk-increasing) |

### Overall: Moderate-to-Complex

Structurally simple (single file, single consumer, no framework migration), but the task requires restructuring the core orchestration/concurrency model (sequential chain → parallel/sequential group split), introducing four browser/SDK APIs with zero existing local precedent, and doing so with no automated test safety net and one REST-shape unknown (exact `fetch` endpoint/headers) that can only be resolved via live network capture.

---

## Key Findings

### Strengths
- Prior research is thorough and already committed to the repo (`.maister/tasks/research/2026-08-08-speed-up-task-creation/analysis/findings/*.md`, `outputs/high-level-design.md`, `decision-log.md`), and its line-number references were independently re-verified against the current file with zero drift.
- `tsconfig.json` requires no changes to support `fetch`/`localStorage`/native `Promise` — DOM lib ships by default with `target: "ES2015"`.
- Single consumer, single public entry point (`create`) — the external contract is trivially preserved regardless of internal restructuring.
- `IHostDialogService`/`VSS.getAccessToken()` typings are already reachable with no new imports, confirming the design's "no new surface" premise at the type level.

### Concerns
- Zero automated tests mean all five changes (caching, keepalive fetch, dialogs, parallel team-settings/work-item fetch, parallel/sequential create split) must be manually verified against a live Azure DevOps org.
- Exact REST endpoint URLs/`api-version`/headers for `createWorkItem`/`updateWorkItem` are not present anywhere in the repo (the SDK REST client implementation is fetched from the live host at runtime) — must be captured via live devtools network inspection before writing the `fetch` replacement, not inferred from source.
- `create()`'s uncoordinated per-ID `AddTasks` calls create ambiguity for how the two `openMessageDialog` calls (start/completion) should behave when `context.workItemIds` contains more than one ID.
- Fire-and-forget `linkItems` calls (today, and presumably preserved) mean "sequential"/"ordered" in the new design must be scoped precisely to `justCreatedTasks` push timing, not full link-write completion, or the new implementation will silently change existing (already-incomplete) waiting semantics.

### Opportunities
- Because this is a single-file, single-consumer module with no existing tests, the restructuring can be done relatively freely without cross-file coordination risk — the main risk is behavioral (timing/ordering, REST shape correctness), not structural (breaking other consumers).
- The file's existing convention of inline comments explaining intentional type-looseness (lines 13-19, 201-204, etc.) gives a natural place to document the new caching/keepalive/dialog design decisions for future maintainers.

---

## Impact Assessment

- **Primary changes**: `src/scripts/app.ts` — `AddTasks` (24-70, parallelize `getTeamSettings`/`getWorkItem`, add localStorage template caching, add start/completion dialogs, split per-template chain into parallel/sequential groups), `createWorkItem` (104-199, switch to `fetch(keepalive:true)`), `linkItems` (201-229, switch to `fetch(keepalive:true)`), `create` (611-628, wire dialog calls, possibly clarify multi-ID behavior).
- **Related changes**: none required in `toolbar.html`, `vss-extension.json`, `tsconfig.json`, or `gruntfile.js` — all confirmed unaffected/no-change-needed by both agents.
- **Test updates**: none exist to update; manual verification plan should be defined during planning (local `grunt serve` + live org, per README's documented debugging flow).

### Risk Level: Medium-High

No automated regression safety net, one unresolved REST-shape unknown requiring live verification, and a concurrency-model restructuring (sequential → parallel/sequential split) in code with pre-existing fire-and-forget gaps that must be preserved intentionally rather than accidentally fixed. Mitigated by the single-file/single-consumer scope and the thoroughness of prior research already committed to the repo.

---

## Recommendations

**This is a modification of existing, well-understood code** (implementation strategy):

1. **Sequence the REST-shape unknown first**: before writing the `fetch(keepalive:true)` replacement for `createWorkItem`/`linkItems`, capture the live request (URL, `api-version`, headers, `application/json-patch+json` content-type) via devtools network tab against a real Azure DevOps org using the existing SDK-driven flow, per the design doc's own Open Questions.
2. **Preserve existing (incomplete) waiting semantics deliberately**: implement "ordered group" sequencing keyed on `justCreatedTasks.push()` timing (synchronous, inside `createWorkItem`'s success callback), not on related-link-write completion, so the new grouping doesn't silently introduce waits that the current fire-and-forget `linkItems` calls never had.
3. **Resolve the multi-ID dialog question during specification**, not implementation — decide explicitly whether `create()`'s per-`workItemIds`-entry loop gets one start/completion dialog pair total or one pair per ID, since current data flow assumes single-invocation template counts.
4. **Keep the localStorage cache and dialog code self-contained and inline-commented**, following the file's existing convention of documenting intentional design choices (see precedent comments at lines 13-19, 201-204, 512-515) — this is genuinely new code with no existing pattern to extend.
5. **Do not touch the `GetChildTypes` `bugsBehavior` bug** (lines 557/568/574/577) — explicitly out of scope; fixing it as a drive-by would conflate unrelated behavior changes with this task's verification.
6. **Plan for manual verification only**: define the manual test plan (local `grunt serve` against a live org, per README's debugging flow) as part of specification/planning, since no automated coverage exists or is in scope.

---

## Next Steps

Proceed to gap analysis to compare this current-state understanding against the desired end-state (the no-new-surface design's five changes) and enumerate the specific implementation gaps to close, then feed into specification/planning for `src/scripts/app.ts`.
