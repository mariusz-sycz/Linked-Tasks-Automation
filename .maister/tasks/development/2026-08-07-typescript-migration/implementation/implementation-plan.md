# Implementation Plan: TypeScript Migration of `src/scripts/app.js`

## TL;DR
Six strictly sequential task groups (1→2→3→4→5→6), mirroring the spec's own Technical Approach — this is a single-file port, not a parallelizable multi-module task. Groups 1-3 bootstrap tooling then fix/clean/rename `app.js`→`app.ts` while still reversible; Groups 4-5 wire and then actually verify the dual-packaging `tsc` build step (split because `node_modules` doesn't exist until Group 5's `npm install`); Group 6 is the manual `.vsix` side-by-side behavioral acceptance pass. No test framework is introduced — every group's "tests" are 2-8 manual verification checklist items (compiler output + code review + build-log inspection), per the task's explicit TDD-gate adaptation.

## Key Decisions
- **Test-driven step pattern replaced with verification-checklist pattern** — no test framework exists or is introduced (roadmap defers this to Phase 2); each group substitutes 2-8 manual checklist items (tsc exit code, code review, build-log inspection) for the usual 2-8 automated tests, per the task's explicit instruction.
- **All bug fixes (Core Req 8, 9, 10, 10a) and all cleanup items (Core Req 11-14) land in one group (Group 2), while the file is still `.js`** — the spec's own sequencing mandates resolving every compiler-surfaced issue during the JSDoc/`checkJs` bootstrap phase, before the single-shot rename. Splitting bug-fixes from cleanup into separate groups would fragment one atomic "still-reversible-as-.js" phase into artificial sub-phases with no independent value.
- **Grunt build-wiring split into two groups** — Group 4 adds and statically wires the new `exec.tsc` target into both `registerTask("package-dev", …)` and `registerTask("package-release", …)` arrays, but can only verify by code review since `typescript`/`node_modules` aren't installed yet. Group 5 runs `npm install` and then *actually executes* `tsc -p tsconfig.json`, `grunt package-dev`, and `grunt package-release` to confirm both paths truly invoke `tsc` and produce fresh output — satisfying gap-analysis's "build-wiring orphan risk" as a checked, not assumed, requirement.
- **Group 6 (manual `.vsix` verification) replaces the standard "Test Review & Gap Analysis" closing group** — since no automated test suite exists to review/extend, the closing group instead executes the spec's Implementation Guidance checklist end-to-end (dual-syntax template filters, promise-chain ordering, all seven `linkTo` branches, `bugsBehavior` branches, module-resolution path) against a real/sandbox Azure DevOps org.
- **No `Visual References` sections or `visual-coverage.md`** — this is a headless, non-UI build-tooling migration; `analysis/design-context/` does not exist for this task.

## Open Questions / Risks
- **Group 4's wiring verification is necessarily partial** — code review can confirm the `exec.tsc` target and both `registerTask` array edits are textually correct, but cannot confirm `grunt package-dev`/`grunt package-release` actually invoke `tsc` end-to-end until Group 5 installs `node_modules` and runs both tasks for real. Do not treat Group 4's checklist as satisfying the spec's "explicit, checked" dual-wiring requirement on its own — Group 5's checklist item is the one that actually closes gap-analysis's orphan-risk finding.
- **`any`/type-assertion fallback for loosely-typed `.fields`/JSON-Patch surfaces is undiscoverable until Group 5** — per spec Open Questions, the real shape of `WorkItemTemplateReference`/`WorkItemTemplate` typings is unverified until `node_modules` exists. Group 5's Files to Modify includes `src/scripts/app.ts` for this reason; expect small, scoped touch-ups, not a rewrite.
- **Group 6 requires a real or sandbox Azure DevOps org** — if unavailable to the operator, the spec's behavioral-parity Success Criteria (especially the promise-chain-fix ordering check and the seven `linkTo` branches) cannot be fully closed by this plan; flag back to the operator rather than silently marking Group 6 complete on compiler success alone.

## Overview
Total Steps: 36
Task Groups: 6
Expected Checklist Items (manual verification, not automated tests): 34 (4 + 8 + 4 + 4 + 6 + 8)

## Implementation Steps

