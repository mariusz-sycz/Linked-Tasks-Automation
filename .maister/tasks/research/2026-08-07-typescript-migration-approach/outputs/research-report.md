# Research Report: TypeScript Migration Approach for Linked-Tasks-Automation

## TL;DR
Compile with `tsc` invoked via the already-installed `grunt-exec` plugin (not `grunt-ts`, which is unmaintained), emitting AMD output to the unchanged `scripts/app.js` path. For the single 617-line `app.js`, bootstrap with JSDoc + `allowJs`/`checkJs` first to get compiler feedback while still in `.js`, then do a single-shot rename to `.ts` — classic multi-file "incremental leaf-first" migration doesn't apply to a one-file codebase. Type the VSS SDK via its own bundled `typings/vss.d.ts`/`tfs.d.ts` (no DefinitelyTyped needed) plus one hand-written `declare const VSS` for the non-AMD global; type `Q` via the current `@types/q` (v1.5.8, TS 4.5+). The no-test-suite risk has no tooling substitute — mitigate with small reversible commits and manual side-by-side `.vsix` comparison against a checklist.

## Key Decisions
- **Use `grunt-exec` + direct `tsc` invocation, not `grunt-ts`** — `grunt-ts` is confirmed unmaintained (maintainer explicitly seeking a successor); `grunt-exec` is already a dependency and needs no new plugin.
- **JSDoc/`checkJs` bootstrap, then single-shot `.ts` rename** — not a multi-file incremental rollout (nothing to incrementalize across) and not an unguarded big-bang rename either.
- **Type the VSS SDK from its own bundled `typings/` folder, not DefinitelyTyped** — `vss-web-extension-sdk` ships `vss.d.ts`, `tfs.d.ts`, `rmo.d.ts` covering the exact modules this project uses.
- **Keep `@types/q`; treat Q→native-Promise conversion as an optional, separately-scoped follow-up** — the types package is current, so converting isn't required for typing to work.
- **Do not adopt `azure-devops-extension-sdk`** as part of this migration — it is a distinct, larger, non-drop-in migration.

## Open Questions / Risks
- The no-test-suite mitigation pattern (characterization/manual-verification literature) and the Q-to-native-Promise recommendation rest on WebSearch summaries only, never independently fetched — treat as directionally reliable, not verbatim-sourced.
- `azure-devops-extension-sdk` v5.0.0's exact npm publish date could not be cross-verified (registry returned an internally implausible forward date); the "actively maintained, non-archived" signal itself is solid.
- Installed SDK version is `1.110.0` (per lockfile), not `^1.104.0` as referenced in project docs — does not change the typing recommendation (bundled types ship with every version) but should be reconciled in project docs opportunistically.

---

