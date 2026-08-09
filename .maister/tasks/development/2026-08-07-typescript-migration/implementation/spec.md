# Specification: TypeScript Migration of `src/scripts/app.js`

## TL;DR
Port the single 617-line AMD module `src/scripts/app.js` to `app.ts` with `strict: true`, compiled via a new `grunt-exec` `tsc` target wired into **both** packaging paths, output landing unchanged at `src/scripts/app.js`. Bundled in the same pass (all pre-decided, zero new judgment calls): fix the broken promise chain, fix two implicit-global bugs, delete dead code (including one import this spec newly identifies as orphaned), consolidate logging, rename `linkImtes`→`linkItems`, and align `package.json`'s version to the Marketplace-published `1.1.17`. No UI change, no test framework, no new SDK.

## Key Decisions
- **`declare const VSS` covers only the 4 methods actually called** (`getWebContext`, `init`, `require`, `register`) — no speculative surface for unused VSS APIs, per the project's minimal-implementation standard.
- **Compiled output emits in place with no `outDir`/`rootDir` remap** — `app.ts` sits at `src/scripts/app.ts` and `tsc` emits directly back to `src/scripts/app.js`, the exact path `vss-extension.json:57` and `toolbar.html:21` hardcode, with zero manifest/HTML changes required.
- **`TFS/WorkItemTracking/Services` (`_WorkItemServices`) import is added to the delete list**, extending clarifications.md Q2's decision. Q2 named 3 AMD imports + `getWorkItemFormService`; this import is used *only* inside that function (confirmed via `codebase-analysis.md` §Dependencies and a direct re-read of `app.js:572-576`), so deleting the function under Q2's own "zero references" rationale makes this 4th import dead by the same logic. Flagged here rather than silently folded in, since it wasn't explicitly enumerated upstream.
- **`package.json`'s version becomes `1.1.17`** (adopts the Marketplace-facing value), not the reverse. `vss-extension.json`'s `1.1.17` is already published to the Marketplace; rolling it back to `0.10.1` would misrepresent a shipped version. `scope-clarifications.md` said "include if trivial" without picking a direction — this spec resolves that gap with the lower-risk direction (bump the unpublished npm-facing number up, don't roll back the published one).
- **AMD module contract is preserved at the behavioral level, not the literal source-shape level.** `tsc`'s AMD emit for a TS file using `export function create(...)` populates a compiler-generated `exports` object rather than literally `return { create: ... }` as today's `app.js` does. This is a normal, expected difference in emitted shape — the module value `VSS.require(["scripts/app"], cb)` hands to `cb` still exposes a callable `.create(context)`, which is the actual contract `toolbar.html:21` depends on. Called out explicitly so the manual verification checklist treats this as expected, not a regression.
- **`strict: true` from the start, bootstrap via JSDoc/`checkJs` before the single-shot `.ts` rename** — both already decided (scope-clarifications.md, research-report.md); restated here as the binding tsconfig/sequencing target.

## Open Questions / Risks
- **`tsc`'s AMD-emit shape change (see Key Decisions above)** — low risk given the loader-level equivalence, but the manual `.vsix` checklist must explicitly exercise `toolbar.html`'s `VSS.require(["scripts/app"], ...)` call path, not just individual function behavior, to confirm the module still resolves correctly end to end.
- **Build-wiring dual-verification is a hard acceptance gate, not a nice-to-have** — per `scope-clarifications.md`, both `grunt package-dev` and `grunt package-release` must be independently run and confirmed to invoke `tsc` before packaging; a partial wiring (one path updated, one not) is a silent-failure mode with zero test coverage to catch it otherwise.
- **VSS SDK's bundled `.d.ts` shape is unverified against real files** — `node_modules` isn't installed yet in `src/`. Budget for `any`/type-assertion fallback on the loosely-typed template `.fields` dictionary and JSON-Patch document arrays (`createWorkItemFromTemplate`, `linkItems`) once `npm install` is run and the real typings are inspected.
- **The promise-chain fix is a genuine behavior change, not a risk-free bug fix** — per `gap-analysis.md`'s defect analysis, teams currently relying on (or coincidentally unaffected by) the racy parallel-creation behavior could see different `justCreatedTasks`-derived link graphs afterward. The manual checklist must specifically exercise a work item with 3+ matching templates and multiple `linkTo` directive types, comparing linked-item graphs before and after.

## Goal
Migrate `src/scripts/app.js` to statically-typed TypeScript (`strict: true`) with zero required changes to `toolbar.html` or `vss-extension.json`, while fixing the promise-chain and implicit-global bugs the type system forces into the open, and folding in the roadmap's already-scoped Phase 1 cleanup items (dead code, logging, `linkImtes` typo, version alignment) — all verified through a manual side-by-side `.vsix` checklist in place of automated tests.

## User Stories
- As an Azure DevOps user clicking "Create linked tasks," I want the exact same template-driven child-work-item creation behavior I have today, so that the TypeScript migration is invisible to me except for one correction: when a work item has multiple matching templates, they are now created and linked in the correct sequential order (previously racy).
- As the maintainer, I want compile-time type checking across the REST client / template / work-item surface, so that future template-filtering changes fail fast in the editor instead of silently at runtime with no test suite to catch them.

## Core Requirements

### Build & Tooling
1. Add `typescript` and `@types/q` as devDependencies in `src/package.json`.
2. Create `src/tsconfig.json`: `"module": "amd"`, `"strict": true`, `"types": ["vss-web-extension-sdk"]`, no `outDir`/`rootDir` remap (in-place emission so `scripts/app.ts` compiles to `scripts/app.js`), `"include"` scoped to `scripts/**/*.ts`. Target ES level should match syntax already running unmodified in production today (`let`/`const`, arrow functions, template literals — ES2015+); no downlevel transpilation is needed since the code already executes as-is in browsers.
3. Add a new `grunt-exec` target (e.g. `exec.tsc`) running `tsc -p tsconfig.json`, following the existing `exec.package_dev`/`exec.package_release` target shape (`stdout: true`, `stderr: true`).
4. Prepend the new `tsc` exec target into **both** `grunt.registerTask("package-dev", [...])` and `grunt.registerTask("package-release", [...])` in `src/gruntfile.js`, ahead of `exec:package_dev`/`exec:package_release` respectively. Both packaging paths must independently invoke `tsc` — this is an explicit, checked requirement (see gap-analysis.md's build-wiring orphan risk), not left to implementation-time judgment.

### Typing
5. Add a hand-written ambient declaration for the non-AMD global `VSS`, covering exactly the 4 methods `app.js`/`toolbar.html` call: `getWebContext()`, `init()`, `require(deps, cb)`, `register(id, cb)`. No speculative coverage of unused VSS APIs.
6. Type the AMD-declared dependencies (`TFS/WorkItemTracking/RestClient`, `TFS/Work/RestClient`, `q`) via the SDK's own bundled `typings/` (`vss.d.ts`, `tfs.d.ts`) and `@types/q` — no DefinitelyTyped search, no hand-rolled `.d.ts` for these.

### Migration Sequencing
7. Bootstrap `app.js` with JSDoc annotations and `allowJs`/`checkJs`, resolve every compiler-surfaced issue (including items 8-9 below) while the file is still `.js`, then perform a single-shot rename to `app.ts`. Do not attempt a multi-file incremental rollout — there is exactly one file.

### Bug Fixes (behavior changes, explicitly decided — not silent)
8. Fix the broken promise chain: `createChildFromTemplate`'s inner callback (`app.js:52-61`) must `return` the result of `createWorkItem(...)`, and `createWorkItem` (`app.js:83-177`) must `return` its `witClient.createWorkItem(...).then(...)` chain. This restores genuinely sequential ("one template at a time") processing so `justCreatedTasks` is fully populated and ordered before any `linkTo` directive evaluates it.
9. Fix `app.js:459`'s implicit global loop variable: `for (category of categories)` → `for (const category of categories)`.
10. Fix `app.js:526`'s `.bugsBehavior`-read-off-a-pending-Promise bug in `GetChildTypes`: **thread the already-fetched `teamSettings` value through as a parameter** (from `AddTasks`, which already fetches it at `app.js:17-18`) instead of independently re-calling `workClient.getTeamSettings(team)` inside `GetChildTypes`. This changes `GetChildTypes`'s signature to accept `teamSettings` and avoids a redundant network call. Restores the `AsTasks`/`AsRequirements` branching logic that has been dead code until now. *(Resolved per spec-audit.md Finding 2 — audit gate decision.)*
10a. Preserve the identical `PreviouslyCreatedTask`/`PreviouslyJustCreatedTask` `linkTo` branches (`app.js:123-138`) as-is, with no behavior change — both branches are byte-for-byte equivalent today and this is not being treated as a bug. Add a code comment at both branches noting they are currently equivalent, for any future maintainer who might expect them to diverge. *(Resolved per spec-audit.md Finding 1 — audit gate decision.)*

### Cleanup (roadmap Phase 1 items, folded into this port)
11. Delete dead code: the `Controls`, `StatusIndicator`, `Dialogs` AMD imports, the dead `getWorkItemFormService` function (`app.js:572-576`), and — per this spec's Key Decisions — the now-orphaned `TFS/WorkItemTracking/Services` (`_WorkItemServices`) import, since it has no remaining reference once `getWorkItemFormService` is removed.
12. Consolidate `Log`, `WriteTrace`, `WriteLog` (byte-identical, `app.js:578-588`) and `WriteError` into a single typed logging utility (e.g. one function taking a level/message, or two functions: info + error). ~6 call sites across the file update to the consolidated utility (`Log` ×1, `WriteTrace` ×3, `WriteError` ×2); `WriteLog` has zero live call sites and is pure dead code, not just a duplicate. *(Call-site count corrected per spec-audit.md — was originally overstated as "~15+".)*
13. Rename `linkImtes` → `linkItems` at its definition (`app.js:179`) and all call sites (`app.js:76, 99, 119, 128, 136, 144, 152, 160`).
14. Align `src/package.json`'s `"version"` field to `"1.1.17"`, matching the already-published `vss-extension.json` value (see Key Decisions for direction rationale).

### Compatibility (must hold, zero exceptions)
15. Preserve the AMD module's behavioral contract: the module value resolved by `VSS.require(["scripts/app"], cb)` must expose a callable `create(context)` with identical parameter/dispatch semantics (`context.workItemIds[]`, `context.id`, `context.workItemId`) to today's implementation.
16. Preserve every documented convention in `.maister/docs/standards/build-tooling/packaging.md`: kebab-case `registerTask` names (unchanged — only the new internal `exec` target key is added, no new top-level task), the dev/release override-file pattern, `--rev-version` on dev packaging only, `package.json` `"private": true`, the `grunt-contrib-copy` vendoring pattern for `VSS.SDK.min.js`, and `addressable: true` on the `scripts/app.js` manifest file entry.

## Reusable Components

### Existing Patterns to Follow
- **`grunt-exec` target shape** (`src/gruntfile.js:4-23`, `exec.package_dev`/`exec.package_release`/`exec.publish_dev`/`exec.publish_release`) — the new `tsc` target should match this exact shape (`command`, `stdout: true`, `stderr: true`) rather than introducing a different build-step convention. `grunt-exec` is already a devDependency; no new Grunt plugin is added.
- **Packaging conventions** (`.maister/docs/standards/build-tooling/packaging.md`) — the authoritative reference for how any new Grunt-level artifact (task names, exec targets) should be named and wired; see Core Requirement 16.
- **VSS SDK's own bundled `typings/`** (`node_modules/vss-web-extension-sdk/typings/{vss,tfs,rmo}.d.ts` once installed) — used directly via `"types": ["vss-web-extension-sdk"]`, no typings authored from scratch for the 2 REST clients this project actually uses.
- **`@types/q`** (current, v1.5.8, TS 4.5+) — used directly for `Q`, no hand-written stub.

### New Components Required (and why nothing existing covers them)
- **`src/tsconfig.json`** — does not exist; first TypeScript config in this project (confirmed clean slate, `codebase-analysis.md`).
- **Ambient `declare const VSS: {...}` block** — the `VSS` global is injected via `<script>` tag before AMD resolution (`toolbar.html:8`), so it has no AMD-typed analog anywhere in the SDK's bundled typings; a few lines, scoped to the 4 methods actually called.
- **Consolidated logging utility function** — replaces 4 existing near-duplicate functions; a refactor of existing logic, not a new capability, but does not "reuse" any of the 4 originals as-is since the whole point is collapsing them.
- **Two `return` statements** in `createChildFromTemplate`/`createWorkItem` — the fix is additive (adding missing `return`s), not a new component.

No existing project code implements build tooling, ambient declarations, or a typed logger — this is confirmed greenfield tooling work within an otherwise single-file codebase (`requirements.md`: "None — first TypeScript setup in this project").

## Technical Approach

**Sequencing**: (1) Add tsconfig/devDependencies/ambient declaration without touching `app.js` yet. (2) Bootstrap `app.js` with JSDoc + `allowJs`/`checkJs`, resolving every compiler-surfaced issue in place — this is where bug fixes 8-10 and cleanup 11-13 happen, all while still reversible as `.js`. (3) Single-shot rename to `app.ts`, remove the now-unnecessary JSDoc annotations in favor of native TS syntax where it reduces noise (optional, not required for correctness). (4) Wire and verify the `grunt-exec` `tsc` target into both packaging paths. (5) Run `npm install` in `src/` to materialize `node_modules` and confirm the SDK's bundled typings cover the exact properties read off template/work-item response objects (`.fields`, `.description`, `.workItemTypeName`, `.name`, `.id`) — expect some `any`/assertion fallback for the loosely-typed `.fields` dictionary and JSON-Patch document construction, not a surprise mid-port.

**Module contract**: Each existing AMD dependency (`app.js:1`, e.g. `"TFS/WorkItemTracking/RestClient"`, `"q"`) becomes a TypeScript `import` statement whose module specifier string matches today's `define([...])` array entry exactly, so `tsc`'s AMD emit preserves the same runtime module-id resolution `VSS.SDK.min.js`'s internal loader already handles. `VSS` itself stays outside the `import` list (global, per the ambient declaration).

**Data flow**: Unchanged. `create(context)` → `AddTasks(workItemId)` → REST calls via typed `witClient`/`workClient` → template fetch/validate/filter → JSON-Patch construction → `createWorkItem` → relation-linking (`linkItems`, post-rename). The promise-chain fix changes *timing* (genuinely sequential vs. racy-parallel), not the data flow shape.

## Implementation Guidance

### Verification Approach (substitutes for automated tests — see TDD gate note below)
No automated test framework exists or is introduced by this task (`roadmap.md`/`tech-stack.md` both explicitly defer this to Phase 2; `scope-clarifications.md` confirms the standard TDD Red/Green gate is skipped/adapted for this task). In its place:
- Each implementation step group gets a **manual verification checklist of 2-8 items**, mirroring the standard per-group test-count guidance but executed against a real or sandbox Azure DevOps org's side-by-side `.vsix` (pre-migration vs. post-migration), not written as test code.
- The checklist must cover, at minimum: `IsValidTemplateWIT`/`IsValidTemplateTitle` (both JSON and legacy bracket filter syntax), `SortTemplates` ordering, the promise-chain fix (work item with 3+ matching templates, verifying sequential creation and correct `justCreatedTasks` ordering), all six `linkTo` directive branches (`ToAllOtherChilds`, `ToAllJustCreatedTasks`, `PreviouslyCreatedTask`, `PreviouslyJustCreatedTask`, `SecondPreviouslyJustCreatedTask`, `FirstJustCreatedTask`, `SecondJustCreatedTask`), the `AsTasks`/`AsRequirements` `bugsBehavior` branches (dead until the line-526 fix), and the `VSS.require(["scripts/app"], ...)` module-resolution path end to end.
- Build-pipeline verification is a separate, explicit checklist item: run `grunt package-dev` and `grunt package-release` independently and confirm both invoke `tsc` and produce a freshly-compiled `scripts/app.js` (not stale/pre-existing output).

### Standards Compliance
- **`.maister/docs/standards/build-tooling/packaging.md`** — kebab-case task naming, dev/release override-file pattern, `--rev-version` dev-only, `package.json` `private: true`, vendored-SDK copy pattern, `addressable: true` file entries. See Core Requirement 16 for the specific preservation list.
- **`.maister/docs/standards/global/minimal-implementation.md`** — no speculative stubs (the `VSS` ambient declaration covers only called methods; no UI-feedback scaffolding is added despite the dead `StatusIndicator`/`Dialogs` imports being removed, not repurposed).
- **`.maister/docs/standards/global/coding-style.md`** — no dead code (Core Requirement 11), DRY (logging consolidation, Core Requirement 12).
- **`.maister/docs/standards/global/error-handling.md`** — out of scope to add new error handling (no `.catch()`/`.fail()` additions beyond what's needed for the promise-chain fix); the file's current sparse error handling is preserved as-is except where the two return-statement fixes require it to keep working.

## Out of Scope
- Automated test framework introduction (explicitly deferred to Phase 2 per `roadmap.md`/`tech-stack.md`).
- New features, UI feedback (spinner/success/error dialog/toast) — the dead `StatusIndicator`/`Dialogs` imports are deleted, not implemented.
- Adopting `azure-devops-extension-sdk` (the newer SDK) — confirmed a separate, larger, non-drop-in migration (`research-report.md` Finding 8).
- CI/CD pipeline setup.
- Converting `Q` promises to native `Promise`/`async`/`await` — `@types/q` types are sufficient; this conversion is an optional, separately-scoped follow-up per the research report.
- Reconciling the `vss-web-extension-sdk` declared version (`^1.104.0`) vs. resolved version (`1.110.0`) discrepancy in `tech-stack.md` — pre-existing, orthogonal documentation drift, not a migration blocker.
- `AddTasks`'s own top-level return value (fire-and-forget across different work items when multiple are selected) — only the sequencing *within* a single `AddTasks` call (across that work item's templates) is in scope for the promise-chain fix.

## Success Criteria
- `tsc -p tsconfig.json` compiles `src/scripts/app.ts` with zero errors under `strict: true`.
- `grunt package-dev` and `grunt package-release`, run independently, both invoke the new `tsc` target and produce a freshly-compiled `src/scripts/app.js` (verified by build log inspection, not assumed).
- `toolbar.html` and `vss-extension.json` require zero changes; `VSS.require(["scripts/app"], ...)` resolves the compiled module and successfully calls `.create(context)`.
- The full manual `.vsix` verification checklist (Implementation Guidance) passes side-by-side against the pre-migration build, with the one intentional, documented behavior change: templates are created and linked in genuinely sequential order (promise-chain fix).
- Zero remaining references to `linkImtes`, `Controls`, `StatusIndicator`, `Dialogs`, `_WorkItemServices`/`TFS/WorkItemTracking/Services`, or the 4 separate logging functions.
- `src/package.json`'s version reads `1.1.17`, matching `vss-extension.json`.
- No user-facing behavior change from an Azure DevOps user's perspective, except the corrected task-creation ordering.