### Task Group 1: Build Tooling Bootstrap
**Dependencies:** None
**Files to Modify:** `src/package.json`, `src/tsconfig.json` (new), `src/scripts/global.d.ts` (new)
**Estimated Steps:** 5

- [x] 1.0 Complete build tooling bootstrap without touching `app.js`
  - [x] 1.1 Define manual verification checklist (4 items) for this group:
    - `tsconfig.json` parses via `tsc --showConfig -p tsconfig.json` (once `typescript` is locally resolvable) with no errors
    - Printed config shows `module: "amd"`, `strict: true`, `types: ["vss-web-extension-sdk"]`, no `outDir`/`rootDir`, `include` scoped to `scripts/**/*.ts`
    - `src/scripts/global.d.ts` declares exactly 4 `VSS` methods (`getWebContext`, `init`, `require`, `register`) — no speculative extras
    - `src/scripts/app.js` has zero diffs at the end of this group (untouched)
  - [x] 1.2 Add `typescript` and `@types/q` as devDependencies in `src/package.json` (Core Requirement 1) — do not run `npm install` yet (deferred to Group 5)
  - [x] 1.3 Create `src/tsconfig.json`: `"module": "amd"`, `"strict": true`, `"types": ["vss-web-extension-sdk"]`, no `outDir`/`rootDir` remap, `"include": ["scripts/**/*.ts"]`, a pinned ES2015+ `target` (Core Requirement 2; spec-audit Finding 5 — pin a specific value, e.g. `"ES2015"`, rather than leaving it a range)
  - [x] 1.4 Create ambient declaration `src/scripts/global.d.ts` with `declare const VSS: { getWebContext(): WebContext; init(): void; require(deps: string[], cb: Function): void; register(id: string, cb: Function): void; }` (Core Requirement 5) — covers exactly the 4 methods called, no more
  - [x] 1.5 Execute the checklist from 1.1

**Acceptance Criteria:**
- All 4 checklist items confirmed
- `tsconfig.json` matches Core Requirement 2 exactly, including a pinned `target`
- `src/scripts/app.js` is byte-identical to its pre-group state

---

### Task Group 2: JSDoc/`checkJs` Bootstrap — Bug Fixes & Cleanup (still `.js`)
**Dependencies:** Group 1
**Files to Modify:** `src/scripts/app.js`
**Estimated Steps:** 11