## Table of Contents
1. [Executive Summary](#executive-summary)
2. [Research Objectives](#research-objectives)
3. [Methodology](#methodology)
4. [Findings](#findings)
5. [Analysis and Insights](#analysis-and-insights)
6. [Conclusions](#conclusions)
7. [Recommendations](#recommendations)
8. [Appendices](#appendices)

---

## Executive Summary

**What was researched**: The best approach for migrating the Linked-Tasks-Automation Azure DevOps extension — a single 617-line AMD/RequireJS JavaScript module built with Grunt, using the `vss-web-extension-sdk` and the `Q` promise library, with no automated test suite — to TypeScript.

**How it was researched**: Three parallel information-gathering passes (codebase structure, configuration/build surface, external literature) followed by a single cross-referencing synthesis pass. Codebase and configuration findings were established by direct file reads with line-level citations; external findings combined direct fetches (npm registry, GitHub READMEs, TypeScript's official handbook) with search-result aggregation for topics where primary sources were harder to pin down (no-test-suite refactoring literature, Q-to-native-Promise guidance).

**Key findings**:
- The riskiest unknown — whether usable VSS SDK type definitions exist — resolves favorably and simply: the SDK package bundles its own `.d.ts` files covering exactly the modules this project uses.
- The standard Grunt+TypeScript plugin (`grunt-ts`) is unmaintained; the project's existing `grunt-exec` dependency is sufficient to wire in `tsc` directly.
- `@types/q` is current (not the stale ~2016-era definitions the research plan worried might exist).
- The codebase's small, single-file shape means generic "incremental vs. big-bang" migration literature — which assumes a multi-file tree — doesn't transplant cleanly; the report proposes an adapted middle path.
- The absence of a test suite is a real, unmitigated-by-tooling risk; the only available mitigation is process discipline.

**Main conclusions**: A low-overhead, low-new-dependency migration path exists end to end — no new Grunt plugins, no DefinitelyTyped hunting, no bundler introduction. The main engineering judgment call is sequencing the single-file rename to maximize compiler feedback before the point of no return, and the main organizational commitment is a manual verification discipline to compensate for no automated tests.

---

## Research Objectives

**Primary research question**: What is the best approach for migrating the Linked-Tasks-Automation Azure DevOps extension (AMD/RequireJS, Grunt build, VSS SDK, Q promises, no tests) to TypeScript — including tooling choices, incremental vs. big-bang migration strategy, and type definitions for the VSS SDK?

**Sub-questions**:
1. What TypeScript tooling integrates into the existing Grunt build with the least new overhead?
2. Should the migration be incremental or big-bang, given the module is a single ~617-line file?
3. How should the VSS SDK and Q promise library be typed?
4. What risks does migrating without an existing test suite introduce, and how can they be mitigated?

**Scope**:
- *Included*: TS tooling + Grunt integration; migration strategy for the single core module; VSS SDK/Q typing strategy; no-test-suite risk and mitigation.
- *Excluded*: actual implementation of the migration; new feature development; test-framework selection (touched only where it affects migration safety).

---

## Methodology

**Research type**: Mixed (technical codebase analysis + literature/best-practices research).

**Approach**: Parallel multi-source gathering — one pass over the codebase (`src/scripts/app.js`, `src/gruntfile.js`, `src/toolbar.html`), one pass over configuration/build surface (`package.json`, `package-lock.json`, `vss-extension.json`, config overrides, the project's packaging standard), and one pass over external literature (TypeScript's official migration guidance, Grunt+TS integration precedent, VSS SDK and Q typing status, no-test-suite refactoring practices) — followed by a single synthesis pass cross-referencing all three.

**Data sources**:
- Codebase: 1 core module (617 lines), 1 build file (52 lines), 1 HTML entry point, fully read and cross-grepped.
- Configuration: `package.json`, `package-lock.json` (6,700+ lines, searched exhaustively for `q`), `vss-extension.json`, 2 config override files, 1 internal packaging standard doc.
- External: 8 primary sources fetched directly (TypeScript handbook, `vss-web-extension-sdk` README + npm registry, `grunt-ts` README + npm registry, `azure-devops-extension-sdk` GitHub + npm registry, `azure-devops-extension-api` npm registry, a third-party SDK-porting article, `@types/q` npm registry), plus multiple WebSearch aggregations for migration-strategy case studies and no-test-suite refactoring practices.

**Analysis framework**: Mixed — technical component/pattern/flow analysis on the codebase side; best-practices comparison, trade-off analysis, and applicability assessment on the literature side, converging in a single synthesis (`analysis/synthesis.md`).

---

## Findings

### Finding 1: The SDK ships its own type definitions — no DefinitelyTyped or hand-rolled `.d.ts` needed
**Category**: Tooling / Typing | **Confidence**: High

`vss-web-extension-sdk` bundles three declaration files directly in the npm package under `typings/`: `vss.d.ts` (SDK core, UI controls, client services), `tfs.d.ts` (REST clients/contracts for Build, Work, and Code — covering `TFS/WorkItemTracking/Services`, `TFS/WorkItemTracking/RestClient`, `TFS/Work/RestClient`, the exact modules this project imports), and `rmo.d.ts` (Release Management, unused here). Two consumption patterns are documented by the SDK itself: setting `"types": ["vss-web-extension-sdk"]` in `tsconfig.json`, or a `/// <reference types="vss-web-extension-sdk" />` directive. The SDK's own sample `tsconfig.json` uses `"module": "amd"`, `"target": "es5"` and requires only TypeScript 2.5+.

*Evidence*: `github.com/microsoft/vss-web-extension-sdk/blob/master/README.md` (fetched directly); `registry.npmjs.org/vss-web-extension-sdk` (fetched directly) — cross-checked against the codebase's actually-used SDK surface (`codebase-app-structure.md` §6: 2 REST clients, 7 methods, `Q`, `VSS.getWebContext()`).

*Caveat*: the SDK package itself is archived by Microsoft (Jan 27, 2023) and deprecated in npm metadata in favor of `azure-devops-extension-sdk` — but this is a project-maintenance-status flag, not a typings-availability problem. The bundled `.d.ts` files ship in every published version and don't depend on ongoing maintenance to keep working for the currently-installed 1.110.x SDK.

**Implication**: No DefinitelyTyped search, no version-compatibility hunting, no hand-rolled ambient declarations for the AMD-declared SDK modules are required.

### Finding 2: The non-AMD global `VSS` needs one small hand-written ambient declaration
**Category**: Typing | **Confidence**: High

Unlike `TFS/WorkItemTracking/RestClient` etc. (which arrive via `define([...])`, `app.js:1`), the `VSS` object used 12 times in `app.js` (`app.js:89,512,529,536,538,541,542,544,547,549,551,601`) is not declared as an AMD dependency — it is injected globally via `<script src="lib/VSS.SDK.min.js">` in `toolbar.html:8`, before any module resolution happens.

*Evidence*: `codebase-app-structure.md` §2 (AMD dependency table showing `VSS` absent from the `define([...])` array); `config-build-surface.md` §7 (confirms the same script-tag-first loading order).

**Implication**: A minimal `declare const VSS: { getWebContext(): WebContext; init(): void; require(deps: string[], cb: Function): void; register(id: string, cb: Function): void; }` (or a `declare global` block) is needed — a few lines, not a maintenance burden, and separate from whatever covers the AMD-imported modules.

### Finding 3: `grunt-ts` is unmaintained; `tsc` via the already-installed `grunt-exec` is the lower-overhead integration path
**Category**: Tooling / Build integration | **Confidence**: High

`grunt-ts`'s own README states: *"This project, much like Grunt itself, is now in a mature maintenance phase and no significant features will be considered"* and *"Looking for Maintainers... I am no longer maintaining this plugin as I no longer use Grunt."* Its latest npm release is a beta (`6.0.0-beta.22`) roughly six years old, with no stable 6.0.0 ever shipped, and 72 open issues.

By contrast, `grunt-exec` (`~0.4.7`) is already a `package.json` devDependency, used today to shell out to `tfx-cli` for packaging/publishing (`gruntfile.js:4-23`). Adding a new `exec` target that runs `tsc -p tsconfig.json` requires zero new Grunt plugins.

*Evidence*: `github.com/TypeStrong/grunt-ts` README (fetched directly); `registry.npmjs.org/grunt-ts` (fetched directly); cross-referenced against `config-build-surface.md` §5's independent observation (reached purely from the existing task-graph shape, without reference to the external gatherer's findings) that `grunt-exec` is the natural insertion point.

**Implication**: The new build step should be a `grunt.config.exec.tsc` (or similarly named) target running `tsc -p tsconfig.json`, registered as a prerequisite ahead of `exec:package_dev` and `exec:package_release` in `gruntfile.js:46-47`. `tsconfig.json` should set `outDir`/`outFile` (or `rootDir`) so the compiled output lands at the literal path `src/scripts/app.js`, since `vss-extension.json:57` and `toolbar.html:21` both reference that exact path with no glob matching.

### Finding 4: `@types/q` is current — the research plan's staleness concern doesn't hold
**Category**: Typing | **Confidence**: High

The research plan anticipated `@types/q` might be aged (last relevant ~2016-2018). Direct registry inspection shows the opposite: latest version **1.5.8**, published **November 7, 2023**, with a `typeScriptVersion` field targeting **TypeScript 4.5 or later** — comfortably compatible with any TS 4.x/5.x compiler this project would adopt.

*Evidence*: `registry.npmjs.org/@types/q` (fetched directly).

**Implication**: `Q` can be typed by simply adding `@types/q` as a devDependency — no hand-written stub needed. This must cover all three `Q` usage shapes present in `app.js` (single-callback `.then(fn)`, two-callback `.then(onSuccess, onError)`, and the static `Q.all()`/`Q.when()` — see `codebase-app-structure.md` §4), all of which are part of `@types/q`'s standard coverage of the Q API.

### Finding 5: `Q` is not an npm dependency — its runtime resolution is entirely internal to the SDK
**Category**: Build surface | **Confidence**: High

An exhaustive search of `package-lock.json` (6,700+ lines) for `q` as a package-name token returned zero matches. `vss-web-extension-sdk`'s own lockfile node declares no `dependencies`/`requires` block at all — it resolves as a dependency-free leaf. Yet `app.js:1-2` successfully imports `"q"` via AMD `define([...])` at runtime today. The only mechanism consistent with all three facts (zero lockfile presence, dependency-free SDK package, working runtime resolution) is that Microsoft bundles a Q-compatible implementation inside the minified `VSS.SDK.min.js` and registers it under the `"q"` module id in its own internal AMD loader — separate from npm's module graph entirely.

*Evidence*: `config-build-surface.md` §2 (exhaustive lockfile search evidence, `package-lock.json:3704-3709`); cross-confirmed by `codebase-app-structure.md`'s independent observation of `app.js:1-2`'s AMD import with no corresponding `package.json` entry.

**Implication**: `@types/q` types the *interface* Q exposes at the `"q"` AMD module id, not a specific installed runtime version — there is no npm-resolvable `q` package to version-check against. This is a non-issue for typing (interfaces are stable across Q's practical version history) but means "confirm exact Q version" is not achievable without unminifying the vendored SDK bundle (out of scope, low severity).

### Finding 6: The codebase has a narrow, enumerable SDK/Q surface — plus concrete pre-existing bugs a `strict` TS pass will surface
**Category**: Codebase structure | **Confidence**: High

`app.js` is one AMD module (`define([...7 deps], ...)`, `app.js:1-618`) with 24 internal functions and one public method (`create`, `app.js:597-614`), built around a single module-level mutable variable (`var ctx = null`, `app.js:4`). The actually-exercised SDK surface is narrow: 2 REST clients (`TFS/WorkItemTracking/RestClient`, `TFS/Work/RestClient`) across 7 methods, `Q`'s 2 static + instance `.then()` API, and `VSS.getWebContext()` plus 3 bootstrap calls confined to `toolbar.html`.

Three of the seven AMD-declared dependencies (`Controls`, `StatusIndicator`, `Dialogs`, `app.js:2`) are imported but never referenced anywhere in the file body (confirmed via grep — zero matches for `Controls.`, `StatusIndicator.`, or `Dialogs.`). Three of the four logging functions (`Log`, `WriteTrace`, `WriteLog`, `app.js:578-588`) are byte-for-byte identical.

Two implicit-global bugs exist that non-strict JS silently tolerates but TypeScript (or even plain `"use strict"`) will not:
- `app.js:459` — `for (category of categories)` omits `let`/`const`, leaking `category` as an implicit global.
- `app.js:526` — `bugsBehavior = workClient.getTeamSettings(team).bugsBehavior;` has no declaration *and* reads a property directly off a pending Promise rather than its resolved value — a second, more serious latent bug (this line likely evaluates to `undefined` at runtime today).

A third, related defect: `getWorkItemFormService` (`app.js:572-576`) is dead code (never called elsewhere in the file, confirmed via grep) that also synchronously returns a variable assigned inside a `.then()` callback — i.e., it returns before the promise resolves, always yielding `undefined`.

*Evidence*: `codebase-app-structure.md` §1 (function inventory), §2 (AMD dependency table), §3 (module-level state), §6 (SDK surface summary table) — all direct-read, line-cited.

**Implication**: The typing surface to cover is smaller than "all 7 AMD imports" suggests (3 are candidates for deletion, not typing). The two implicit-global bugs and the dead-code function are not migration regressions — they are pre-existing defects that a `strict` TypeScript pass will force explicit resolution of, and should be flagged/fixed (or deliberately `@ts-expect-error`-suppressed with a comment) during the port rather than treated as surprises.

### Finding 7: No TS/lint tooling exists today — a genuinely clean slate
**Category**: Build surface | **Confidence**: High

`Glob` searches for `**/tsconfig*.json` and `**/.eslintrc*` returned zero matches anywhere in the repository. The full `src/` tree (15 files) contains no `.ts`, `.d.ts`, or lint config files. `package.json`'s `devDependencies` list contains no `typescript`, no `@types/*`, no `q`, and its `scripts` field is an empty object — there is no `npm run build`/`test` convention to extend or collide with.

*Evidence*: `config-build-surface.md` §1, §6 (direct Glob + package.json read).

**Implication**: There is no legacy TS configuration to reconcile or migrate away from, and no naming convention to preserve beyond the kebab-case Grunt task-name convention documented in the project's own packaging standard.

### Finding 8: `azure-devops-extension-sdk` (the newer Microsoft SDK) is not a drop-in replacement and should stay out of scope
**Category**: Scoping | **Confidence**: Medium-High

The newer SDK is actively versioned (latest `5.0.0`, ships its own `SDK.d.ts` types, not archived) — but adopting it requires more than a TS port. A third-party porting write-up (Phong Cao) describes it as a "moderate, targeted" migration: removing `libraryTarget: "amd"` from any webpack config, replacing `VSS.init()`/`VSS.require()` with direct ES imports and a `sdkInit()` call, updating REST client class/interface names, and handling field-shape changes (e.g., `System.AssignedTo` returns a JSON object instead of a string in the new SDK). The new SDK's own README claims AMD compatibility is retained, which appears to refer to consuming other AMD modules from extension code, not to the page-bootstrap mechanism itself — a genuine ambiguity between sources, but one that doesn't change the scoping conclusion either way.

*Evidence*: `registry.npmjs.org/azure-devops-extension-sdk` (fetched); `github.com/microsoft/azure-devops-extension-sdk` (fetched); `phongthaicao.medium.com/porting-vss-web-extension-sdk-to-azure-devops-web-extension-sdk-86a6ce3f39c2` (fetched).

**Implication**: Treat any future move to the newer SDK as a separate, larger, independently-scoped migration — not bundled with the TypeScript port that is this research's subject.

### Finding 9: Generic "incremental vs. big-bang" migration literature assumes multi-file codebases and doesn't transplant directly to a single 617-line module
**Category**: Migration strategy | **Confidence**: Medium-High

TypeScript's official handbook recommends: add `tsconfig.json` with `allowJs: true`, let `tsc` run over existing `.js` with zero conversion, rename files to `.ts` incrementally one at a time, and turn on strictness flags progressively (`noImplicitAny`, `noImplicitThis`, `noFallthroughCasesInSwitch`, `noImplicitReturns`, `strictNullChecks` last). Broader 2024-2026 industry guidance (search-aggregated across a decision-matrix-style piece, and case-study retrospectives from Patreon, Mixmax, and a 100k-LOC piece by Dylan Vann) confirms incremental-by-default is the dominant pattern, explicitly recommending starting at the "leaves" (utils, types) and working toward entry points — but this framing presumes a multi-file tree with genuine leaves to separate from entry points.

`app.js` has no internal module boundaries — it is one file, one `define()` factory, 24 functions in a flat scope. There is nothing to "start at the leaves" of in the file-count sense the literature assumes.

*Evidence*: `www.typescriptlang.org/docs/handbook/migrating-from-javascript.html` (fetched directly); WebSearch aggregation of 2025-2026 decision-matrix and case-study content (not individually fetched — see Appendix: Gaps).

**Implication**: The applicable adaptation (developed in synthesis, not stated verbatim by any single source) is to front-load the "incremental" safety into a pre-rename phase rather than spread the rename itself across files: bootstrap with JSDoc annotations + `allowJs`/`checkJs`, fix everything the compiler surfaces while the file is still `.js`, and only then perform a single-shot rename to `app.ts`. This gets compiler-checked feedback before the highest-risk step (the syntactic rename) without requiring multiple files to stage the rename across.

### Finding 10: No tooling substitutes for automated tests — the literature's answer is process discipline
**Category**: Risk / Mitigation | **Confidence**: Medium

Search-aggregated literature (understandlegacycode.com article summaries — not independently fetched this session due to a tool-access interruption) converges on: building a "safety net" before refactoring untested code is essential, since even small changes can silently break workflows; characterization/approval ("golden master") tests — capturing existing output before a change and diffing after — are described as the fastest way to retrofit safety onto untested code; and where a formal test framework isn't feasible, manual techniques (small reversible commits reviewed individually, deriving proof of correctness from multiple independent sources such as the compiler, IDE, linter, and diff review rather than a single check) are the recommended fallback.

*Evidence*: WebSearch aggregation only (`external-ts-migration-literature.md` §5) — flagged by the gathering agent itself as search-summary sourcing, not verbatim-fetched.

**Implication**: For this project, a lightweight, solo-maintainer-appropriate adaptation doesn't require introducing a test framework (explicitly out of scope per the research brief): build and manually exercise the current `.vsix` in a real or sandbox Azure DevOps project, record expected behavior for each cataloged function (`IsValidTemplateWIT`, `SortTemplates`, `getTemplates`, `createChildFromTemplate`, `AddTasks`, etc.) as a short manual checklist, then re-run that same checklist against the post-migration `.vsix` side-by-side after each incremental step. The TypeScript compiler itself functions as one of the "independent sources of proof" the literature recommends stacking alongside manual testing.

### Findings Summary Table

| # | Finding | Category | Confidence | Primary Source(s) |
|---|---|---|---|---|
| 1 | VSS SDK ships bundled `.d.ts` typings | Typing | High | SDK README + npm registry (direct fetch) |
| 2 | Global `VSS` needs a hand-written ambient declaration | Typing | High | `app.js:1-2,89-601`; `toolbar.html:8` |
| 3 | `grunt-ts` dead; use `grunt-exec` + `tsc` | Build | High | `grunt-ts` README + npm registry (direct fetch) |
| 4 | `@types/q` is current (v1.5.8, Nov 2023, TS 4.5+) | Typing | High | npm registry (direct fetch) |
| 5 | `Q` is not an npm dependency; resolved via SDK's internal AMD loader | Build | High | `package-lock.json` exhaustive search |
| 6 | Narrow SDK surface + concrete pre-existing bugs | Codebase | High | `app.js` full read + grep |
| 7 | No TS/lint tooling exists — clean slate | Build | High | Glob search, `package.json` read |
| 8 | Newer `azure-devops-extension-sdk` is not a drop-in; stays out of scope | Scoping | Medium-High | SDK repo/registry + porting article (direct fetch) |
| 9 | Incremental/big-bang literature assumes multi-file; needs adaptation for one file | Strategy | Medium-High | TS handbook (direct) + search aggregation |
| 10 | No-test-suite risk mitigated by process, not tooling | Risk | Medium | WebSearch aggregation (not independently fetched) |

---

## Analysis and Insights

### Patterns identified

**Bundled types over registry lookup, for niche/legacy SDKs.** The single highest-value research move was checking the SDK package itself for a `typings/` folder rather than assuming a DefinitelyTyped search would be necessary. This resolved the research plan's top-flagged risk in one direct fetch. Generalizable beyond this project: for older, single-vendor SDKs, check the package's own bundle before treating "no DefinitelyTyped entry" as a blocker.

**Deprecated-but-still-typed vs. actively-maintained-but-incompatible.** The project faces two SDKs pulling in opposite directions on the maintenance/compatibility axis: the current SDK (`vss-web-extension-sdk`) is archived at the project level (no new code since 2018) but has complete, adequate, already-present types; the newer SDK is actively maintained but would force a second, larger migration alongside the TS port. The research resolves this tension by keeping the two migrations separate rather than conflating them.

**Compiler-as-safety-net.** Every source touching the no-test-suite question converges on the same idea: TypeScript's own type-checker, run early and strictly, is partial regression protection a pure-JS codebase never had. This isn't hypothetical here — the codebase read directly surfaced two implicit-global bugs and one sync-return-of-async-value bug that a strict pass will force decisions on, independent of any test.

### Key insights

1. **The migration will fix bugs it wasn't asked to fix.** Budget for "fix or explicitly suppress" decisions on `app.js:459`, `app.js:526`, and the `getWorkItemFormService` dead-code function — these are not migration regressions, they're pre-existing defects the type-checker will surface. *Confidence: High.*

2. **"Incremental vs. big-bang" is a false binary for this codebase; the real axis is when the safety net goes up.** Because there is exactly one file, the file-count axis that normally defines "incremental" doesn't exist. The meaningful choice is whether type-checking happens before the syntactic rename (JSDoc/`checkJs` bootstrap) or after (rename-then-fix, with the file potentially red for a stretch). The former is recommended given the no-test-suite constraint. *Confidence: Medium-High.*

3. **The build-integration answer needed no new information — two independent gatherers reached it from different angles.** The configuration gatherer inferred `grunt-exec` was the natural fit purely from the existing task-graph shape, without having read the external gatherer's `grunt-ts` findings; the external gatherer confirmed `grunt-ts`'s unmaintained status independently. Convergence from two unrelated angles is a strong confidence signal. *Confidence: High.*

4. **The no-test-suite risk resolves to a process commitment, not a tool selection — structurally different from the other three success criteria.** Tooling, VSS typing, and Q typing each resolved to a specific artifact (a package, a compiler flag, a `.d.ts` source). This risk resolves to *behavior* over time, which can't be "set up once" the way the others can. *Confidence: Medium* (on the underlying pattern) / *High* (on the meta-observation that it's categorically different).

### Relationships and dependencies

- **Build tooling → strategy viability**: the `tsc`-via-`grunt-exec` decision is a precondition for either migration strategy — without a compile step wired into `package-dev`/`package-release`, no `.ts` file could ever ship as a working `.vsix`.
- **SDK typing availability → scope boundary**: because the SDK's bundled types cover the actually-used surface, the project doesn't need to touch the `azure-devops-extension-sdk` question at all for this migration — this is what allows confidently excluding the newer SDK rather than hedging.
- **Dead imports/dead code → reduced typing surface**: 3 of 7 AMD dependencies and 1 function need no typing effort at all if deleted during the port rather than preserved.
- **No-test-suite risk → strategy sequencing**: the absence of tests is precisely why JSDoc-bootstrap-before-rename sequencing matters — it's the only way to get compiler feedback before the higher-risk single-shot rename.

### Quality assessment (SWOT — of the recommended approach)

| | |
|---|---|
| **Strengths** | Zero new Grunt plugins; no DefinitelyTyped hunting; narrow, enumerable typing surface; clean tooling slate (no legacy config to reconcile); compiler will surface real pre-existing bugs |
| **Weaknesses** | No-test-suite risk has no tooling fix, only process discipline that depends on maintainer follow-through; single-shot rename step still carries genuine risk even with JSDoc bootstrap |
| **Opportunities** | Natural point to also consolidate the 3 duplicate logging functions and delete 3 dead AMD imports + 1 dead function per the project's own roadmap; version-mismatch cleanup (`package.json` vs. `vss-extension.json`) is low-cost to fold in |
| **Threats** | `vss-web-extension-sdk` is archived — future SDK-level bugs or Node/npm ecosystem shifts won't get vendor fixes; the newer SDK migration, when eventually needed, is a second, larger, separately-risked project |

---

## Conclusions

### Primary conclusions

1. **Tooling**: Add `typescript` and `@types/q` as devDependencies; reference the SDK's bundled types via `"types": ["vss-web-extension-sdk"]` in `tsconfig.json`; compile via a new `grunt-exec` target (`tsc -p tsconfig.json`) inserted ahead of `exec:package_dev`/`exec:package_release`; set `tsconfig.json`'s output so compiled JS lands at the unchanged `src/scripts/app.js` path with `"module": "amd"`. **Confidence: High.**

2. **Strategy**: Bootstrap with JSDoc annotations and `allowJs`/`checkJs` while the file is still `app.js`, resolve everything the compiler surfaces (including the pre-existing bugs at `app.js:459` and `app.js:526`), then perform a single-shot rename to `app.ts`. This is neither classic multi-file incremental migration nor an unguarded big-bang rename — it's the adaptation the single-file, no-test context calls for. **Confidence: Medium-High.**

3. **VSS SDK and Q typing**: Use the SDK's own bundled `typings/tfs.d.ts`/`vss.d.ts` for the AMD-declared modules; add one small hand-written `declare const VSS: {...}` ambient block for the non-AMD global; use `@types/q` (current, TS 4.5+ compatible) for `Q`. No DefinitelyTyped search and no larger hand-rolled `.d.ts` effort are needed. **Confidence: High.**

4. **No-test-suite risk**: Real and not tool-solvable. Mitigate with small reversible commits, treating the compiler as one verification source among several, and a manual checklist derived from the function inventory (`IsValidTemplateWIT`, `SortTemplates`, `getTemplates`, `createChildFromTemplate`, `AddTasks`, etc.) exercised side-by-side against pre- and post-migration `.vsix` builds in a real or sandbox Azure DevOps org. **Confidence: Medium.**

### Secondary conclusions
- Three dead AMD imports (`Controls`, `StatusIndicator`, `Dialogs`) and one dead function (`getWorkItemFormService`) are candidates for deletion during the port, reducing both migration effort and long-term maintenance surface — consistent with the project's own roadmap.
- Do not adopt `azure-devops-extension-sdk` as part of this migration; treat it as a distinct, future, separately-scoped project.
- The `package.json`/`vss-extension.json` version mismatch (`0.10.1` vs `1.1.17`) and the `^1.104.0`-vs-resolved-`1.110.0` SDK version discrepancy are pre-existing, low-severity, and orthogonal to the TS migration — worth fixing opportunistically, not blockers.

### Direct answer to the research question
The best approach is: compile with `tsc` via `grunt-exec` (not `grunt-ts`) to unchanged AMD output at `scripts/app.js`; type the VSS SDK from its own bundled declarations plus one small ambient `VSS` global, and type `Q` via the current `@types/q`; migrate the single `app.js` module via a JSDoc/`checkJs` bootstrap phase followed by a single-shot rename rather than either a classic multi-file incremental rollout or an unguarded big-bang rewrite; and treat the no-test-suite risk as a process problem solved by small commits and manual side-by-side `.vsix` verification, not a tooling gap that any package can close.

---

## Recommendations

| Priority | Recommendation | Effort | Rationale | Benefits | Risks |
|---|---|---|---|---|---|
| High | Add `typescript` + `@types/q` devDependencies; wire `tsc` into `gruntfile.js` via a new `grunt-exec` target ahead of `exec:package_dev`/`exec:package_release` | Small (M per roadmap) | Zero new Grunt plugins; reuses existing dependency; unblocks everything else | Establishes the build foundation with minimal new surface area | Must verify `outDir`/`rootDir` config precisely targets `src/scripts/app.js` or manifest/HTML need lockstep updates |
| High | Reference SDK types via `"types": ["vss-web-extension-sdk"]`; hand-write a minimal `declare const VSS` ambient block | Small | Bundled types cover the used surface; only the non-AMD global needs custom work | Avoids any DefinitelyTyped/hand-rolled `.d.ts` effort for 6 of 7 SDK surfaces | The archived/deprecated status of the SDK package itself is a longer-term maintenance risk, not a typing risk |
| High | Bootstrap `app.js` with JSDoc + `allowJs`/`checkJs` before renaming to `.ts` | Medium (L per roadmap, this is the sub-step) | Gets compiler feedback while still reversible in `.js`; addresses the no-test-suite constraint directly | Surfaces the two known implicit-global bugs and the dead-function bug before the syntactic rename, not during it | JSDoc annotations can be wrong/stale (a caution the literature itself raises) — treat as a bootstrapping aid, not a permanent substitute for real `.ts` types |
| Medium | Build a short manual verification checklist (one line per cataloged function) and exercise it against a real/sandbox `.vsix` before and after migration | Small | No tooling substitutes for tests; this is the closest available approximation | Catches behavioral regressions the compiler can't (e.g., logic errors, not just type errors) | Manual process — depends on maintainer discipline, not automatically enforced |
| Medium | Delete the 3 dead AMD imports (`Controls`, `StatusIndicator`, `Dialogs`) and the dead `getWorkItemFormService` function during the port rather than typing them | Small (S per roadmap) | Zero usages confirmed via grep; reduces both migration effort and long-term surface | Smaller diff, smaller typing surface, aligns with roadmap's stated cleanup goals | Low — dead code, no behavioral dependency found |
| Low | Reconcile `package.json` version (`0.10.1`) with `vss-extension.json` version (`1.1.17`), and update `tech-stack.md`'s `^1.104.0` reference to the actually-resolved `1.110.0` | Small (S per roadmap) | Pre-existing inconsistencies, not migration blockers | Documentation accuracy | None |
| Low (future, not this migration) | Evaluate `azure-devops-extension-sdk` as a separate, later project once the TS port is stable | Large | Confirmed not a drop-in; bundling it with this migration would balloon scope | Access to actively-maintained SDK, ES-module patterns | Requires reworking bootstrap (`VSS.init()`/`VSS.require()`), REST client naming, and possibly field-shape handling |

---

## Appendices

### Complete source list

**Codebase** (direct read, line-cited): `src/scripts/app.js` (617 lines), `src/gruntfile.js` (52 lines), `src/toolbar.html` (42 lines).

**Configuration** (direct read): `src/package.json`, `src/package-lock.json` (6,700+ lines, exhaustively searched for `q`), `src/vss-extension.json`, `src/configs/dev.json`, `src/configs/release.json`, `.maister/docs/standards/build-tooling/packaging.md`.

**Project documentation** (read during planning, referenced): `.maister/docs/project/vision.md`, `.maister/docs/project/roadmap.md`, `.maister/docs/project/tech-stack.md`.

**External** (direct fetch unless noted):
- TypeScript Handbook — Migrating from JavaScript: https://www.typescriptlang.org/docs/handbook/migrating-from-javascript.html
- `vss-web-extension-sdk` README: https://github.com/microsoft/vss-web-extension-sdk/blob/master/README.md
- `vss-web-extension-sdk` npm registry: https://registry.npmjs.org/vss-web-extension-sdk
- `@types/q` npm registry: https://registry.npmjs.org/@types/q
- `grunt-ts` README: https://github.com/TypeStrong/grunt-ts
- `grunt-ts` npm registry: https://registry.npmjs.org/grunt-ts
- `azure-devops-extension-sdk` GitHub: https://github.com/microsoft/azure-devops-extension-sdk
- `azure-devops-extension-sdk` npm registry: https://registry.npmjs.org/azure-devops-extension-sdk
- `azure-devops-extension-api` npm registry: https://registry.npmjs.org/azure-devops-extension-api (partial fetch)
- Porting VSS SDK to Azure DevOps SDK (Phong Cao, Medium): https://phongthaicao.medium.com/porting-vss-web-extension-sdk-to-azure-devops-web-extension-sdk-86a6ce3f39c2
- WebSearch aggregation (not individually fetched): 2024-2026 JS→TS migration case studies (Patreon, Mixmax, Dylan Vann, various decision-matrix pieces); understandlegacycode.com no-test-refactoring articles; Q-to-native-Promise discussion (jargon.js.org, Q npm README references, Angular `$q` discussions); `ts-migrate` (Airbnb) repo activity.

### Gaps and uncertainties
1. No-test-refactoring literature (understandlegacycode.com) and the Q-to-native-Promise recommendation are search-summary sourced only — a direct fetch was interrupted mid-session. Treat as directionally reliable, not verbatim-quotable.
2. `azure-devops-extension-sdk` v5.0.0's exact npm publish date returned as an internally implausible forward date by the registry; the freshness *signal* (non-archived, actively versioned) is trustworthy, the specific date is not.
3. `azure-devops-extension-api`'s bundled-types status is inconclusive (partial registry fetch) — low priority since this package is only relevant if the newer SDK is adopted, which this research recommends against for now.
4. The exact Q version bundled inside the minified `VSS.SDK.min.js` could not be determined (would require unminifying vendored code, out of scope) — low severity since `@types/q` types the stable public API surface, not a specific build.
5. Only `toolbar.html` was checked for how `app.js` is loaded; `vss-extension.json` was independently confirmed to define only one contribution (`create-linked-tasks-button`), making additional undiscovered entry points unlikely but not exhaustively ruled out.

### Methodology details
Three parallel gatherer instances (codebase, configuration, external-literature) per the research plan's rationale that codebase/config sources overlap heavily in a project this small, while literature carries proportionally more weight for a mixed research type addressing a well-trodden-but-context-specific question. Synthesis cross-referenced all three findings files for contradictions (one version-number discrepancy found and reconciled; no other contradictions found) and assigned per-claim confidence levels based on fetch method (direct primary-source fetch vs. search-result aggregation).

### Raw data references
Full findings detail: `analysis/findings/codebase-app-structure.md`, `analysis/findings/config-build-surface.md`, `analysis/findings/external-ts-migration-literature.md`. Cross-source pattern analysis: `analysis/synthesis.md`.
