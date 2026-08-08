## TL;DR
Headless TypeScript migration of `src/scripts/app.js` with no user-facing changes except corrected task-creation ordering (promise-chain bug fix). Build fresh per prior research recommendations — no reference pattern to follow. No visual assets applicable (non-UI task).

# Requirements

## Initial Description
Migrate the Linked-Tasks-Automation Azure DevOps extension (`src/scripts/app.js`, 617 lines, AMD/RequireJS, Grunt build, VSS SDK, Q promises, no automated tests) to TypeScript, following the recommended approach from prior research: `tsc` via `grunt-exec`, JSDoc/`checkJs` bootstrap then single-shot `.ts` rename, VSS SDK typed via its own bundled `typings/`, `Q` typed via `@types/q`, no-test-suite risk mitigated via a manual verification checklist.

## Q&A

**Q: User Journey — how will users discover/access this? Which personas? How does it fit existing workflows?**
A: No new user journey. The extension's behavior from an Azure DevOps user's perspective is unchanged — same toolbar/context-menu button (`create-linked-tasks-button`), same template-driven child work item creation, same output — except task creation now happens in the correct sequential order (fixing the promise-chain bug means `justCreatedTasks`-dependent `linkTo` directives now reliably see prior tasks).

**Q: Existing Code Reuse — similar features, UI components, backend patterns to reference?**
A: None. This is the first TypeScript setup in this project. Build fresh per the research report's recommendations (`tsc` via `grunt-exec`, `module: amd`, `strict: true`, VSS SDK's own bundled typings, `@types/q`).

**Q: Visual Assets — any mockups, wireframes, screenshots?**
A: Not applicable — headless extension logic and build tooling only, no UI surface changes.

## Similar Features Identified
None — first TypeScript migration in this codebase.

## Visual Assets and Insights
None applicable (non-UI task).

## Functional Requirements Summary
1. Add `typescript` and `@types/q` as devDependencies; create `src/tsconfig.json` (`module: amd`, `types: ["vss-web-extension-sdk"]`, `strict: true`, output landing at unchanged `src/scripts/app.js`).
2. Add a hand-written ambient `declare const VSS: {...}` block for the non-AMD global.
3. Bootstrap `app.js` with JSDoc + `allowJs`/`checkJs`, resolve everything the compiler surfaces, then perform a single-shot rename to `app.ts`.
4. Fix the broken promise-chain bug in `AddTasks`/`createChildFromTemplate`/`createWorkItem` (missing `return` statements) so templates are genuinely processed sequentially.
5. Fix the two implicit-global bugs: `app.js:459` (add `let`/`const` to the `for...of` loop) and `app.js:526` (properly resolve the `getTeamSettings` promise before reading `.bugsBehavior`).
6. Delete dead code: 3 unused AMD imports (`Controls`, `StatusIndicator`, `Dialogs`) and the dead `getWorkItemFormService` function.
7. Consolidate the 4 logging functions (`Log`, `WriteTrace`, `WriteLog`, `WriteError`) into a single logging utility.
8. Rename `linkImtes` → `linkItems` at all ~8 call sites.
9. Align `package.json` version (`0.10.1`) with `vss-extension.json` version (`1.1.17`).
10. Wire a new `grunt-exec` target (`tsc -p tsconfig.json`) into **both** `registerTask("package-dev", ...)` and `registerTask("package-release", ...)` in `gruntfile.js`, ahead of the existing `exec:package_dev`/`exec:package_release` tasks — explicitly verified, not left to implementation-time judgment (per Phase 2 critical decision).
11. Preserve the AMD module contract (`define([...], function(...) {...})` shape exporting `{ create }`) so `toolbar.html`'s `VSS.require(["scripts/app"], ...)` keeps working unchanged.
12. Preserve all documented build/packaging conventions from `.maister/docs/standards/build-tooling/packaging.md` (kebab-case task names, dev/release override-file pattern, `--rev-version` dev-only, `private: true`, vendored SDK copy pattern, addressable file entries).

## Reusability Opportunities
None — greenfield TypeScript tooling setup in this project.

## Scope Boundaries
**In scope**: TS tooling + Grunt integration, `app.js` → `app.ts` port, VSS SDK/Q typing, promise-chain bug fix, 2 implicit-global bug fixes, dead code removal, logging consolidation, `linkImtes` rename, version alignment, manual verification checklist.

**Out of scope**: Automated test framework introduction (explicitly deferred to Phase 2 per roadmap), new features, UI feedback (spinner/dialog) additions, adopting the newer `azure-devops-extension-sdk`, CI/CD pipeline setup.

## Technical Considerations
- Zero test coverage — manual side-by-side `.vsix` verification checklist (one line per cataloged function) is the acceptance mechanism for this task, substituting for the standard TDD gate (Phase 2 critical decision).
- Build wiring must be explicitly verified in both `package-dev` and `package-release` task chains to avoid a silently orphaned compile step.
- No `node_modules` installed yet — VSS SDK's bundled `.d.ts` shape not yet verified against real declaration files; expect some `any`/type-assertion fallback for loosely-typed template `.fields` dictionaries and JSON-Patch document construction.