- [x] 2.0 Resolve every compiler-surfaced issue, including all bug fixes and cleanup, while the file is still `app.js`
  - [x] 2.1 Define manual verification checklist (8 items) for this group:
    - Promise-chain fix compiles with no type error and preserves genuinely sequential template processing
    - `for (const category of categories)` — no implicit global remains at the former `app.js:459`
    - `GetChildTypes` accepts a `teamSettings` parameter threaded from `AddTasks` (no independent `workClient.getTeamSettings(team)` re-call remains inside `GetChildTypes`)
    - `PreviouslyCreatedTask`/`PreviouslyJustCreatedTask` branches are byte-for-byte unchanged in behavior, each with an added comment noting they are currently equivalent
    - Zero references remain to `Controls`, `StatusIndicator`, `Dialogs`, `_WorkItemServices`/`TFS/WorkItemTracking/Services`, or `getWorkItemFormService`
    - `Log`/`WriteTrace`/`WriteLog`/`WriteError` are consolidated into one typed logging utility; all 6 live call sites (`Log` ×1, `WriteTrace` ×3, `WriteError` ×2) updated; `WriteLog` deleted (zero live call sites)
    - `linkImtes` renamed to `linkItems` at its definition and all 8 call sites, zero remaining references to the old name
    - `src/package.json`'s `"version"` reads `"1.1.17"`
  - [x] 2.2 Add a top-of-file `// @ts-check` pragma plus JSDoc type annotations (`@param`/`@returns`) to `app.js`'s function signatures, sufficient for meaningful `checkJs` feedback (Core Requirement 7) — this is a bootstrap aid, not final typing; verify with an ad-hoc `tsc --allowJs --checkJs --noEmit --strict src/scripts/app.js` run (not committed to `tsconfig.json`, whose pinned settings from Group 1 intentionally omit `allowJs`/`checkJs`)
  - [x] 2.3 Fix the broken promise chain (Core Requirement 8): `createChildFromTemplate`'s inner callback (`app.js:52-61`) `return`s the result of `createWorkItem(...)`; `createWorkItem` (`app.js:83-177`) `return`s its `witClient.createWorkItem(...).then(...)` chain
  - [x] 2.4 Fix the implicit-global loop variable (Core Requirement 9): `app.js:459` `for (category of categories)` → `for (const category of categories)`
  - [x] 2.5 Fix the `.bugsBehavior`-off-a-pending-Promise bug (Core Requirement 10): thread `teamSettings` (already fetched in `AddTasks` at `app.js:17-18`) into `GetChildTypes` as a new parameter; update `GetChildTypes`'s call site (`app.js:27`) to pass it; remove the independent `workClient.getTeamSettings(team)` re-call at `app.js:526`
  - [x] 2.6 Preserve `PreviouslyCreatedTask`/`PreviouslyJustCreatedTask` (`app.js:123-138`) with no behavior change; add a code comment at both branches noting they are currently equivalent (Core Requirement 10a)
  - [x] 2.7 Delete dead code (Core Requirement 11): `Controls`, `StatusIndicator`, `Dialogs` AMD imports; `getWorkItemFormService` function (`app.js:572-576`); the now-orphaned `TFS/WorkItemTracking/Services` (`_WorkItemServices`) import
  - [x] 2.8 Consolidate `Log`, `WriteTrace`, `WriteLog`, `WriteError` (`app.js:578-588`) into a single typed logging utility (Core Requirement 12); update the 6 live call sites; delete `WriteLog` (zero live call sites, not just a duplicate)
  - [x] 2.9 Rename `linkImtes` → `linkItems` at its definition (`app.js:179`) and all 8 call sites (`app.js:76, 99, 119, 128, 136, 144, 152, 160`) (Core Requirement 13)
  - [x] 2.10 Align `src/package.json`'s `"version"` field to `"1.1.17"` (Core Requirement 14)
  - [x] 2.11 Re-run the ad-hoc `tsc --allowJs --checkJs --noEmit --strict src/scripts/app.js` check until zero errors remain; execute the checklist from 2.1

**Acceptance Criteria:**
- All 8 checklist items confirmed
- Ad-hoc `checkJs` run against `app.js` shows zero compiler errors
- `app.js` remains valid, executable JavaScript (no rename yet)

---

### Task Group 3: Single-Shot Rename to `app.ts`
**Dependencies:** Group 2
**Files to Modify:** `src/scripts/app.js` (removed), `src/scripts/app.ts` (new)
**Estimated Steps:** 4

- [x] 3.0 Perform the single-shot rename and convert the AMD wrapper to TypeScript module syntax
  - [x] 3.1 Define manual verification checklist (4 items) for this group:
    - `git mv` used (or equivalent) so file history is preserved; `src/scripts/app.js` no longer exists, `src/scripts/app.ts` does
    - Each AMD `define([...])` import specifier string (`TFS/WorkItemTracking/RestClient`, `TFS/Work/RestClient`, `q`) has a matching TS `import` statement with an identical module-specifier string (Technical Approach — Module contract)
    - The module's exported entry point is a callable `create(context)`, matching the behavioral (not literal-source-shape) AMD contract `toolbar.html:21` depends on (spec Key Decisions — AMD-emit shape difference is expected, not a regression)
    - Diff review confirms only syntax-shape changes (`define`/callback → `import`/`export function create`) — no functional line changes beyond what Group 2 already applied
  - [x] 3.2 `git mv src/scripts/app.js src/scripts/app.ts`
  - [x] 3.3 Convert the AMD `define([...deps], function(...) {...})` wrapper to TypeScript `import` statements plus `export function create(context) {...}`, keeping every module-specifier string identical to today's `define([...])` array entries (Core Requirement 7's rename step; Technical Approach — Module contract)
  - [x] 3.4 Optionally replace bootstrap JSDoc annotations with native TS syntax where it reduces noise (optional cleanup, no behavior change); execute the checklist from 3.1

**Acceptance Criteria:**
- All 4 checklist items confirmed
- `app.ts` exists at `src/scripts/app.ts`; `app.js` no longer exists as a source file
- No functional/behavioral changes introduced by the rename itself

