# Implementation Plan: Speed Up Task Creation, Progress Feedback, Popup-Close Reliability, Modularize app.ts

## TL;DR
10 task groups: 4 gated Phase A groups (behavior-preserving `app.ts` split into 10 files), 4 independently-buildable Phase B component groups, 1 Phase B integration group, 1 final gap-review group. 59 steps total, ~49-59 manual verification checks (no automated test framework exists — see `implementation/tdd-red-gate.md`). Group 1 (extract `logging.ts`/`types.ts`/`context.ts`) is a hard gate that smoke-tests AMD cross-file imports before Groups 2-4 relocate the remaining 7 Phase-A files; Group 4's full-split smoke test is the hard gate before any Phase B group (5-9) may start. Phase B's four component groups (keepalive fetch + auth token, template cache, template classifier, progress dialogs) build independently in parallel once Group 4 passes, converging in Group 9's orchestrator integration; Group 10 closes any gaps against the spec's 9 numbered Success Criteria.

## Key Decisions
- Grouped Phase A by the DAG's natural tiers (base layer -> sibling layer -> builder/creation layer -> orchestrator/app finalization) rather than one group per file — keeps each group's manual smoke test meaningful (2-4 files/group) while still isolating the incremental AMD-import smoke test as its own first group, per spec Core Requirement 2.
- Phase B split into 4 independent component groups (Group 5: auth token + keepalive fetch client; Group 6: template cache; Group 7: template classifier; Group 8: progress dialog controller) that touch disjoint new files and can run concurrently once Group 4's gate passes, converged by a single orchestrator-integration group (Group 9) — mirrors the spec's own module-boundary dependency table exactly, no re-derivation.
- Live REST-endpoint capture (Core Requirement 9's hard implementation-time dependency) placed as step 5.1, before any `keepaliveFetchClient.ts` code is written, per planning requirement 4 — not discovered mid-implementation.
- Failure-aggregation threading (Core Requirement 12) placed in Group 9, not Group 5, because it threads results up into `orchestrator.ts`'s `AddTasks`/`Promise.allSettled`, even though its source edits land in `workItemCreation.ts` (declared as a shared file in both Group 5's and Group 9's Files to Modify — dependency chain 5 -> 9 already serializes the two edits).
- "Write N tests" steps are replaced with "define a manual verification checklist" throughout, consistent with `tdd-red-gate.md`'s project-wide adaptation (zero automated test framework exists, confirmed by codebase analysis).

## Open Questions / Risks
- Groups 5-8 are declared independent and safe to run concurrently once Group 4 passes, but Group 5 and Group 9 both touch `workItemCreation.ts` — the executor must serialize those two specifically (already enforced by Group 9's dependency on Group 5), not just treat "Phase B" as one parallel wave.
- Group 9 is the highest-risk single group in this plan (8 manual checks; touches the concurrency-model rewrite, the classifier dispatch split, and failure-result threading simultaneously). If a regression surfaces during Phase 9's later TDD Green Gate re-walk, Group 9 is the first place to look.
- Group 10 is the standard "Test Review & Gap Analysis" pattern from this plan's own methodology — it is distinct from, and precedes, the orchestrator's separate Phase 9 TDD Green Gate re-walk (`implementation/tdd-red-gate.md`). Do not conflate the two: Group 10 is in scope for this plan; Phase 9 is not.
- Total manual verification checks (~49-59 across the whole plan) is large for a manual-only regression net, but is accepted given zero automated test framework exists (spec Requirement 17) and is consistent with how the prior TypeScript-migration task in this repo was verified.

## Overview
Total Steps: 59
Task Groups: 10
Expected Manual Verification Checks: ~49-59 (no automated tests exist in this project; see Testing Approach in spec.md and `implementation/tdd-red-gate.md`)

## Implementation Steps

### Task Group 1: AMD Smoke Test — Extract `logging.ts`, `types.ts`, `context.ts`
**Dependencies:** None
**Files to Modify:** `src/scripts/logging.ts` (new), `src/scripts/types.ts` (new), `src/scripts/context.ts` (new), `src/scripts/app.ts`
**Estimated Steps:** 7

- [x] 1.0 Extract the base layer and prove AMD cross-file imports work
  - [x] 1.1 Define a 5-item manual verification checklist:
    - [x] `tsc -p tsconfig.json` compiles cleanly with `app.ts` + the 3 new files
    - [~] DEFERRED: `grunt serve`'s persistent HTTP server could not be launched in this sandbox (foreground/background both denied); `grunt build` (the identical compile/copy chain `serve` depends on) was run instead and succeeded, exit 0
    - [~] DEFERRED: requires a live Azure DevOps org session, not available in this environment — operator to verify manually (operator decision: skip live verification, compile-only)
    - [~] DEFERRED: same as above
    - [~] DEFERRED: same as above
  - [x] 1.2 Extract `logging.ts`: move `logInfo`/`logError` (current `app.ts:603-609`) verbatim; export both functions; no logic changes.
  - [x] 1.3 Extract `types.ts`: move the `WitClient`, `WorkClient`, `WorkItemFields` type aliases (current `app.ts:10-20`) verbatim; export all three.
  - [x] 1.4 Extract `context.ts`: move the module-level `ctx: WebContext` state (current `app.ts:22`) into `export let ctx: WebContext;`; `create()` (current `app.ts:615`) will assign to this imported binding instead of a local declaration. **Implementation note**: TypeScript (TS2540) forbids reassigning an imported `export let` binding from another module, so `context.ts` also gained `export function setCtx(newCtx: WebContext): void`, called by `create()` instead of a direct assignment — a wiring fix, not a logic change.
  - [x] 1.5 Update `app.ts`: replace the local `logInfo`/`logError`/type-alias/`ctx` declarations with `import` statements from `./logging`, `./types`, `./context`. Every other function (`AddTasks`, `createWorkItem`, `GetChildTypes`, etc.) stays resident in `app.ts` untouched at this stage — this is a partial extraction, not the full split. **Implementation note**: imported as `ctxState` (not `context`) to avoid colliding with `create(context: any)`'s parameter name.
  - [x] 1.6 Compile via `tsc -p tsconfig.json`; fix only import-wiring errors, zero logic changes. — Exit 0, clean compile.
  - [x] 1.7 Run `grunt build`/`serve` (adapted — see 1.1) — `grunt build` succeeded (exit 0); live-org checklist execution deferred per operator decision.

**Acceptance Criteria:**
- The 5 checklist items from 1.1: compile + build-chain items pass; live-org items deferred per operator decision (see work-log.md)
- `logging.ts`, `types.ts`, `context.ts` exist, exporting exactly the relocated members, with zero new logic (plus the structurally-required `setCtx` setter)
- `app.ts` compiles while importing from all three new files — proves the AMD cross-file `import` pattern resolves correctly under `module: "amd"`, the highest structural risk flagged in the spec — **CONFIRMED**: verified emitted `build/scripts/app.js`'s AMD `define()` header lists `./logging`/`./context` as dependencies
- No user-visible or console-visible behavior change is observed in the code itself (relocated verbatim; live confirmation deferred)
- **This is a hard gate**: Groups 2, 3, and 4 (the remaining Phase A extraction) are blocked until every item above passes — **PASSED** (compile-only criteria met; live items deferred per operator policy)

---

### Task Group 2: Extract `templateFilters.ts`, `childTypes.ts`, `templates.ts`
**Dependencies:** Group 1
**Files to Modify:** `src/scripts/templateFilters.ts` (new), `src/scripts/childTypes.ts` (new), `src/scripts/templates.ts` (new), `src/scripts/app.ts`
**Estimated Steps:** 7

- [x] 2.0 Extract the sibling layer that depends only on the Group 1 base files
  - [x] 2.1 Define a 5-item manual verification checklist:
    - [~] DEFERRED (compile-only policy): `tsc -p tsconfig.json` compiles cleanly with all 7 files now present — verified via actual compile instead (see Test Results, exit 0)
    - [~] DEFERRED: live-org click-through — requires live Azure DevOps org session, not available in this environment
    - [x] `GetChildTypes`'s `bugsBehavior` enum-vs-string-literal comparison bug unchanged — spot-checked via grep, confirmed still `any`-cast, still string-literal comparisons
    - [x] All 10 of `GetChildTypes`'s direct `VSS.getWebContext()` call sites preserved verbatim — confirmed via `grep -c` = 10
    - [~] DEFERRED: `SortTemplates` ordering identity requires live comparison — code moved verbatim (compile-verified), live confirmation deferred
  - [x] 2.2 Extract `templateFilters.ts`: 8 functions moved verbatim.
  - [x] 2.3 Extract `childTypes.ts`: `GetChildTypes`/`findWorkTypeCategory` moved verbatim, all 10 `VSS.getWebContext()` call sites and the `bugsBehavior` bug preserved byte-for-byte.
  - [x] 2.4 Extract `templates.ts`: `getTemplate`/`getTemplates`/`SortTemplates` moved verbatim.
  - [x] 2.5 Update `app.ts`: removed relocated function bodies (~318 lines), added imports for the relocated exports actually consumed by resident code.
  - [x] 2.6 Compile via `tsc -p tsconfig.json` — exit 0, clean.
  - [x] 2.7 Ran `grunt build` (adapted, see 2.1) — exit 0, all 7 `.ts` files compiled; live checklist deferred.

**Acceptance Criteria:**
- `templateFilters.ts`, `childTypes.ts`, `templates.ts` exist with exactly the relocated functions, no new logic — **CONFIRMED**
- `app.ts` still contains `AddTasks`/`createWorkItem`/etc. temporarily (full split isn't complete until Group 4) — **CONFIRMED**
- Compiles cleanly; no import cycle introduced — **CONFIRMED**, tsc exit 0
- Compile/grep-verifiable checklist items pass; live-org items deferred per operator decision

---

### Task Group 3: Extract `templateBuilder.ts`, `workItemCreation.ts`
**Dependencies:** Group 2
**Files to Modify:** `src/scripts/templateBuilder.ts` (new), `src/scripts/workItemCreation.ts` (new), `src/scripts/app.ts`
**Estimated Steps:** 6

- [x] 3.0 Extract the create/link layer, preserving fire-and-forget link semantics
  - [x] 3.1 Define a 5-item manual verification checklist:
    - [~] DEFERRED (compile-only policy): full compile verified instead — see Test Results, exit 0
    - [~] DEFERRED: live-org session not available in this environment
    - [~] DEFERRED: `ctx.user.uniqueName` live comparison — code confirmed reading via imported `ctxState.ctx` (not a stale local), live value comparison deferred
    - [x] All six `linkTo` `if`/`else if` branches preserved with identical branch order/logic — **verified directly by main agent via grep of `workItemCreation.ts`**: all 6 present (`ToAllOtherChilds`, `ToAllJustCreatedTasks`, `PreviouslyCreatedTask`/`PreviouslyJustCreatedTask` both using `length-2`, `SecondPreviouslyJustCreatedTask` using `length-3`, `FirstJustCreatedTask` using `[0]`, `SecondJustCreatedTask` using `[1]`), identical indexing
    - [x] Fire-and-forget `linkItems` calls preserved — **verified directly by main agent**: every `linkItems(...)` call site inside `createWorkItem`/`createChildFromTemplate` is a bare statement, never `return`ed/awaited
  - [x] 3.2 Extract `templateBuilder.ts`: `createWorkItemFromTemplate` moved verbatim.
  - [x] 3.3 Extract `workItemCreation.ts`: `createWorkItem`, `createChildFromTemplate`, `getRelatedWorkItems`, `linkItems` moved verbatim (function order follows current file, not stale plan line numbers).
  - [x] 3.4 Update `app.ts`: removed the four functions plus `createWorkItemFromTemplate`; added `createChildFromTemplate` import; pruned now-unused imports.
  - [x] 3.5 Compile via `tsc -p tsconfig.json` — exit 0.
  - [x] 3.6 Ran `grunt build` (adapted) — exit 0; live checklist deferred.

**Acceptance Criteria:**
- `templateBuilder.ts` and `workItemCreation.ts` exist with exactly the relocated bodies — **CONFIRMED**
- All six `linkTo` branches and the fire-and-forget `linkItems` semantics are unchanged — **CONFIRMED, independently verified by main agent via grep, not just subagent self-report**
- Compile-verifiable checklist items pass; live-org items deferred per operator decision

---

### Task Group 4: Extract `orchestrator.ts`, Finalize `app.ts` — Full Phase A Completion Gate
**Dependencies:** Group 3
**Files to Modify:** `src/scripts/orchestrator.ts` (new), `src/scripts/app.ts`
**Estimated Steps:** 6

- [x] 4.0 Complete the 10-file Phase A split and re-run the full regression smoke test
  - [x] 4.1 Define a 7-item manual verification checklist (the full-split regression gate — Core Requirement 2's repeated check, Success Criterion 8):
    - [x] `tsc -p tsconfig.json` compiles cleanly with all 10 Phase A files present, zero Phase B files present yet — **independently re-verified by main agent, exit 0**
    - [~] DEFERRED: live-org network-call parity — requires live Azure DevOps org session, not available in this environment
    - [~] DEFERRED: console output parity — same
    - [~] DEFERRED: created/linked work item parity — same
    - [x] `app.ts` retains its exact path/AMD id/`create(context: any): void` signature; `toolbar.html:21` call site works unmodified — **independently re-verified by main agent via grep**: `toolbar.html:21` still `VSS.require(["scripts/app"], ...)`, `app.ts:7` still `export function create(context: any): void`
    - [x] No circular imports among all 10 files — confirmed via clean `tsc` pass (would surface as a compile error)
    - [x] `bugsBehavior` bug and all `VSS.getWebContext()` call sites unchanged — confirmed via grep in Group 2/3, unaffected by this group's edits (this group didn't touch `childTypes.ts`/`workItemCreation.ts`)
  - [x] 4.2 Extract `orchestrator.ts`: `AddTasks` moved verbatim, wired only to the Phase-A files.
  - [x] 4.3 Finalize `app.ts`: reduced to `create()` only, importing `AddTasks` from `./orchestrator` and `ctxState` from `./context`.
  - [x] 4.4 Compiled the full 10-file structure via `tsc -p tsconfig.json` — exit 0 (both subagent and main agent independently confirmed).
  - [x] 4.5 Ran `grunt build` (adapted) — exit 0; live smoke test deferred.
  - [x] 4.6 Confirmed all compile-verifiable checklist items pass.

**Acceptance Criteria:**
- `orchestrator.ts` exists with `AddTasks` verbatim; `app.ts` is now the thin entry point only — **CONFIRMED**
- The full Phase A structure (10 files) compiles — **CONFIRMED, independently re-verified**; live behavioral-identity confirmation deferred per operator decision
- Compile-verifiable checklist items pass (4 of 7); 3 live-org items deferred
- **This is a hard gate**: Groups 5-9 (all of Phase B) are blocked until every item above passes — **PASSED, Phase B unblocked**

---

### Task Group 5: Auth Token Provider + Keepalive Fetch Client
**Dependencies:** Group 4
**Files to Modify:** `src/scripts/authTokenProvider.ts` (new), `src/scripts/keepaliveFetchClient.ts` (new), `src/scripts/workItemCreation.ts`
**Estimated Steps:** 7

- [x] 5.0 Capture the live REST shape, then build and wire the keepalive transport
  - [x] 5.1 **CHECKPOINT — RESOLVED BY OPERATOR DECISION (not live-captured):** operator explicitly chose to use well-documented public Azure DevOps REST API conventions instead of live devtools capture (no live org session available in this environment). Implemented: `PATCH {collection.uri}{project}/_apis/wit/workitems/${type}?api-version=7.1` (create), `PATCH {collection.uri}{project}/_apis/wit/workitems/{id}?api-version=7.1` (link/update), `Content-Type: application/json-patch+json`, collection URI read from `ctxState.ctx.collection.uri` (not hardcoded, supports on-prem). **Flagged in code comments as public-docs-derived, not live-verified — must be confirmed against a real network capture before production use.**
  - [x] 5.2 Define a 6-item manual verification checklist — all 6 items require live-org network capture; all marked DEFERRED (see Test Results).
  - [x] 5.3 Built `authTokenProvider.ts`: wraps `VSS.getAccessToken()`, resolves `ISessionToken.token` as `Promise<string>`.
  - [x] 5.4 Built `keepaliveFetchClient.ts`: `fetch(..., { keepalive: true })` per the public-docs shape from 5.1; native Promise/async-await.
  - [x] 5.5 Wired into `workItemCreation.ts`: `createWorkItem`/`linkItems`'s SDK-wrapped create/update calls replaced with keepalive client calls; read-only calls untouched; removed now-dead `witClient` param from `linkItems` (8 call sites updated).
  - [x] 5.6 Compiled via `tsc -p tsconfig.json` — exit 0.
  - [x] 5.7 Live checklist deferred (see 5.2).

**Acceptance Criteria:**
- `authTokenProvider.ts` and `keepaliveFetchClient.ts` exist, created fresh — **CONFIRMED**
- `workItemCreation.ts`'s create/link calls use the keepalive fetch client with the public-docs-derived endpoint shape (live confirmation deferred, explicitly flagged) — **CONFIRMED**
- JSON-Patch bodies unchanged from today's shapes (only transport swapped, body-building logic untouched); read-only calls untouched — **CONFIRMED** by main agent spot-check
- Compile passes; all 6 checklist items DEFERRED (live-org session not available) — flagged as outstanding pre-production work

---

### Task Group 6: Template Cache
**Dependencies:** Group 4
**Files to Modify:** `src/scripts/templateCache.ts` (new), `src/scripts/templates.ts`
**Estimated Steps:** 5

- [x] 6.0 Build and wire the localStorage template cache
  - [x] 6.1 Define a 5-item manual verification checklist:
    - [~] DEFERRED (live-org): cache-miss round-trip + write — TTL/write-path logic verified via scratch script instead (see Test Results)
    - [~] DEFERRED (live-org): cache-hit skips REST round trip — verified via code review of the wrapper logic instead
    - [x] Cache key correctly scoped by `(project.id, team.id, [keyParts])` — verified via code read: `buildTemplateCacheKey` derives from `ctx.project.id`/`ctx.team.id` plus sorted key parts
    - [x] TTL boundary logic (stale after 4h) — **verified via Node scratch script**: fresh at 0/3h59m/exactly-4h (inclusive), stale at 4h1m
    - [~] DEFERRED (live-org): cache-served templates produce identical created work items
  - [x] 6.2 Built `templateCache.ts`: generic `getFreshCacheEntry<T>`/`writeCacheEntry<T>` + `buildTemplateCacheKey`, 4h TTL (`CACHE_TTL_MS = 14400000`).
  - [x] 6.3 Wired into `templates.ts`: `getTemplate`/`getTemplates` both check cache first, write through on miss.
  - [x] 6.4 Compiled via `tsc -p tsconfig.json` — exit 0 (after fixing a `Q.Promise`/`IPromise` unification issue on `getTemplate`'s hit/miss branches — see subagent notes).
  - [x] 6.5 Live checklist deferred (see 6.1); TTL logic verified via scratch script.

**Acceptance Criteria:**
- `templateCache.ts` exists; `templates.ts` checks the cache before any REST call — **CONFIRMED**
- TTL is 4 hours; no manual "clear cache" affordance (explicitly out of scope, ADR-003) — **CONFIRMED**
- Compile-verifiable and TTL-logic checklist items pass; live-org items deferred; Success Criterion 1 (spec.md) implemented, live confirmation pending

---

### Task Group 7: Template Classifier
**Dependencies:** Group 4
**Files to Modify:** `src/scripts/templateClassifier.ts` (new)
**Estimated Steps:** 4

- [x] 7.0 Build the independent/ordered classification logic
  - [x] 7.1 Define a 4-item manual verification checklist — **all 4 are pure-function logic, no live org needed; all executed for real via scratch script, none deferred.**
  - [x] 7.2 Built `templateClassifier.ts`: `classifyTemplates()` scans `linkTo` rules via `extractJSON`/`IsJsonString` (same parsing path as `createWorkItem`), classifies **ordered** on any of the six rule names (case-insensitive `.toUpperCase()` match, DRY'd into one constant array), everything else **independent**.
  - [x] 7.3 Compiled via `tsc -p tsconfig.json` — exit 0.
  - [x] 7.4 Executed the checklist from 7.1 via a Node scratch script (6 scenarios: 4 required + 2 extra) — **6/6 PASSED**, script deleted after run.

**Acceptance Criteria:**
- `templateClassifier.ts` exists; classification matches the six-rule-name spec exactly — **CONFIRMED, 6/6 scratch-script scenarios passed**
- Reuses `extractJSON` — no duplicate JSON-extraction logic — **CONFIRMED**
- All 4 checklist items pass — **CONFIRMED, actually executed (not deferred — this group's logic is live-org-independent)**

---

### Task Group 8: Progress Dialog Controller
**Dependencies:** Group 4
**Files to Modify:** `src/scripts/progressDialogController.ts` (new)
**Estimated Steps:** 4

- [x] 8.0 Build the start/completion dialog functions
  - [x] 8.1 Define a 4-item manual verification checklist:
    - [~] DEFERRED (live-org): start dialog visually renders "Creating N tasks..." — code confirmed fire-and-forget (not awaited by caller) via read
    - [~] DEFERRED (live-org): completion dialog renders "N of M tasks created" with no failures
    - [~] DEFERRED (live-org): completion dialog lists failed template names
    - [x] No auto-dismiss/timeout logic exists — **verified by directly reading `vss.d.ts` lines 592-621** (`IOpenMessageDialogOptions` fields: `buttons`, `escapeButton`, `requiredTypedConfirmation`, `title`, `width`, `height`, `useBowtieStyle` — nothing timer-related), matches ADR-004
  - [x] 8.2 Built `progressDialogController.ts`: `showStartDialog(templateCount)` (fire-and-forget) and `showCompletionDialog(outcomes: TemplateOutcome[])` (N of M + failure list); depends only on VSS SDK ambient typings.
  - [x] 8.3 Compiled via `tsc -p tsconfig.json` — exit 0.
  - [x] 8.4 Live checklist deferred (see 8.1); auto-dismiss check executed for real.

**Acceptance Criteria:**
- `progressDialogController.ts` exists with both functions — **CONFIRMED**
- Message format matches clarification Q4 (partial-failure summary, not console-only) — **CONFIRMED** by code read
- Compile + typings-verifiable checklist items pass (1 of 4 executed for real, 3 deferred — all require live rendering)

---

### Task Group 9: Orchestrator Integration — Parallelization, Dispatch Split, Wiring, Failure Aggregation
**Dependencies:** Groups 5, 6, 7, 8
**Files to Modify:** `src/scripts/orchestrator.ts`, `src/scripts/workItemCreation.ts`
**Estimated Steps:** 8

- [x] 9.0 Wire every Phase B component into the orchestration flow
  - [x] 9.1 Define an 8-item manual verification checklist (this is the highest-behavioral-risk group in the plan). **Two design ambiguities surfaced during implementation were resolved by the operator**: (1) `Promise.allSettled` isn't available under the project's ES2015 compile target — resolved by using never-rejecting per-template outcome promises with plain `Promise.all` (operator confirmed: keep this workaround, no tsconfig change); (2) whether a successful create with a failed parent-link counts as "created" — resolved by the operator: counts as failed (both create AND parent-link must succeed).
    - [x] `getTeamSettings`/`getWorkItem` dispatch via `Promise.all` — **verified by main agent reading `orchestrator.ts` directly**: both wrapped in one `Promise.all([...])`, not nested
    - [~] DEFERRED (live-org): devtools timing confirmation that requests fire near-simultaneously
    - [x] Start dialog appears once per work item ID (not per batch) — **verified by main agent reading `app.ts`**: unchanged per-ID `AddTasks(workItemId)` loop, each call gets its own `showStartDialog`/`showCompletionDialog` pair
    - [x] Independent-group templates dispatch concurrently — **verified by main agent**: `Promise.all(classification.independent.map(createChildFromTemplate))`
    - [~] DEFERRED (live-org): devtools confirmation of overlapping create requests
    - [x] Ordered-group templates dispatch sequentially in `SortTemplates` order with identical `justCreatedTasks` indexing (`length-2`, `length-3`, `[0]`, `[1]`) — **verified by main agent reading `workItemCreation.ts`**: indexing unchanged, `justCreatedTasks.push()` still synchronous inside the create-success callback (line 64), before any async work
    - [x] Fire-and-forget `linkTo`-rule `linkItems` calls remain non-awaited — **verified by main agent**: all 6 branches call `linkItems(...)` as a bare statement, only `parentLinkPromise` (the top-level Hierarchy-Forward call) is captured/awaited
    - [~] DEFERRED (live-org): completion dialog live rendering with a forced failure
    - [x] Failure aggregation threads through without removing `console.log` calls — **verified by main agent reading both files**: all pre-existing `console.log` statements intact, `logError` calls added alongside them
    - [~] DEFERRED (live-org): full click-through reproducing identical created/linked work items
  - [x] 9.2 Modified `orchestrator.ts`: `Promise.all([getTeamSettings, getWorkItem])` replaces the nested `.then()` chain.
  - [x] 9.3 Modified `orchestrator.ts`: `classifyTemplates(templates)` called on the sorted, possibly cache-served template list.
  - [x] 9.4 Modified `orchestrator.ts`: independent group dispatched via `Promise.all(...map(createChildFromTemplate))`; ordered group dispatched via new `createOrderedChildrenSequentially` (async `for...of` + `await`), preserving `SortTemplates` order and `justCreatedTasks` timing. Both groups run concurrently with each other (operator-unreviewed but low-risk, necessary for the actual speed-up goal — independent group has no dependency on ordered group's `justCreatedTasks` state at dispatch time).
  - [x] 9.5 Modified `orchestrator.ts`: `showStartDialog`/`showCompletionDialog` wired per work item ID around `Promise.all([independentOutcomes, orderedOutcomes])`.
  - [x] 9.6 Modified `workItemCreation.ts`: `createChildFromTemplate`/`createWorkItem`/`linkItems` now return never-rejecting `Promise<TemplateOutcome>`/`Promise<boolean>`, threading structured results up to `AddTasks`; zero `console.log` calls removed.
  - [x] 9.7 Compiled via `tsc -p tsconfig.json` — exit 0 (subagent AND main agent independently re-verified).
  - [x] 9.8 Executed the checklist from 9.1 — 5 of 8 items verified for real via direct code reading by the main agent (not just subagent self-report); 3 deferred (all require live rendering/timing).

**Acceptance Criteria:**
- Success Criteria 2, 3, 5, 6 (spec.md) — **CONFIRMED** via main-agent code verification (live devtools timing confirmation deferred)
- No accidental change to the fire-and-forget `linkItems` semantics — **CONFIRMED, independently verified**
- Failure aggregation surfaces correctly without removing existing console logging — **CONFIRMED, independently verified**
- 5 of 8 checklist items verified for real by direct code reading; 3 deferred (live-org rendering/timing only)

---

### Task Group 10: Test Review & Gap Analysis (Integration Verification & Success Criteria Review)
**Dependencies:** All previous groups (1-9)
**Files to Modify:** None (pure review/verification group)
**Estimated Steps:** 5

- [x] 10.0 Review coverage and close any gaps against the spec's success criteria
  - [x] 10.1 Reviewed all Groups 1-9 checklists: compile-time/code-reasoning items were executed for real throughout; live-org items were consistently marked DEFERRED per operator decision (no live org session available in this environment).
  - [x] 10.2 Cross-checked all 9 spec Success Criteria: **4 fully VERIFIED by compile-time/code-reasoning alone** (Criteria 2, 6, 7, 9), **5 PARTIALLY-VERIFIED-PENDING-LIVE** (Criteria 1, 3, 4, 5, 8 — code confirmed correct, live behavioral confirmation outstanding).
  - [x] 10.3 Identified 8 additional checks runnable without live infrastructure (fresh full-project `tsc` compile, byte-level diff of `childTypes.ts` against pre-refactor baseline, whole-codebase import-DAG audit, `git status`/`git diff --stat` scope audit, config-file diff audit, version-string re-grep, test-framework re-grep, build-output parity check).
  - [x] 10.4 Executed all 8 checks — see Group 10 report in work-log.md for full results; all passed.
  - [x] 10.5 Confirmed Success Criteria 1-9 status (see work-log.md's consolidated accounting table); no criterion is unaccounted for. Partial popup-close survival (Criterion 4) confirmed as an accepted, by-design gap (ADR-002), not a defect.

**Acceptance Criteria:**
- Every spec Success Criterion (1-9) traced to a status (4 verified, 5 partially-verified-pending-live) — **CONFIRMED, nothing unaccounted for**
- A consolidated 17-item "outstanding pre-production verification" checklist produced (see work-log.md) — **CONFIRMED**
- No scope creep — **CONFIRMED, independently re-grepped**: `bugsBehavior` bug byte-identical to pre-refactor baseline; all 10 `GetChildTypes` `VSS.getWebContext()` call sites intact; `package.json`/`vss-extension.json` versions unchanged (1.1.17/1.1.16, pre-existing mismatch untouched); zero test-framework references anywhere in the repo; zero config-file diffs (`gruntfile.js`, `tsconfig.json`, `toolbar.html`, `vss-extension.json` all unchanged)

---

## Execution Order

1. Group 1 — AMD Smoke Test (logging/types/context) — 7 steps
2. Group 2 — templateFilters/childTypes/templates (7 steps, depends on 1)
3. Group 3 — templateBuilder/workItemCreation (6 steps, depends on 2)
4. Group 4 — orchestrator + finalize app.ts, full Phase A gate (6 steps, depends on 3)
5. Groups 5, 6, 7, 8 — Phase B components, parallelizable once Group 4 passes:
   - Group 5 — Auth Token Provider + Keepalive Fetch Client (7 steps, depends on 4)
   - Group 6 — Template Cache (5 steps, depends on 4)
   - Group 7 — Template Classifier (4 steps, depends on 4)
   - Group 8 — Progress Dialog Controller (4 steps, depends on 4)
6. Group 9 — Orchestrator Integration (8 steps, depends on 5, 6, 7, 8)
7. Group 10 — Test Review & Gap Analysis (5 steps, depends on 1-9)

## Standards Compliance

Follow standards from `.maister/docs/standards/`:
- `global/coding-style.md` — new/relocated functions match the nearest sibling's existing naming convention (mixed `camelCase`/`PascalCase` stays mixed); no dead code left behind by the extraction (verify no orphaned/duplicate declarations across the split files)
- `global/commenting.md` — document the new caching/keepalive/dialog/classifier design choices inline, following the file's existing convention (see precedent at current `app.ts:13-19, 201-204, 231-232, 512-515, 549-551`); comment sparingly, no changelog-style comments
- `global/error-handling.md` — the Keepalive Fetch Client and failure-aggregation code use the `logInfo`/`logError` helpers (`logging.ts`) for their own error paths; existing raw `console.log` sites elsewhere are not retrofitted
- `global/minimal-implementation.md` — keep Template Cache, Keepalive Fetch Client, etc. concrete and single-purpose; no speculative pluggable-backend abstractions; every new function has an immediate caller (this is why the 5 Phase-B files are created fresh in Groups 5-8, not as empty skeletons in Phase A)
- `build-tooling/packaging.md` — no changes needed to Grunt task naming, override files, or manifest entries; this plan doesn't touch the build/packaging surface

## Notes

- Test-Driven (adapted): no automated test framework exists in this project (confirmed, `tdd-red-gate.md`) — every group's "tests" are a 2-8-item manual verification checklist defined before implementation and executed after, per the project-wide adaptation already used for the prior TypeScript-migration task.
- Run Incrementally: execute only the checklist defined for the current group; do not re-run every prior group's checklist on every change.
- Mark Progress: check off steps as completed.
- Reuse First: every Phase A function is relocated verbatim (see spec.md's Reusable Components section); Phase B reuses `extractJSON`/`IsJsonString`, `SortTemplates`, and the existing JSON-Patch body shapes exactly as documented in each group above.
- Hard Gates: Group 1 must fully pass before Groups 2-4 start; Group 4 must fully pass before Groups 5-9 start. These are the two points in the plan where "stop and verify" is mandatory, not optional.
