# Codebase Analysis Report

**Date**: 2026-08-08
**Task**: Migrate the Linked-Tasks-Automation Azure DevOps extension to TypeScript
**Description**: Migrate `src/scripts/app.js` (617 lines, AMD/RequireJS, Grunt build, VSS SDK, Q promises, no automated tests) to TypeScript.
**Analyzer**: codebase-analyzer skill (3 Explore agents: File Discovery + Code Analysis, Context Discovery, Migration Target)

---

## TL;DR
Confirmed current-state baseline: a single 617-line AMD module (`src/scripts/app.js`) with zero TypeScript, zero tests, and a clean tooling slate — nothing to reconcile before starting. This corroborates the prior research pass (`analysis/research-context/research-report.md`) line-for-line, including its two headline pre-existing bugs (implicit-global loop var, `.bugsBehavior` read off a pending Promise) and its tooling recommendation (`grunt-exec` + `tsc`, not `grunt-ts`). This report additionally surfaces one new defect the research pass did not call out: a broken sequential-promise-chain bug in `AddTasks`/`createChildFromTemplate`/`createWorkItem` that silently breaks the "one template at a time" ordering guarantee. Risk is Low-Medium: single file, single consumer chain, but zero test coverage.

## Key Decisions
- **Confirm, don't repeat, the research report's tooling/typing choices** (`grunt-exec` + `tsc`, VSS SDK's bundled `typings/`, `@types/q`, hand-written `declare const VSS`) — this analysis independently re-derived the same facts from the live file tree, so planning should cite the research report for rationale and this report for current-state proof.
- **Treat the newly-found broken-chain bug (`AddTasks`) as an explicit migration decision point, not a silent fix** — async typing (`Promise<void>` return types) will force the missing `return` statements into the open; the plan should decide up front whether to fix ordering behavior or preserve it byte-for-byte and only fix typing.
- **Do not add `Controls`/`StatusIndicator`/`Dialogs`/`_WorkItemServices` to the typed dependency list** — all four AMD imports are dead in the current code; carrying them into the TS version's `define([...])` header only if the plan decides to add UI feedback (spinner/error dialog), otherwise drop them.

## Open Questions / Risks
- **Zero test coverage** — no test files, no test script, nothing to verify behavior parity against; manual side-by-side `.vsix` testing is the only safety net (confirmed by both this analysis and the prior research).
- **Newly found bug**: `createChildFromTemplate`'s inner callback never `return`s its promise, and `createWorkItem` never returns its own promise either — the "sequential, one-template-at-a-time" chain built in `AddTasks` does not actually wait for network calls to complete, so `justCreatedTasks` ordering (relied on by several `linkTo` directives) is not guaranteed today. Needs an explicit decision: fix during migration or preserve as-is with a `// TODO` comment.
- Two more latent bugs (both already flagged in the research report, re-confirmed here): `app.js:459` implicit global loop variable (`for (category of categories)`), and `app.js:526` reading `.bugsBehavior` directly off a pending `Promise` (always `undefined`, making the `AsTasks`/`AsRequirements` branches dead code).
- `getWorkItemFormService` (lines 572-576) is dead, broken code (returns the promise itself before it resolves) and is never called — safe to delete, but confirm with the plan owner it isn't a placeholder for planned functionality.
- No UI feedback exists during task creation today (no spinner, no success/error toast) despite `StatusIndicator`/`Dialogs` being imported — worth a product decision on whether the TS migration should add this or stay a pure type-safety port.

---

## Summary

The codebase is a single-purpose Azure DevOps extension whose only source module is `src/scripts/app.js` (617 lines, AMD/RequireJS `define(...)`, no test files, no TypeScript, no lint tooling anywhere in the repo). This analysis independently confirms the current-state facts the prior research pass (`analysis/research-context/research-report.md`) already established — clean tooling slate, VSS SDK bundled typings, `grunt-exec` as the integration point, `@types/q` as current — and adds a full function-by-function catalogue, an execution-flow trace, and one previously-undocumented correctness bug (broken promise chaining in the task-creation sequence) that the TS compiler's stricter async typing will force into the open.

---

## Files Identified

### Primary Files

**src/scripts/app.js** (617 lines)
- The entire application logic: AMD module wrapping ~24 functions plus one exported `create(context)` entry point.
- Sole migration target. Consumed by `toolbar.html` via `VSS.require(["scripts/app"], ...)`.

### Related Files

**src/toolbar.html** (41 lines)
- Extension's contribution entry point (iframe target). Loads `lib/VSS.SDK.min.js`, calls `VSS.init()`, registers the `create-linked-tasks-button` action, and dynamically loads `scripts/app` via `VSS.require`, then calls `app.create(actionContext)`.
- Must keep resolving the compiled TS output at the same module id/path.

**src/vss-extension.json** (83 lines)
- Extension manifest. Declares `scripts/app.js` as an `addressable: true` file entry (line 57) and the single contribution (`create-linked-tasks-button`, targets the work-item toolbar/context menu).
- Compiled TS output path must match this entry exactly, or this file and `toolbar.html` must be updated in lockstep.

**src/gruntfile.js** (51 lines)
- Build/package/publish pipeline (`grunt-exec` shelling to `tfx-cli`, `grunt-contrib-copy` for vendoring `VSS.SDK.min.js`, `grunt-contrib-clean`). No compile/bundle/lint step exists today — a `tsc` step must be inserted ahead of `exec:package_dev`/`exec:package_release`.

**src/package.json** / **src/package-lock.json**
- Confirms zero TypeScript-related devDependencies today (`typescript`, `@types/*`, `grunt-ts`, `ts-loader`, `webpack`, `esbuild` all absent). Only pre-existing devDependencies: `grunt`, `grunt-cli`, `grunt-contrib-clean`, `grunt-contrib-copy`, `grunt-exec`, `requirejs`, `tfx-cli`, `vss-web-extension-sdk`. `q` is not an npm dependency at all — it's supplied at runtime by the VSS SDK's internal AMD loader.

**src/configs/dev.json**, **src/configs/release.json**
- Grunt override files (`public: false` / `public: true`) consumed by `tfx extension create/publish --overrides-file`. Unrelated to TS migration but must not be disturbed.

**src/lib/VSS.SDK.min.js**
- Vendored SDK bundle (from `vss-web-extension-sdk`, resolved version 1.110.0 despite `^1.104.0` in `package.json`). Provides the global `VSS` object and the internal AMD loader that resolves `TFS/*`, `VSS/*`, and `"q"` module ids at runtime. Ships its own `.d.ts` typings (`vss.d.ts`, `tfs.d.ts`, `rmo.d.ts`) usable directly via `"types": ["vss-web-extension-sdk"]` in `tsconfig.json`.

**.maister/docs/standards/build-tooling/packaging.md**
- Documents conventions that must survive the migration: kebab-case Grunt task names, dev/release override-file pattern, `--rev-version` only on dev packaging, `package.json` name/`vss-extension.json` id parity, `private: true`, flat vendoring of `VSS.SDK.min.js` into `src/lib/`, and the `addressable: true` file-manifest contract.

---

## Current Functionality

`app.js` is an AMD module (`define([...7 deps], function(...) {...})`) exporting one public method, `create(context)`. Execution flow:

1. `toolbar.html` loads `VSS.SDK.min.js` globally, calls `VSS.init()`, and registers the `create-linked-tasks-button` action.
2. On invocation, VSS SDK calls into `toolbar.html`'s handler, which does `VSS.require(["scripts/app"], function(app) { app.create(actionContext); })`.
3. `create(context)` sets module-level `ctx = VSS.getWebContext()`, then dispatches `AddTasks(workItemId)` for each work item id found on `context` (`context.workItemIds` array, `context.id`, or `context.workItemId`).
4. `AddTasks` fetches team settings and the work item, determines valid child work-item types (`GetChildTypes`, via a category-tree walk that accounts for the team's `bugsBehavior` setting), fetches and sorts matching templates, then chains `createChildFromTemplate` calls intending sequential (one-at-a-time) processing.
5. `createChildFromTemplate` validates each template against WIT-type and title filters (`IsValidTemplateWIT`, `IsValidTemplateTitle`, `checkRules`, `matchField`, both a modern JSON filter scheme and a legacy bracket/`{token}` scheme), then calls `createWorkItem`.
6. `createWorkItem` builds a JSON-Patch document from the template (`createWorkItemFromTemplate`, handling `@me`, `@currentiteration`, and `{ParentField}` token substitution), POSTs the new work item, links it to the parent, and processes `linkTo` directives to cross-link against other newly-created or previously-created siblings (`linkImtes` — a function-name typo for "linkItems").

### Key Components/Functions

- **`create`** (exported entry point): dispatches per-work-item `AddTasks` calls.
- **`AddTasks`**: orchestrates the whole per-work-item flow; builds the (broken, see below) sequential template-processing chain.
- **`createChildFromTemplate` / `createWorkItem` / `linkImtes`**: template validation → work-item creation → relation linking.
- **`createWorkItemFromTemplate`**: field-mapping/templating logic (`@me`, `@currentiteration`, `{ParentField}` tokens).
- **`checkRules` / `matchField` / `IsValidTemplateWIT` / `IsValidTemplateTitle` / `extractJSON` / `IsJsonString`**: dual-syntax (JSON vs. legacy) template filter evaluation.
- **`GetChildTypes` / `findWorkTypeCategory`**: category-tree walk to compute valid child work item types, gated by team `bugsBehavior`.
- **`Log` / `WriteTrace` / `WriteLog` / `WriteError`**: three duplicate console.log wrappers plus one console.error wrapper.
- **`getWorkItemFormService`**: dead code, never called, and internally broken (returns a promise object synchronously instead of its resolved value).

### Data Flow

VSS SDK context → `create(context)` → `AddTasks(workItemId)` → REST calls via `witClient`/`workClient` (both AMD-supplied) → template fetch/validate/filter → JSON-Patch document construction → `createWorkItem` REST POST → relation-linking REST PATCH calls (`linkImtes`) → console logging only (no UI feedback surfaced to the user at any stage).

---

## Dependencies

### Imports (What This Depends On)

AMD `define()` header (`app.js:1-2`):
- `TFS/WorkItemTracking/Services` (`_WorkItemServices`) — **dead**, referenced only inside the dead `getWorkItemFormService` function.
- `TFS/WorkItemTracking/RestClient` (`_WorkItemRestClient`) — heavily used.
- `TFS/Work/RestClient` (`workRestClient`) — used for team settings.
- `q` (`Q`) — used via `Q.when()`, `Q.all()`; not an npm dependency, supplied by the VSS SDK's internal AMD loader.
- `VSS/Controls`, `VSS/Controls/StatusIndicator`, `VSS/Controls/Dialogs` — **all three dead**, never referenced in the file body. Likely vestiges of planned-but-never-implemented UI feedback.

Implicit global dependency (not in the AMD array): the `VSS` object itself (`VSS.getWebContext()`, called at lines 89, 512, 529, etc.), injected via the `<script src="lib/VSS.SDK.min.js">` tag in `toolbar.html` before AMD resolution occurs. Requires a hand-written ambient `declare const VSS` in the TS version.

### Consumers (What Depends On This)

- **`src/toolbar.html`** (line 21): `VSS.require(["scripts/app"], function (app) { app.create(actionContext); })` — the only runtime consumer.
- **`src/vss-extension.json`** (line 57): declares `{"path": "scripts/app.js", "addressable": true}`, making the module id `"scripts/app"` resolvable at runtime.

No other file in the repository references `app.js` or the module id `scripts/app` (confirmed via repo-wide search).

**Consumer Count**: 1 direct runtime consumer (`toolbar.html`), 1 manifest declaration (`vss-extension.json`).
**Impact Scope**: Low — single-file module, single load site, single manifest entry. The migration's risk is not "many call sites to update" but "zero tests to confirm behavior parity."

---

## Test Coverage

### Test Files

None exist anywhere in the repository (confirmed via glob for `*test*`/`*spec*` excluding `node_modules`/`.git`). `package.json`'s `"scripts"` field is empty — no `test` script defined. The only "test" hit repo-wide is `.maister/docs/standards/testing/test-writing.md`, a Maister convention document, not an actual test.

### Coverage Assessment

- **Test count**: 0
- **Gaps**: 100% — no unit, integration, or e2e coverage of any function in `app.js`. Migration verification must rely on manual side-by-side `.vsix` testing against real Azure DevOps behavior (both this analysis and the prior research report converge on this conclusion independently).

---

## Coding Patterns

### Naming Conventions

- **Functions**: Mixed `PascalCase` (`AddTasks`, `GetChildTypes`, `SortTemplates`, `IsValidTemplateWIT`) and `camelCase` (`createChildFromTemplate`, `getTemplate`, `linkImtes`) within the same file — no single convention enforced.
- **Files**: kebab-case for config/manifest files; Grunt task names are kebab-case verb-object (`package-dev`, `publish-release`).
- **Known typo**: `linkImtes` should read `linkItems` — used as the canonical relation-linking function name throughout.

### Architecture Patterns

- **Style**: Procedural, single-file, module-level mutable state (`var ctx = null`, set once in `create()`, read by nearly every function via closures).
- **Async style**: Q promises (`.then()`, `Q.all()`, `Q.when()`) — no `async`/`await` anywhere (consistent with a pre-ES2017-era codebase).
- **Module system**: AMD (`define([...], function(...) {...})`) — no CommonJS, no ESM, no bundler.
- **Filter/config pattern**: Dual-syntax template filtering (modern JSON `applywhen`/`notapplywhen` scheme vs. legacy bracket/`{token}` scheme), detected at runtime via `IsJsonString`/`extractJSON` string sniffing rather than an explicit schema version field.

---

## Complexity Assessment

| Factor | Value | Level |
|--------|-------|-------|
| File Size | 617 lines (1 file) | Low (file count) / Medium (single-file line count) |
| Dependencies | 7 AMD imports (3 dead) + 1 implicit global (`VSS`) | Low-Medium |
| Consumers | 1 direct consumer (`toolbar.html`) + 1 manifest entry | Low |
| Test Coverage | 0 tests | High (risk) |

### Overall: Moderate

Low structural complexity (single file, single consumer, narrow SDK surface: 2 REST clients across 7 methods) is offset by zero test coverage and several pre-existing correctness bugs that strict TypeScript will force to the surface mid-migration, turning what would otherwise be a mechanical rename into a migration that also has to make explicit decisions about latent behavior.

---

## Key Findings

### Strengths
- Completely clean tooling slate — no partial migration artifacts, no JSDoc/`@ts-check` pragmas, nothing to reconcile or undo.
- Narrow, enumerable external surface: 2 REST clients (7 methods), Q's `.then()`/`Q.all()`/`Q.when()`, and `VSS.getWebContext()` plus 3 bootstrap calls — all typeable from the SDK's own bundled `.d.ts` files, no DefinitelyTyped hunting needed.
- `grunt-exec` (already a devDependency) is a ready-made integration point for a `tsc` build step; no new Grunt plugin required.
- Single consumer (`toolbar.html`) and single manifest entry (`vss-extension.json`) mean the migration's "things that must keep resolving at the same path" list is short and fully enumerated.

### Concerns
- Zero test coverage — the single largest risk factor for this migration; TypeScript's static checks cannot substitute for behavioral verification.
- Newly identified broken promise chain in `AddTasks`/`createChildFromTemplate`/`createWorkItem`: missing `return` statements mean templates are not actually processed strictly sequentially today, and `justCreatedTasks` ordering (relied on by several `linkTo` directives) is not guaranteed. This is a genuine, currently-live bug, not a migration risk to be introduced.
- Two additional pre-existing bugs will surface as compiler errors: `app.js:459` implicit global loop variable, `app.js:526` reading `.bugsBehavior` off an unresolved Promise (making an entire `AsTasks`/`AsRequirements` branch dead code today).
- No user-facing error/status feedback exists anywhere in the current flow (only `console.log`/`console.error`); most promise chains have no `.catch()`/`.fail()` handler at all, so failures upstream of `createWorkItem`/`linkImtes` disappear silently.
- Dead code (`getWorkItemFormService`, 3 unused AMD imports, 2 duplicate logging functions) adds noise to the typing effort without adding value — candidates for deletion during the port.

### Opportunities
- The single-file, single-consumer shape makes this a good candidate for the research report's recommended "JSDoc/`checkJs` bootstrap, then single-shot `.ts` rename" sequencing rather than a multi-file incremental rollout.
- Consolidating `Log`/`WriteTrace`/`WriteLog` into one logging utility, fixing the `linkImtes` → `linkItems` typo, and deciding the fate of the 3 dead AMD imports can all be folded into the same pass that adds types, at negligible extra cost.
- The compiler-surfaced bugs (`bugsBehavior`, broken chain, implicit globals) are a natural, low-risk place to add either a fix or a documented `@ts-expect-error`/TODO, giving the plan an explicit decision point rather than a silent behavior change.

---

## Impact Assessment

- **Primary changes**: `src/scripts/app.js` → `src/scripts/app.ts` (or equivalent path per chosen `tsconfig.json` `outDir`/`rootDir` strategy); new `tsconfig.json`; `src/gruntfile.js` (new `tsc` exec target, inserted ahead of `exec:package_dev`/`exec:package_release`); `src/package.json` (new devDependencies: `typescript`, `@types/q`).
- **Related changes**: possible small ambient-declarations file for the global `VSS` object; `src/vss-extension.json` and `src/toolbar.html` only if the compiled output path changes from the current `scripts/app.js` (not required if `tsconfig.json` is configured to emit in place).
- **Test updates**: none exist to update; migration verification is manual (`.vsix` side-by-side testing per the research report's recommended checklist approach).

### Risk Level: Low-Medium

Structural risk is low (one file, one consumer, narrow SDK surface, no other repo file references `app.js`). The risk is concentrated entirely in behavior-parity confidence, given zero automated tests and at least one confirmed live bug (broken promise chain) plus two additional latent bugs that strict typing will force decisions about mid-migration.

---

## Recommendations

This is a **modifying-existing-code** migration (not new-capability, not primarily defect-driven, though defects were found as a byproduct). Recommendations, consistent with and cross-referencing `analysis/research-context/research-report.md`:

1. **Tooling**: Add `typescript` and `@types/q` as devDependencies; wire `tsc -p tsconfig.json` into `src/gruntfile.js` via a new `grunt-exec` target (not `grunt-ts`, per the research report's finding that it is unmaintained), registered ahead of `exec:package_dev`/`exec:package_release`.
2. **Typing strategy**: Use `vss-web-extension-sdk`'s own bundled `typings/` (`vss.d.ts`, `tfs.d.ts`) via `"types": ["vss-web-extension-sdk"]` in `tsconfig.json`; add one hand-written `declare const VSS: {...}` (or `declare global` block) for the non-AMD global.
3. **Migration sequencing**: Given the single-file shape, bootstrap with `allowJs`/`checkJs` (optionally JSDoc-annotated) to get compiler feedback while still `.js`, then do a single-shot rename to `.ts` — not a leaf-first incremental rollout, which doesn't apply to a one-file codebase.
4. **Module output contract**: Compile with `"module": "amd"` so the output remains an AMD module shaped `define([...], function(...) {...})` exporting `{ create: function(context) {...} }`, and configure `outDir`/`rootDir` so the emitted file lands at the literal path `scripts/app.js` — the path `toolbar.html:21` and `vss-extension.json:57` both hardcode.
5. **Bug handling decision**: Before/during the port, explicitly decide (and document in the spec/plan) what to do with: (a) the broken sequential-chain bug in `AddTasks` (missing `return`s), (b) `app.js:526`'s `.bugsBehavior`-off-a-Promise bug, (c) `app.js:459`'s implicit global loop variable, and (d) the dead `getWorkItemFormService`/3 unused AMD imports/2 duplicate logging functions. Recommend: fix (b)-(d) as low-risk cleanup during the port; treat (a) as a judgment call requiring explicit sign-off since it changes runtime behavior (concurrency of work-item creation).
6. **Verification strategy**: No automated test suite exists or is in scope to add as part of this migration — rely on small, reversible commits and manual side-by-side `.vsix` verification in a real Azure DevOps environment, checking each `linkTo` directive path and both the JSON and legacy template filter schemes.

---

## Next Steps

Proceed to gap analysis using this report plus `analysis/research-context/research-report.md` as joint current-state/approach inputs. The gap analysis should focus on: (1) what the target `tsconfig.json`/build-step configuration should look like precisely, (2) the explicit disposition of each flagged bug/dead-code item, and (3) whether any UI-feedback capability (spinner/error dialog, given the dead `StatusIndicator`/`Dialogs` imports) should be added as part of this migration's scope or explicitly deferred.