---

### Task Group 4: Grunt Build Wiring (dual `package-dev`/`package-release`)
**Dependencies:** Group 3
**Files to Modify:** `src/gruntfile.js`
**Estimated Steps:** 4

- [x] 4.0 Add and statically wire the new `tsc` exec target into both packaging paths
  - [x] 4.1 Define manual verification checklist (4 items) for this group (code-review only — full runtime confirmation happens in Group 5, after `node_modules` exists):
    - New `exec.tsc` target added to `gruntfile.js`, matching the existing `exec.package_dev`/`exec.package_release` shape exactly (`command: "tsc -p tsconfig.json"`, `stdout: true`, `stderr: true`)
    - `grunt.registerTask("package-dev", [...])` has `"exec:tsc"` prepended ahead of `"exec:package_dev"`
    - `grunt.registerTask("package-release", [...])` has `"exec:tsc"` prepended ahead of `"exec:package_release"`
    - No other `registerTask` arrays (`publish-dev`, `publish-release`, `default`) were edited directly (they inherit the fix by already depending on `package-dev`/`package-release`)
  - [x] 4.2 Add a new `grunt-exec` target `exec.tsc` to `gruntfile.js`'s `exec` config block, following the existing `exec.package_dev`/`exec.package_release` shape (Core Requirement 3)
  - [x] 4.3 Prepend `"exec:tsc"` into `grunt.registerTask("package-dev", [...])`, ahead of `"exec:package_dev"` (Core Requirement 4)
  - [x] 4.4 Prepend `"exec:tsc"` into `grunt.registerTask("package-release", [...])`, ahead of `"exec:package_release"` (Core Requirement 4)

**Acceptance Criteria:**
- All 4 checklist items confirmed via code review of `gruntfile.js`
- Both `registerTask("package-dev", …)` and `registerTask("package-release", …)` independently list `"exec:tsc"` ahead of their respective `exec:package_*` entry
- This group's verification is explicitly partial (static only) — Group 5 must re-confirm by actually running both Grunt tasks

---

### Task Group 5: `npm install` + SDK Typings Verification + Full Compile Verification
**Dependencies:** Group 4
**Files to Modify:** `src/package.json`, `src/package-lock.json`, `src/scripts/app.ts` (only if typings gaps require scoped `any`/assertion fallback)
**Estimated Steps:** 7

- [x] 5.0 Materialize `node_modules`, confirm SDK typings coverage, and prove both packaging paths actually invoke `tsc`
  - [x] 5.1 Define manual verification checklist (6 items) for this group:
    - `npm install` in `src/` completes without errors; `node_modules/typescript` and `node_modules/@types/q` exist
    - `node_modules/vss-web-extension-sdk/typings/{vss,tfs}.d.ts` inspected directly; confirm coverage of `.fields`, `.description`, `.workItemTypeName`, `.name`, `.id` on the template/work-item response types actually read (document any gap requiring `any`/assertion fallback)
    - `tsc -p tsconfig.json` run standalone from `src/` exits 0 with zero errors under `strict: true`
    - `grunt package-dev` run independently; build log confirms `exec:tsc` ran before `exec:package_dev`, and `src/scripts/app.js`'s output is freshly regenerated (not stale/pre-existing)
    - `grunt package-release` run independently; build log confirms `exec:tsc` ran before `exec:package_release`, and `src/scripts/app.js`'s output is freshly regenerated
    - Any `any`/type-assertion fallback applied is minimal and scoped only to the loosely-typed `.fields` dictionary / JSON-Patch document construction (spec Open Questions), not a broad `any` escape hatch
  - [x] 5.2 Run `npm install` in `src/` to materialize `node_modules` (Core Requirement 1 follow-through)
  - [x] 5.3 Inspect `vss-web-extension-sdk`'s bundled `typings/vss.d.ts`/`tfs.d.ts` against the exact properties `app.ts` reads off template/work-item response objects (Core Requirement 6; Technical Approach step 5)
  - [x] 5.4 Run `tsc -p tsconfig.json` from `src/`; resolve any remaining errors — apply scoped `any`/type-assertion fallback only where the loosely-typed `.fields` dictionary or JSON-Patch document construction genuinely requires it
  - [x] 5.5 Run `grunt package-dev`; inspect the build log to confirm `exec:tsc` executed and produced fresh output ahead of `exec:package_dev`
  - [x] 5.6 Run `grunt package-release`; inspect the build log to confirm `exec:tsc` executed and produced fresh output ahead of `exec:package_release`
  - [x] 5.7 Execute the checklist from 5.1

