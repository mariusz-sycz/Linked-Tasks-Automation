# Research Sources

## TL;DR
Codebase sources are small and fully enumerated: one core logic file (`src/scripts/app.js`, 617 lines), one build file (`src/gruntfile.js`), and 3 config/manifest files. Project docs (vision, roadmap, tech-stack, packaging standard) were already read during planning and are referenced here rather than re-gathered. External sources target TypeScript's official incremental-migration guidance, Grunt+TS integration options, and — the highest-uncertainty item — whether usable type definitions exist for `vss-web-extension-sdk` and `Q`.

## Key Decisions
- Every codebase file listed below was confirmed to exist via direct `Glob`/`Read` during planning (not hypothetical patterns) — the entire `src/` tree is only 15 files, so the manifest is exhaustive rather than pattern-based.
- `src/lib/VSS.SDK.min.js` (the vendored, minified SDK copy) is listed but flagged low-priority for reading — it's a build artifact copied via Grunt from `node_modules`, not source to analyze; the *typed* surface question is answered externally (DefinitelyTyped/npm), not by reading the minified file.

## Open Questions / Risks
- No `tsconfig.json`, `.eslintrc`, or any TS/lint config exists yet in the repo (confirmed via directory listing) — there is no "current TS setup" to analyze, only external precedent to draw from.
- `Q` does not appear as a direct `package.json` dependency (only `vss-web-extension-sdk`, build tools) — need to verify during gathering whether `Q` ships bundled with/exposed by the VSS SDK's AMD loader (`define([..., "q", ...])` in app.js line 1 suggests it's resolved via VSS's RequireJS config, not npm) — this affects how it can be typed/imported.

---

## Codebase Sources

