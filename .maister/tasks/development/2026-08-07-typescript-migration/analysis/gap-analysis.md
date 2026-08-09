# Gap Analysis: TypeScript Migration of Linked-Tasks-Automation

## TL;DR
The mechanical migration path (tooling, VSS/Q typing, single-shot rename) is fully specified by prior research and codebase analysis — no gaps there. Two new gaps surface from direct verification: (1) the planned `tsc` build step risks becoming an **orphaned capability** if not wired into *both* `registerTask("package-dev", …)` and `registerTask("package-release", …)` in `gruntfile.js`, silently shipping stale/missing JS; (2) the project roadmap (`roadmap.md`) lists **logging consolidation** and **version alignment** as explicit Phase-1 items that `clarifications.md`'s three resolved decisions never addressed — real scope gaps, not yet decided. Separately, the TDD Red/Green gate should not apply here: the roadmap explicitly defers "Automated tests" to Phase 2, and no test framework exists to write a failing test against.

## Key Decisions
- **`has_reproducible_defect: true` but TDD Red/Green gate recommended SKIP** — a real, reproducible defect exists (broken promise chain), but `roadmap.md` line 17 ("Automated tests... [Phase 2]... after Phase 1 lands") and `tech-stack.md` line 23 ("Adding a test framework... is on the roadmap, to follow the TypeScript migration") both explicitly place test-framework introduction *after* this migration. Forcing a Red/Green gate here would require standing up Jest mid-task, contradicting the already-resolved sequencing and expanding scope no one asked for. The compiler + manual `.vsix` checklist (already the agreed verification strategy per both `codebase-analysis.md` and `research-report.md`) should substitute for the gate on this task.
- **`creates_new_entities: false`, `involves_data_operations: false`, `ui_heavy: false`** — confirmed by direct read of `toolbar.html`/`vss-extension.json`: output path, manifest, and HTML entry point are all unchanged by design (research Finding 3, codebase-analysis Impact Assessment), so there is no new UI surface, no new REST/data capability, and no new domain entity — only build config (`tsconfig.json`, ambient `.d.ts`) is added.

## Open Questions / Risks
- **Build-wiring orphan risk**: `gruntfile.js:46-47` currently defines `registerTask("package-dev", ["exec:package_dev"])` and `registerTask("package-release", ["exec:package_release"])` with no compile step at all. Adding a `tsc` exec target without prepending it to *both* arrays means `grunt package-dev`/`grunt package-release` (and therefore `publish-dev`/`publish-release`/`default`, all of which chain through these two tasks) would package/publish whatever `.js` happens to be on disk, not a freshly-compiled one — a silent, hard-to-notice failure mode.
- **No `node_modules` installed** (`src/` has no `node_modules` directory) — the VSS SDK's bundled `.d.ts` shape (specifically whether `WorkItemTemplateReference`/`WorkItemTemplate` types cover the exact properties `app.js` reads: `.fields`, `.description`, `.workItemTypeName`, `.name`, `.id`) has not been verified against real declaration files, only against the SDK's README/registry metadata. Expect some `any`/type-assertion fallback for the loosely-typed template `.fields` dictionary and JSON-Patch document array construction; this should be budgeted for, not treated as a surprise mid-port.
- **`linkImtes` → `linkItems` typo**: confirmed still present at all ~8 call sites (`app.js:76,99,119,128,136,144,152,160,179`). Zero external impact (internal-only function name), but touches enough call sites that it's worth an explicit go/no-go rather than silent inclusion.