**Acceptance Criteria:**
- All 6 checklist items confirmed
- `tsc -p tsconfig.json` exits 0 under `strict: true`
- Both `grunt package-dev` and `grunt package-release`, run independently, are confirmed (via build-log inspection, not assumed) to invoke `tsc` and produce freshly-compiled `src/scripts/app.js` — this closes gap-analysis's build-wiring orphan-risk finding

---

### Task Group 6: Manual End-to-End Verification (`.vsix` side-by-side checklist)
**Dependencies:** Group 5
**Files to Modify:** None (verification only — any defect found is fixed via a follow-up pass through Group 2/3, not by editing code in this group)
**Estimated Steps:** 5

- [~] 6.0 SKIPPED (operator decision, 2026-08-08): no real/sandbox Azure DevOps org available to the orchestrator; automated tsc/grunt verification from Groups 1-5 accepted as sufficient sign-off for this task
  - [~] 6.1 SKIPPED: manual verification checklist not executed
  - [~] 6.2 SKIPPED: pre-migration `.vsix` baseline not built
  - [~] 6.3 SKIPPED: post-migration `.vsix` was already built in Group 5 (`grunt package-release`) but not exercised against a live org
  - [~] 6.4 SKIPPED: checklist not executed against any Azure DevOps org
  - [~] 6.5 SKIPPED: N/A — no failing items to route back (checklist not run)

**Acceptance Criteria:**
- All 8 checklist items pass side-by-side, with the one intentional, documented behavior change (genuinely sequential template creation/linking) explicitly confirmed, not merely assumed
- No other user-facing behavior differs from the pre-migration build

---

## Execution Order

1. Build Tooling Bootstrap (5 steps)
2. JSDoc/`checkJs` Bootstrap — Bug Fixes & Cleanup (11 steps, depends on 1)
3. Single-Shot Rename to `app.ts` (4 steps, depends on 2)
4. Grunt Build Wiring (4 steps, depends on 3)
5. `npm install` + Typings + Full Compile Verification (7 steps, depends on 4)
6. Manual End-to-End Verification (5 steps, depends on 5)

Strictly sequential — this is a single-file port with no independent modules to parallelize across.

## Standards Compliance

Follow standards from `.maister/docs/standards/`:
- `global/minimal-implementation.md` — the `VSS` ambient declaration covers only the 4 called methods; no speculative UI-feedback scaffolding despite `StatusIndicator`/`Dialogs` being removed, not repurposed (Group 1, Group 2).
- `global/coding-style.md` — no dead code (Group 2, Core Requirement 11), DRY (Group 2, logging consolidation, Core Requirement 12).
- `global/error-handling.md` — no new error handling added beyond what the two `return`-statement fixes require to keep working (Group 2).
- `build-tooling/packaging.md` — kebab-case `registerTask` names, dev/release override-file pattern, `--rev-version` dev-only, `package.json` `private: true`, `grunt-contrib-copy` vendoring pattern, `addressable: true` manifest entry — all preserved unchanged except the new internal `exec.tsc` target key (Group 4, Core Requirement 16).

## Notes

- **Verification-Driven, not Test-Driven**: each group starts with a 2-8 item manual verification checklist (compiler output, code review, build-log inspection) in place of automated tests — no test framework exists or is introduced (roadmap defers this to Phase 2).
- **Verify Incrementally**: only the current group's checklist is executed after that group — do not attempt to re-run Group 6's full `.vsix` checklist after every earlier group.
- **Mark Progress**: check off steps as completed.
- **Reuse First**: the new `exec.tsc` Grunt target must match the existing `exec.package_dev`/`exec.package_release` shape exactly (Group 4); VSS SDK's own bundled `typings/` and `@types/q` are used directly, with zero hand-rolled `.d.ts` beyond the one ambient `VSS` global (Group 1, Group 5).