### Key Files
- `src/scripts/app.js` (617 lines) — the entire core migration target: AMD module via `define([...], function(...))`, VSS SDK REST client usage, Q promise `.then()` chains, template filtering/validation logic (`IsValidTemplateWIT`, `IsValidTemplateTitle`, `SortTemplates`, `GetChildTypes`, `getTemplates`, `getTemplate`, `createChildFromTemplate`, `createWorkItem`, `AddTasks`), module-level mutable state (`var ctx = null`), and 4 ad-hoc logging functions (`Log`, `WriteTrace`, `WriteLog`, `WriteError`) per roadmap.md.
- `src/gruntfile.js` (52 lines) — full build pipeline: `exec` tasks (`package_dev`, `package_release`, `publish_dev`, `publish_release` via `tfx-cli`), `copy` task (vendors `VSS.SDK.min.js` from `node_modules` into `src/lib/`), `clean` task, registered task aliases (`package-dev`, `package-release`, `publish-dev`, `publish-release`, `default`). This is where a TS compile step must be inserted ahead of the existing `exec:package_dev`/`exec:package_release` tasks.
- `src/toolbar.html` — entry point that loads the AMD/RequireJS runtime and `app.js` in the browser; relevant for confirming the script-loading mechanism migration must preserve (module loader stays RequireJS/AMD-compatible output even after TS compilation, since VSS's runtime expects `define()`).
- `src/vss-extension.json` — Marketplace manifest; `files[]` array lists `scripts/app.js` (and others) with `"addressable": true` — the compiled output path must continue to match what this manifest references.
- `src/configs/dev.json`, `src/configs/release.json` — override files (`public: false`/`true`) passed to `tfx extension create`; unaffected by TS migration directly but part of the build chain that must keep working end-to-end.
- `src/package.json` — current `devDependencies`: `grunt ^1.0.4`, `grunt-cli ^1.2.0`, `grunt-contrib-clean ^1.0.0`, `grunt-contrib-copy ~1.0.0`, `grunt-exec ~0.4.7`, `requirejs ^2.2.0`, `tfx-cli ^0.8.1`, `vss-web-extension-sdk ^1.104.0`. No `typescript`, `@types/*`, or `q` entries present — confirms TS tooling and type packages must be newly added. `version: 0.10.1` (mismatched with manifest's `1.1.17`, per roadmap.md).
- `src/package-lock.json` — resolved dependency tree; check for transitive `q` resolution (since `Q` is `define()`-imported in app.js but not a direct devDependency).
- `src/lib/VSS.SDK.min.js` — vendored minified copy of the VSS SDK (low priority to read directly; used only to confirm the SDK version/build actually shipped, if needed to cross-check against typing package version compatibility).

### Directories
- `src/scripts/` — contains the single core module (`app.js`); migration's primary target directory.
- `src/` — build config, manifest, and vendored lib root.

## Documentation Sources

### Project Documentation (already read during planning — referenced, not re-gathered by information gatherers)
- `.maister/docs/project/vision.md` — states the 6-12 month goal of "ground-up refactor to TypeScript" for type safety and compile-time error catching on template-filtering logic; notes project is ~2.5 years old, stable/maintenance mode, solo-maintained.
- `.maister/docs/project/roadmap.md` — Phase 1 "Ground Refactor to TypeScript" breaks the work into 5 items: introduce TS tooling + Grunt integration `[M]`, port `app.js` `[L]`, type the VSS SDK/REST client boundary `[M]`, consolidate the 4 logging functions `[S]`, align `vss-extension.json`/`package.json` versions `[S]`. Also documents technical debt: no tests, no CI/CD, no CONTRIBUTING.md.
- `.maister/docs/project/tech-stack.md` — documents current stack (JS ES6+, AMD via `define()`, VSS SDK `v1.104.0`, Grunt `1.0.4+`, `tfx-cli` `0.8.1`, RequireJS `2.2.0`, `Q` promise library) and an explicit "Migration Path" section outlining the same 4-step plan as the roadmap.
- `.maister/docs/standards/build-tooling/packaging.md` — discovered build conventions the migration must preserve: kebab-case Grunt task names, dev/release override-file pattern, `--rev-version` on dev builds only, `package.json` name matching manifest `id`, `"private": true`, vendored SDK copied via `grunt-contrib-copy`, all manifest `files[]` entries marked `addressable`.

### Code Documentation
- Inline comments in `src/scripts/app.js` (sparse — e.g. `// Get the current values for a few of the common fields`, `// Create children alphabetically.`) — useful for confirming intent behind template-filtering logic when assigning types.
- `src/overview.md` — Marketplace listing overview copy (not technical, but may clarify domain terms like "template", "linked task" for type naming).

## Configuration Sources
- `src/package.json` / `src/package-lock.json` — dependency versions (see Key Files above).
- `src/vss-extension.json` — extension manifest (id, version `1.1.17`, contribution `create-linked-tasks-button`, `files[]` entries).
- `src/configs/dev.json`, `src/configs/release.json` — environment overrides.
- `src/gruntfile.js` — build task definitions (also listed under Key Files; central to the tooling-integration research question).

## External Sources (literature / best practices)

### TypeScript Migration Guidance
- TypeScript official handbook — "Migrating from JavaScript": https://www.typescriptlang.org/docs/handbook/migrating-from-javascript.html (incremental adoption via `allowJs`, `checkJs`, `// @ts-check` JSDoc-first bootstrapping before renaming files to `.ts`).
- TypeScript `tsconfig.json` reference for `allowJs`/`checkJs`/`strict` flag semantics: https://www.typescriptlang.org/tsconfig
- General industry guidance on incremental vs. big-bang legacy JS→TS migration strategy (search for current, non-stale — post-2023 — articles/case studies specifically addressing small/single-file codebases and codebases without test coverage).

### Grunt + TypeScript Integration
- `grunt-ts` (historically the standard Grunt TypeScript plugin) — verify current maintenance status; likely unmaintained/stale given Grunt's own declining ecosystem activity.
- Alternative: invoking `tsc` directly via the existing `grunt-exec` plugin already in `package.json` (lowest-overhead option, reuses a dependency already present) — search for precedent/guidance on this pattern.
- `typescript` npm package release notes / `tsc` CLI docs for CI-less, watch-less single-command compilation suitable for a manual build workflow: https://www.typescriptlang.org/docs/handbook/compiler-options.html

### VSS SDK Type Definitions
- npm registry search: `vss-web-extension-sdk`, `azure-devops-extension-sdk`, `azure-devops-extension-api` — confirm which package(s) ship or have community types, and whether `azure-devops-extension-sdk` (Microsoft's newer SDK) is a compatible drop-in or a distinct migration of its own (relevant to scoping).
- DefinitelyTyped repository/npm `@types/` search for any `vss-web-extension-sdk` or `tfs`-prefixed type packages — check last-publish date for staleness.
- Microsoft's Azure DevOps Extension SDK samples/docs (`https://learn.microsoft.com/en-us/azure/devops/extend/`) for officially documented TypeScript usage patterns, if any exist for the SDK version in use (`1.104.0`).

### Q Promise Library Typing
- `@types/q` on npm/DefinitelyTyped — check version compatibility with modern TypeScript compiler versions and last-publish date.
- Q library's own TypeScript support status (Q project repo/README) — confirm whether Q ships its own types or relies entirely on `@types/q`.

### No-Test-Suite Migration Risk & Mitigation
- Literature/case studies on migrating untested legacy JavaScript to TypeScript safely (e.g., JSDoc-first bootstrapping to get compiler-checked types before syntax conversion, `.ts` file-by-file rename with `// @ts-nocheck` opt-outs, manual regression checklists, side-by-side `.vsix` comparison as a substitute safety net) — prioritize sources that explicitly address the "no tests yet" scenario rather than assuming test coverage exists.