## Summary
- **Risk Level**: Medium (up from the prior report's "Low-Medium" — the build-wiring orphan risk and the two undecided roadmap-scope items are net-new since that assessment)
- **Estimated Effort**: Medium
- **Detected Characteristics**: modifies_existing_code, has_reproducible_defect (gate adapted, not skipped-silently)

## Task Characteristics
- Has reproducible defect: yes (broken promise chain — real, but TDD gate recommended adapted/skipped per rationale above)
- Modifies existing code: yes (rewriting `src/scripts/app.js` in place)
- Creates new entities: no (tsconfig.json/ambient declarations are build config, not domain entities; no new manifest contributions)
- Involves data operations: no (existing REST calls preserved as-is; no new CRUD surface introduced)
- UI heavy: no (headless extension logic; `toolbar.html`/`vss-extension.json` unchanged by design)

## Gaps Identified

### Missing Features (build/tooling artifacts that don't exist yet)
- `src/tsconfig.json` — does not exist. Must set `"module": "amd"`, `"outDir"`/`"rootDir"` (or `outFile`) so compiled output lands at the literal `src/scripts/app.js` path (both `vss-extension.json:57` and `toolbar.html:21` hardcode it), and `"types": ["vss-web-extension-sdk"]`.
- `typescript` and `@types/q` devDependencies — confirmed absent from `src/package.json:2-11` (only `grunt`, `grunt-cli`, `grunt-contrib-clean`, `grunt-contrib-copy`, `grunt-exec`, `requirejs`, `tfx-cli`, `vss-web-extension-sdk`).
- Ambient `declare const VSS: {...}` (or `declare global` block) — the `VSS` global is used 12+ times in `app.js` (confirmed at lines 89, 512, 529, 536, 538, 541, 542, 544, 547, 549, 551, 601) but never AMD-declared; nothing currently types it.
- A new `grunt-exec` target running `tsc -p tsconfig.json`, plus the wiring described in the "build-wiring orphan risk" item above — `gruntfile.js` currently has zero compile step anywhere in its 52 lines.
- `npm run`-style build script — `package.json:15` `"scripts": {}` is empty; no existing convention to extend.

### Incomplete Features
- `src/scripts/app.js` itself: 100% untyped (0 of 617 lines have any type annotation or JSDoc), confirmed by direct read. The whole file is the migration target — no partial TS/JSDoc bootstrap exists yet (consistent with codebase-analysis's "clean tooling slate" finding).

### Behavioral Changes Needed (already decided in clarifications.md — restated for completeness)
- Fix broken promise chain in `AddTasks`/`createChildFromTemplate`/`createWorkItem` (Q1 — decided: fix).
- Delete 3 dead AMD imports (`Controls`, `StatusIndicator`, `Dialogs`) + dead `getWorkItemFormService` function (Q2 — decided: delete).
- Fix `app.js:459` implicit-global loop variable and `app.js:526` `.bugsBehavior`-off-a-pending-Promise bug (Q3 — decided: fix both).

### Behavioral Changes NOT Yet Decided (roadmap-scope gap — new finding)
- **Logging consolidation**: `roadmap.md` line 21 lists "Consolidate logging — replace the four ad-hoc logging functions (`Log`, `WriteTrace`, `WriteLog`, `WriteError`) with a single typed logger utility `[Effort: S]`" as a Phase-1 item. `clarifications.md` never raised this question. `Log`/`WriteTrace`/`WriteLog` are confirmed byte-for-byte identical (`app.js:578-588`).
- **Version alignment**: `roadmap.md` line 22 and `tech-stack.md` line 61 both list resolving the `vss-extension.json` (`1.1.17`) vs. `package.json` (`0.10.1`) mismatch as a Phase-1 item. `clarifications.md` never raised this question either.
- **`linkImtes` → `linkItems` rename**: flagged as a "known typo" by codebase-analysis but never turned into a decision.

## Existing Feature Impact Assessment (change_type: modificative + refactor-based, mixed)

This is a headless build-tooling migration with no navigable UI, so the standard reachability/discoverability table doesn't apply in its usual form. The equivalent three-layer check for this task's domain is **build-pipeline integrity**, not UI reachability:

| Layer | Check | Status | Evidence |
|-------|-------|--------|----------|
| 1. Compile ("Backend") | `tsc` step exists and emits to `scripts/app.js` | Not yet built — planned, config not yet written | `tsconfig.json` absent |
| 2. Build-task definition | `exec:tsc`-equivalent Grunt target defined | Not yet built — planned | `gruntfile.js` has no compile step today |
| 3. Packaging invocation ("User Access") | New target is prepended into `registerTask("package-dev", …)` AND `registerTask("package-release", …)` | **At risk of being missed** — both research and codebase-analysis say "ahead of `exec:package_dev`/`exec:package_release`" but neither calls out that BOTH `registerTask` arrays (not just one) must be updated | `gruntfile.js:46-47` |

**Orphan risk**: If Layer 3 is only partially wired (e.g., only `package-dev` updated), `grunt package-release` / `publish-release` would ship a stale or pre-migration `app.js` while `package-dev`/`publish-dev` work correctly — a classic "works in dev, broken in the path nobody tests as often" failure mode, worsened by zero test coverage.

**Compatibility requirement**: Strict — the AMD module contract (`define([...], function(...) { return { create: function(context) {...} } })`) and the exact output path must be byte-identical in shape to what `toolbar.html:21`'s `VSS.require(["scripts/app"], ...)` and `vss-extension.json:57`'s `"path": "scripts/app.js"` expect. No compatibility shim is available or needed since there is exactly one consumer.

## Defect Analysis (has_reproducible_defect)

### Reproduction Data
- **Steps**: Trigger "Create linked tasks" on a work item whose applicable category has 2+ matching templates (alphabetically sorted by `SortTemplates`).
- **Inputs**: Any work item + team with 2 or more templates passing `IsValidTemplateWIT`/`IsValidTemplateTitle` for that work item's type.
- **Expected**: Templates process strictly one at a time (`Q.when()` chain built in `AddTasks:40-44`), so `justCreatedTasks` is fully populated and ordered by the time any `linkTo` directive (`ToAllJustCreatedTasks`, `PreviouslyCreatedTask`, `PreviouslyJustCreatedTask`, `SecondPreviouslyJustCreatedTask`, `FirstJustCreatedTask`, `SecondJustCreatedTask` — `app.js:109-162`) evaluates it.
- **Actual**: `createChildFromTemplate`'s inner `.then()` callback (`app.js:53-60`) calls `createWorkItem(...)` without `return`ing it, and `createWorkItem` (`app.js:83-177`) never returns its own `witClient.createWorkItem(...).then(...)` chain. The outer `chain` promise (`AddTasks:40-44`) therefore resolves as soon as `getTemplate(template.id)` resolves — a template-fetch network call — not after the work item is actually created and linked. All templates' `createWorkItem` calls effectively race in parallel instead of running sequentially.

### Root Cause Hypothesis
Two missing `return` keywords, a classic "forgot to return the inner promise" JS anti-pattern invisible under non-strict, untyped JS. TypeScript's `Promise<void>`-return-type checking on these two functions will force both omissions into the open as compile errors once the functions are annotated — the fix (adding the two `return`s) is exactly what clarifications.md Q1 already decided to do.

### Regression Risk Areas
- All six `linkTo` directive branches inside `createWorkItem` (`app.js:109-162`) — fixing the chain changes *when* they fire and what `justCreatedTasks` contains at that moment. Teams currently relying on (or coincidentally unaffected by) the racy behavior could see different link graphs after the fix — this is a genuine behavior change shipped as a "bug fix," not risk-free.
- Manual verification checklist must specifically exercise a work item with 3+ matching templates and multiple different `linkTo` directive types, comparing linked-item graphs before and after the fix.

## Issues Requiring Decisions

### Critical (Must Decide Before Proceeding)
1. **TDD Red/Green gate applicability for this task**
   - Options: (a) Skip the TDD Red/Green gate for this task and rely on the manual `.vsix` verification checklist (per research-report.md Finding 10/Conclusion 4) as the acceptance mechanism for the promise-chain fix; (b) Apply the gate strictly, which requires introducing a minimal test framework (e.g., Jest) just to characterize this one bug.
   - Recommendation: (a) Skip/adapt. `roadmap.md` explicitly places "Automated tests" in Phase 2 ("after Phase 1 lands"); introducing a test framework now to satisfy a generic gate would contradict the project's own already-documented sequencing and silently expand scope beyond "pure type-safety port."

2. **Build-pipeline wiring for the new `tsc` step**
   - Options: (a) Explicitly require the plan/spec to prepend the new compile target into *both* `registerTask("package-dev", [...])` and `registerTask("package-release", [...])` in `gruntfile.js`, with a verification step confirming both `grunt package-dev` and `grunt package-release` produce freshly-compiled output; (b) Leave the exact wiring to implementation-time judgment.
   - Recommendation: (a). Given zero test coverage, a silently-orphaned compile step (compiled but never invoked by one of the two packaging paths) would not be caught by anything except manual `.vsix` inspection — this must be an explicit, checked spec requirement, not an implicit assumption.

### Important (Should Decide)
1. **Logging consolidation** (`Log`/`WriteTrace`/`WriteLog`/`WriteError` → single typed logger utility)
   - Options: Include in this migration (matches `roadmap.md` Phase-1 item, Effort S, zero user-facing risk) / Defer to a follow-up task.
   - Default: Include — it's explicitly scoped into "Phase 1: Ground Refactor to TypeScript" in the project roadmap and costs little extra given the file is already being fully rewritten.

2. **Version alignment** (`package.json` `0.10.1` vs. `vss-extension.json` `1.1.17`)
   - Options: Align versions as part of this migration (matches `roadmap.md`/`tech-stack.md` Phase-1 item) / Leave as pre-existing, unrelated technical debt.
   - Default: Include if trivial (roadmap explicitly ties it to Phase 1), but confirm which version should win (Marketplace-facing `1.1.17` vs. npm-facing `0.10.1`) since that's a product decision, not a technical one.

3. **`linkImtes` → `linkItems` typo rename**
   - Options: Rename now (internal-only, ~8 call sites, zero external/behavioral impact) / Leave as-is to minimize diff noise during the port.
   - Default: Rename — free given the file is being fully rewritten, and the current name is confirmed unreferenced outside `app.js`.

4. **tsconfig.json strictness level for the initial bootstrap**
   - Options: Enable `strict: true` from the start (fits a single-shot-rename strategy, one file, no incremental multi-file rollout to stage flags across) / Progressive flag enablement per the TS handbook's general guidance (`noImplicitAny` → ... → `strictNullChecks` last).
   - Default: `strict: true` from the start — the research report's own rationale for choosing single-shot-rename over classic incremental migration (Finding 9) implies the flag-staging rationale behind progressive strictness doesn't apply here either; a small, one-time-viewed file benefits more from full strict feedback in one pass.

## Recommendations
- Treat the two Critical items above as required spec content, not implementation-time judgment calls — both are silent-failure-mode risks in a codebase with zero automated tests.
- Fold the four Important decisions into the specification phase's open-questions resolution rather than deferring them; all four are small (S/trivial effort) and the file is being rewritten wholesale regardless, so the marginal cost of resolving them now is low.
- Before implementation starts, run `npm install` in `src/` to materialize `node_modules` and directly inspect `vss-web-extension-sdk`'s bundled `typings/tfs.d.ts`/`vss.d.ts` against the exact properties `app.js` reads off template/work-item response objects — this closes the "unverified against real .d.ts files" gap noted above before it costs mid-port rework.
- Carry forward research-report.md's and codebase-analysis.md's tooling/typing/sequencing recommendations unchanged — this gap analysis found no reason to deviate from `grunt-exec`+`tsc`, SDK-bundled typings, `@types/q`, or the JSDoc/checkJs-bootstrap-then-single-shot-rename sequencing.

## Risk Assessment
- **Complexity Risk**: Low-Medium — single file, single consumer, narrow SDK surface (unchanged from codebase-analysis.md).
- **Integration Risk**: Medium — the build-wiring orphan risk (registerTask arrays) is a new, concrete finding not previously called out at this level of specificity; must be an explicit spec/plan checklist item.
- **Regression Risk**: Medium — the promise-chain fix is a genuine behavior change (not risk-free despite being "correct"), and zero automated tests means the only backstop is the manual `.vsix` checklist plus the TypeScript compiler itself.
