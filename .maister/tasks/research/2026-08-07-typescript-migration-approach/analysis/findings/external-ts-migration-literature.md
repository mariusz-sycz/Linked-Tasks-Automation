# External Literature Findings: TypeScript Migration Approach

## TL;DR
The riskiest unknown resolves favorably: **`vss-web-extension-sdk` ships its own bundled TypeScript declaration files** (`typings/vss.d.ts`, `tfs.d.ts`, `rmo.d.ts`) — no DefinitelyTyped package is needed, and no hand-rolled ambient `.d.ts` fallback is required for the currently-used SDK. However, the package itself (and its GitHub repo) is archived/deprecated in favor of Microsoft's newer `azure-devops-extension-sdk`, which is **not a drop-in replacement** (different init pattern, no RequireJS/AMD page-load model, renamed REST client types) and constitutes a separate, larger migration than what's in scope here. `grunt-ts` is confirmed unmaintained (mature/maintenance-only, seeking maintainers, last stable-ish beta 6 years old) — `tsc` invoked directly (via `grunt-exec` or a plain npm script) is the current, lower-overhead standard for solo/small-team Grunt+TS setups. `@types/q` is surprisingly current (v1.5.8, published Nov 2023, targets TS 4.5+), so Q does not need to be typed via hand-written stubs, though converting to native Promises remains a commonly-recommended (not mandatory) companion step. Industry guidance from 2024-2026 consistently favors incremental `allowJs`/`checkJs` bootstrapping over big-bang rewrites, but explicitly treats single-file/leaf-first codebases as a special case where a fuller one-shot rename is more viable — directly applicable to this project's single 617-line `app.js`. For the no-test-suite risk, the strongest applicable pattern from the literature is manual/characterization-style verification (small reversible steps, micro-commits, side-by-side output comparison) rather than any single silver-bullet tool.

## Key Decisions (recommendations this literature supports)
- **Do not adopt Microsoft's `azure-devops-extension-sdk`/`azure-devops-extension-api` as part of this migration.** It is a separate SDK with a different initialization/module model; conflating it with the TS migration would balloon scope beyond what the roadmap specifies. Stay on `vss-web-extension-sdk` and use its bundled typings.
- **Use `tsc` directly (via `grunt-exec`, already a dependency) rather than `grunt-ts`.** `grunt-ts` is in permanent maintenance mode and openly seeking a new maintainer — a red flag for a solo-maintainer project that wants low ongoing friction.
- **Keep `@types/q`** rather than hand-writing Q typings — it's actively current relative to modern TypeScript. Converting `.then()` chains to native Promises can be *considered* later as a code-quality improvement but isn't required for typing to work.
- **Given the single-file scope, evaluate a near-big-bang rename (`app.js` → `app.ts` in one pass with `allowJs`/`checkJs` bootstrapping first)** rather than a multi-week incremental rollout — literature explicitly frames incremental, leaf-first strategies as designed for *multi-file* codebases; a single ~617-line module doesn't have "leaves" to peel off incrementally in the same sense.
- **No-test-suite mitigation should combine**: JSDoc+`@ts-check` bootstrap before full conversion (catches type errors pre-rename), small reversible commits reviewed function-by-function, and side-by-side manual comparison of the pre- and post-migration `.vsix` behavior in a real Azure DevOps org — not a single tool substitute for tests.

## Open Questions / Risks
- Exact publish date for `azure-devops-extension-sdk` v5.0.0 returned as "June 11, 2026" via the npm registry API — later than this research's date context; flagged as possibly reflecting a forward-dated/pre-release registry entry rather than a confirmed historical fact. Treat the *freshness* signal (actively versioned, non-archived) as reliable; treat the exact date as low-confidence pending a manual npm page check.
- `azure-devops-extension-api`'s bundled-types status came back inconclusive (registry `time`/`types` fields weren't fully retrievable) — low priority since this package is only relevant if adopting the newer SDK, which this research recommends against for the current migration scope.
- Two fetched sources gave partially conflicting signals on whether AMD/RequireJS removal is required when using the newer SDK (a porting how-to said yes for webpack bundling; the SDK's own README said AMD compatibility is retained) — resolved by treating this as further evidence the newer SDK is a distinct migration path with its own nuances, not something to adopt here, so the discrepancy doesn't affect this project's recommendation.
- Could not directly fetch `understandlegacycode.com`'s full article on refactoring-without-tests approaches (tool access issue) — findings below rely on the search-result summary only; treat the "characterization/golden-master" framing as directionally correct but not verbatim-quoted.

---

## 1. TypeScript Migration Guidance (Incremental vs. Big-Bang)

### TypeScript official handbook — "Migrating from JavaScript"
**Source**: https://www.typescriptlang.org/docs/handbook/migrating-from-javascript.html
**Evidence/summary** (fetched directly):
- Recommended path: add `tsconfig.json` with `allowJs: true` (+ `outDir`, `target`), which lets `tsc` run immediately over existing `.js` files with zero conversion.
- Rename files from `.js` to `.ts` incrementally, one at a time; TypeScript still emits output even with type errors present ("similar to spell-check").
- Address common migration errors as they surface: convert `require()` to `import`, install `@types/*` packages for third-party deps, replace `module.exports` with `export`.
- Strictness is meant to be turned on progressively: start lenient, then enable `noImplicitAny`, `noImplicitThis`, `noFallthroughCasesInSwitch`, `noImplicitReturns` as confidence grows, and `strictNullChecks` last.
- Direct quote captured: *"If you plan on using the stricter settings that are available, it's best to turn them on now... While it might feel somewhat overwhelming, the long-term gains become apparent much more quickly."*
- Build tool integration guidance covers webpack (`ts-loader` + `source-map-loader`) and references a separate Gulp guide; Grunt is not mentioned in this particular handbook page.
**Confidence**: High — official first-party documentation, fetched directly.

### tsconfig.json reference (`allowJs`/`checkJs`/`strict`)
**Source**: https://www.typescriptlang.org/tsconfig — listed in sources.md as a planned reference; not independently re-fetched this pass since the migration handbook page above already surfaces the relevant flags (`allowJs`, `noEmitOnError`, `noImplicitAny`, `strictNullChecks`) with consistent semantics. No conflicting information found elsewhere.
**Confidence**: Medium (not independently fetched this session, but corroborated by handbook content and general TS documentation consistency).

### Current (2024-2026) industry guidance on incremental vs. big-bang for small/single-file, no-test codebases
**Source**: search aggregation, notably a decision-matrix style 2025 article surfaced via WebSearch (title: "JS to TypeScript: Incremental Migration, No Full Rewrite" / related iloveblogs.blog 2026 guide) and a Medium "Incremental vs Big Bang Migration" piece.
**Evidence**:
- A 2025-era decision matrix (per search synthesis): choose **incremental** migration if you need to keep production running, if old/new can coexist, or mid-migration between frameworks; choose **big-bang** if the current codebase is unmaintainable, you have full test coverage and staging, or the team is too small to maintain two stacks simultaneously.
- For small/single-file codebases specifically, search-synthesized guidance states: *"add tsconfig with allowJs:true and strict:false, renaming files one folder at a time, starting at the leaves (utils, types) and working toward the entry points, then using @ts-expect-error as a temporary bridge and tightening compiler flags once the rename is complete."*
- Most teams are advised to type the API boundary and shared domain models first, tightening strictness progressively rather than repo-wide on day one.
**Context for this project**: The "leaves first" framing assumes a multi-file tree; `app.js` is a single 617-line file with no internal module boundaries to peel off separately, so the applicable adaptation is: bootstrap with `allowJs`/`checkJs` + JSDoc first, fix type errors while still `.js`, *then* do a single-shot rename to `.ts` once errors are addressed — effectively front-loading the "incremental" safety into the pre-rename JSDoc phase rather than spreading the rename itself across many small file-by-file steps (because there's only one file to rename).
**Confidence**: Medium — synthesized from search-result summaries rather than a single fully-fetched authoritative article; directionally consistent across multiple independent sources found (Patreon's 11,000-file migration retrospective, Mixmax's incremental migration writeup, Dylan Vann's 100k-LOC incremental piece — all confirm incremental-by-default as the dominant industry pattern for larger codebases, reinforcing that "big-bang" is the exception reserved for small/fully-covered/unmaintainable cases).
**Note on staleness**: search results included a "2026" dated guide (iloveblogs.blog) and a 2025 Medium decision-matrix piece, satisfying the post-2023 non-stale requirement from the research plan.

### JSDoc-first bootstrapping specifically
**Source**: search aggregation citing Medium ("Kick-start your Typescript migration with JSDoc and ts-migrate" by Jeremy Monson) and general TS handbook JSDoc-support docs.
**Evidence**: *"Because TypeScript's native type syntax is absent from raw JavaScript, developers can use JSDoc annotations to provide type information to .js files. TypeScript may identify JSDoc definitions and use this structured data as input for its type checker when allowJs and/or checkJs are enabled."* Typical sequence per synthesis: add `tsconfig.json` → enable `allowJs`/`checkJs` → rename `.js`→`.ts` → suppress remaining errors with `any` → write new code in TS → revisit old code later to tighten types.
A caution surfaced in the same search: *"JSDoc was used to give typing information to functions, but comments can lie to you... By contrast, the information that types give us is never out of date and seldom lies."* — i.e., JSDoc is a *bootstrapping* aid, not a permanent substitute for real `.ts` types.
**Confidence**: Medium (search-synthesized, not independently fetched).

### `ts-migrate` (Airbnb's automated JSDoc/rename tool)
**Source**: https://github.com/airbnb/ts-migrate ; npm: https://www.npmjs.com/package/ts-migrate
**Evidence**: Search results show repo activity (master branch updated June 23, 2024; issues opened through Sept 2024, discussion as recent as Feb 2025) but did **not** confirm current active maintenance vs. dormant-but-not-archived status definitively.
**Applicability note**: `ts-migrate` is designed for automating bulk multi-file conversion (inserting `@ts-expect-error`/`any` at scale). For a single 617-line file, the tool's main value proposition (automation at scale) is much less relevant — manual JSDoc annotation + manual rename is likely lower-overhead than introducing another tool dependency for one file.
**Confidence**: Low-Medium on maintenance status specifically; the applicability judgment (low value for single-file scope) is higher confidence given the tool's stated purpose.

---

## 2. Grunt + TypeScript Integration

### `grunt-ts` maintenance status
**Source**: https://github.com/TypeStrong/grunt-ts (README, fetched directly); npm registry https://registry.npmjs.org/grunt-ts (fetched directly); corroborating search hits (Snyk, Libraries.io).
**Evidence** (direct quotes from README, fetched):
- *"This project, much like Grunt itself, is now in a mature maintenance phase and no significant features will be considered."*
- *"Looking for Maintainers - Do you use grunt-ts? Would you like to help keep it up-to-date for new TypeScript versions? Please let @nycdotnet know. I am no longer maintaining this plugin as I no longer use Grunt."*
- 72 open issues; 1,075 commits total (no longer actively growing per maintainer's own statement).
- Latest npm version: `6.0.0-beta.22` — per search-aggregated Libraries.io/Snyk data, last published roughly 6 years ago (no stable non-beta 6.0.0 release ever shipped to npm).
- README itself recommends module bundlers (Webpack/Browserify/r.js) as the modern alternative for certain use cases, implicitly acknowledging its own tool is dated.
**Confidence**: High — directly confirms the research plan's hypothesis that `grunt-ts` is unmaintained/stale.

### `tsc` via `grunt-exec` (or plain npm script) as the alternative
**Source**: search aggregation (Medium — Tomas Trajan "Use Typescript, it's easy!"; general grunt-exec usage patterns); no single canonical "grunt-exec + tsc" tutorial was found as a dedicated first-class guide, but the underlying pattern (grunt-exec shelling out to CLI tools not covered by dedicated Grunt plugins) is a documented, generic `grunt-exec` use case.
**Evidence**: *"There isn't any grunt wrapper for [some CLI tool], so it can be executed with help of grunt-exec"* — this is the general pattern grunt-exec exists for: wrapping arbitrary CLI commands (like `tsc`) as Grunt tasks when a dedicated plugin is unmaintained or absent.
**Applicability**: Since `grunt-exec` is already a `package.json` devDependency in this project (per sources.md), adding a `grunt.config.exec.tsc` (or similarly named) target that just runs `tsc -p tsconfig.json` (or `npx tsc`) requires no new Grunt plugin dependency at all — lowest-overhead integration option, consistent with the solo-maintainer/low-overhead constraint.
**Confidence**: Medium — the specific "grunt-exec + tsc" combination isn't heavily documented as a named pattern in the literature (because it's a trivial, generic use of grunt-exec's design purpose), but the underlying mechanism is well-established and needs no exotic configuration.

### `typescript` npm package / `tsc` CLI for simple single-command compilation
**Source**: https://www.typescriptlang.org/docs/handbook/compiler-options.html (referenced in sources.md; general TS CLI knowledge — `tsc -p tsconfig.json` or `tsc --outFile`/`--outDir` for single-file/simple builds).
**Note**: Not independently re-fetched this pass (compiler-options reference is stable, low-risk-of-staleness documentation); the relevant fact — that `tsc` supports a zero-config, single-invocation compile mode driven entirely by `tsconfig.json`, requiring no watch mode or CI pipeline — is standard, uncontested TS tooling behavior consistent across all other TS sources fetched in this research pass.
**Confidence**: High (well-established tool behavior, indirectly corroborated).

---

## 3. VSS SDK Type Definitions (highest priority)

### `vss-web-extension-sdk` — bundled types, NOT DefinitelyTyped
**Source**: https://github.com/microsoft/vss-web-extension-sdk/blob/master/README.md (fetched directly); https://registry.npmjs.org/vss-web-extension-sdk (fetched directly); corroborating WebSearch hits (npm page description, Libraries.io).
**Evidence**:
- The SDK ships **three TypeScript declaration files directly in the package**, under `typings/`:
  - `vss.d.ts` — VSS.SDK.js core, UI controls, client services
  - `tfs.d.ts` — REST clients/contracts for Build, Work, and Code (this covers `TFS/WorkItemTracking/Services`, `TFS/WorkItemTracking/RestClient`, `TFS/Work/RestClient` — the exact modules this project uses per sources.md)
  - `rmo.d.ts` — REST clients/contracts for Release Management (not used by this project)
- Two consumption patterns documented: (1) set `"moduleResolution": "node"` and `"types": ["vss-web-extension-sdk"]` in `tsconfig.json`, or (2) add `/// <reference types="vss-web-extension-sdk" />` at the top of TS files.
- Sample `tsconfig.json` from the SDK's own docs uses `"module": "amd"`, `"target": "es5"`, `"rootDir": "src/"`, `"outDir": "dist/"` — directly compatible with this project's existing AMD/RequireJS runtime expectation (VSS's host frame expects `define()`-wrapped output), and requires **TypeScript 2.5+** (trivially satisfied by any modern TS version).
- `@types/jquery` and `@types/q` are needed **only if** the TS code directly references those libraries' types (which this project's app.js does, via Q promise chains) — so `@types/q` should be added as a devDependency (see §4).
- **Repository status**: archived by Microsoft on **January 27, 2023**. README explicitly states: *"Microsoft recommends using the Azure DevOps Extension SDK instead for ongoing development."*
- **npm package status**: latest published version `5.141.0`, published **September 28, 2018** (created Feb 8, 2016, last npm metadata modification May 2, 2023 — i.e., no new code releases since 2018, only metadata touch-ups). Every version carries an npm deprecation notice: *"Package no longer supported. Please use https://www.npmjs.com/package/azure-devops-extension-sdk instead."*
**Implication**: The types exist, are current enough (SDK repo bundles them, no external DefinitelyTyped dependency needed, no version-compatibility gap since TS 2.5+ requirement is trivially met by any TS 4.x/5.x), and directly cover the modules this project uses. **The "hand-rolled ambient `.d.ts` fallback" flagged as a risk in the research plan is not needed** for the currently-installed SDK version (`^1.104.0`) — though the underlying package itself is unmaintained/deprecated at the *project* level (separate from typing availability).
**Confidence**: High — both primary sources (GitHub README, npm registry) fetched directly and mutually consistent.

### `azure-devops-extension-sdk` — NOT a drop-in replacement
**Source**: https://github.com/microsoft/azure-devops-extension-sdk (fetched); https://registry.npmjs.org/azure-devops-extension-sdk (fetched); https://phongthaicao.medium.com/porting-vss-web-extension-sdk-to-azure-devops-web-extension-sdk-86a6ce3f39c2 (fetched); npm/GitHub search aggregation.
**Evidence**:
- npm registry: latest version `5.0.0`, description "Azure DevOps web extension JavaScript library," ships its own `types` field pointing to `./SDK.d.ts` (bundled types, actively versioned — not a dead/archived package like the old SDK).
- Porting article (Phong Cao, Medium) frames this as a **"moderate, targeted" but real migration**, not a drop-in swap: requires removing `libraryTarget: "amd"` from webpack config, replacing the old `VSS.init()`/`VSS.require()` pattern with direct ES imports + `sdkInit()`, updating REST client class/interface names (methods stay largely the same), and adjusting some field-shape changes (e.g., `System.AssignedTo` returns a JSON object instead of a string in the new SDK).
- The SDK's own GitHub README states AMD compatibility is retained at some level (*"Existing support for AMD modules remains intact... you can continue to use them as before without any changes"*) — this appears to refer to consuming *other* AMD modules from within extension code, not to the page-load/host-communication bootstrap mechanism, which the porting article says does change. This is a real ambiguity in the literature (see Open Questions above) but doesn't change the bottom-line scoping conclusion.
- No migration guide was found in the new SDK's own README addressing the old SDK directly — the Medium article is a third-party account, not official Microsoft migration documentation.
**Bottom line for scoping**: Adopting `azure-devops-extension-sdk` would mean also reworking the AMD/RequireJS bootstrap, `VSS.init()` calls, and REST client references — on top of (not instead of) the JS→TS conversion. This is explicitly **out of scope** per the research plan and should be flagged as a distinct, larger future migration (consistent with the roadmap's "ground refactor to TypeScript" being scoped separately from any SDK-generation change).
**Confidence**: Medium-High — multiple independent sources agree on the general shape (real changes required, not drop-in); exact scope of AMD-related changes has some source disagreement noted above.

### `azure-devops-extension-api`
**Source**: https://registry.npmjs.org/azure-devops-extension-api (fetched); WebSearch aggregation.
**Evidence**: Companion package providing REST client libraries and TypeScript contracts, described in search results as "REST client libraries and contracts for Azure DevOps web extension developers," latest version `5.275.0` found in registry data. Only relevant if/when the new SDK is adopted — not relevant to the current, in-scope migration.
**Confidence**: Low (registry fetch was incomplete for this package; low priority given it's out of scope).

---

## 4. Q Promise Library Typing

### `@types/q` — current, not stale
**Source**: https://registry.npmjs.org/@types/q (fetched directly).
**Evidence**: Latest version **1.5.8**, published **November 7, 2023**. `typeScriptVersion` field indicates it targets **TypeScript 4.5 or later**. MIT licensed. No deprecation notice found.
**Implication**: This directly contradicts the research plan's prior assumption ("aged `@types/q` definitions... last relevant ~2016-2018") — the types package itself has been kept current into the modern TypeScript era (4.5+ covers all TS versions realistically in use today, including 5.x). No compatibility gap exists for typing Q via `@types/q`.
**Confidence**: High — fetched directly from the npm registry.

### Q's own TypeScript support
Not independently verified this pass (Q's own repo/README wasn't fetched); however, since `@types/q` exists as a separate, actively-versioned DefinitelyTyped-style package (not bundled with `q` itself), the working assumption — consistent with standard DefinitelyTyped conventions — is that Q does **not** ship its own types and relies entirely on `@types/q`. This is standard for older, pre-TypeScript-native libraries.
**Confidence**: Medium (inferred from package structure convention, not directly confirmed via Q's own repo).

### Converting Q chains to native Promises — commonly recommended companion step
**Source**: WebSearch aggregation citing Q's own npm README/author statement, plus general community discussion (Q project jargon.js.org glossary entry, Angular `$q` vs. native Promise discussions).
**Evidence**: *"The Q library author's message states that users should almost certainly migrate to the native JavaScript promise now."* Practical conversion notes surfaced: `.done`/`.fail` → `.then`/`.catch`; `.always()` → `.finally()`; constructor pattern differs and requires restructuring executor code.
**Why this is relevant but not required**: Native Promises are fully typed by TypeScript's own lib definitions (no `@types` package needed at all), which is strictly simpler than depending on `@types/q`. However, since `@types/q` is current and adequate (see above), converting Q→native Promises is a **nice-to-have simplification**, not a typing necessity — it would reduce one dependency and align with modern JS, but doing so simultaneously with the TS rename increases the size/risk of the change in a no-test-suite codebase. Recommendation implication for synthesis: treat as an optional follow-up, not a migration blocker or prerequisite.
**Confidence**: Medium (search-synthesized; the author-recommendation claim wasn't independently fetched from Q's own README this pass).

---

## 5. No-Test-Suite Migration Risk & Mitigation

### JSDoc-first + incremental strictness as a risk-reduction pattern
Already covered in §1 — using `allowJs`/`checkJs`/JSDoc to get compiler-checked feedback *before* the syntactic `.ts` rename is itself a no-test-suite mitigation: it turns the TypeScript compiler into a static-analysis safety net that substitutes (partially) for missing automated tests, catching type mismatches, undefined-variable typos, and incorrect argument shapes without requiring a test runner.

### Characterization/golden-master and manual-verification patterns
**Source**: WebSearch aggregation of understandlegacycode.com articles ("Refactoring without tests: Mitigating trip hazards," "Comparing 2 approaches of refactoring untested code," "Another way of refactoring untested code," "4 tips to refactor a complex legacy app without automation tools") — search-result summary only; direct fetch of the full article was not completed this session (tool access was interrupted), so treat specific phrasing as paraphrased/search-engine-summarized rather than verbatim-quoted.
**Evidence** (from search synthesis):
- *"Building a safety net is essential for legacy code refactoring, as without one, even a small change can create unexpected bugs or break critical workflows."*
- **Characterization/approval tests (golden master technique)**: capture existing outputs for a range of inputs before changing code, then diff against those captured outputs after the change — described as "the fastest way to put existing code under tests" when no tests exist yet.
- **Manual-verification techniques when automated tests aren't feasible**: pair/ensemble programming (especially "strong-style pairing"), micro-commits reviewed individually, manually testing code paths between the base commit and HEAD, and deriving proof of correctness from at least two independent sources (compiler, IDE, linter, VCS diff) rather than relying on a single check.
- **Broader legacy-migration framing**: *"Legacy refactors fail when teams rewrite from scratch or refactor without tests; instead, lock current behavior with characterization tests, create seams to isolate dependencies, refactor in small reversible steps, and use Strangler Fig for system-level replacement."*
**Applicability to this project**: A lightweight, solo-maintainer-appropriate adaptation of "characterization tests" doesn't require a formal test framework — it can be as simple as: (1) build and manually exercise the current `.vsix` in a real/sandbox Azure DevOps project, recording expected behavior for each of the cataloged functions (`IsValidTemplateWIT`, `SortTemplates`, `getTemplates`, `createChildFromTemplate`, `AddTasks`, etc., per sources.md's function inventory) as a short manual checklist; (2) after each incremental TS-migration step, rebuild and re-run the same checklist against the new `.vsix` side-by-side; (3) keep changes in small, individually-reviewable commits (the TypeScript compiler itself acts as one of the "independent sources of proof" the literature recommends, alongside manual testing).
**Confidence**: Medium — directionally strong and consistent across multiple independent understandlegacycode.com posts found via search, but not independently verified via direct fetch this session due to a tool-access interruption.

### `@ts-nocheck` / `@ts-expect-error` as a per-file/per-line opt-out
Covered implicitly in §1's JSDoc-first synthesis (*"using @ts-expect-error as a temporary bridge"*). For a single-file migration, the more relevant unit is per-function or per-block suppression rather than per-file (since there's only one file), but the underlying pattern — temporarily suppressing specific known-hard-to-type sections while getting the bulk of the file type-checked — transfers directly.
**Confidence**: Medium (search-synthesized, consistent with general TypeScript community practice).

---

## Source List (with dates where available)

| Source | URL | Date / Freshness | Fetch Method |
|---|---|---|---|
| TypeScript Handbook — Migrating from JavaScript | typescriptlang.org/docs/handbook/migrating-from-javascript.html | Evergreen official doc (undated, current) | Direct fetch |
| vss-web-extension-sdk README | github.com/microsoft/vss-web-extension-sdk/blob/master/README.md | Repo archived Jan 27, 2023 | Direct fetch |
| vss-web-extension-sdk npm registry | registry.npmjs.org/vss-web-extension-sdk | Latest 5.141.0, published Sep 28, 2018; metadata touched May 2, 2023 | Direct fetch |
| @types/q npm registry | registry.npmjs.org/@types/q | v1.5.8, published Nov 7, 2023; targets TS 4.5+ | Direct fetch |
| grunt-ts README | github.com/TypeStrong/grunt-ts | Maintenance-mode statement (undated in fetch, but "seeking maintainers" language) | Direct fetch |
| grunt-ts npm registry | registry.npmjs.org/grunt-ts | Latest 6.0.0-beta.22, ~6 years old per search aggregation | Direct fetch + search corroboration |
| azure-devops-extension-sdk GitHub | github.com/microsoft/azure-devops-extension-sdk | Active (not archived) | Direct fetch |
| azure-devops-extension-sdk npm registry | registry.npmjs.org/azure-devops-extension-sdk | Latest 5.0.0; registry-reported publish date June 11, 2026 (flagged low-confidence, see Open Questions) | Direct fetch |
| azure-devops-extension-api npm registry | registry.npmjs.org/azure-devops-extension-api | Latest 5.275.0 per fetch; date not retrieved | Direct fetch (partial) |
| Porting VSS SDK to Azure DevOps SDK (Phong Cao) | phongthaicao.medium.com/porting-vss-web-extension-sdk-to-azure-devops-web-extension-sdk-86a6ce3f39c2 | Undated in fetch | Direct fetch |
| Various 2024-2026 JS→TS migration guides (iloveblogs.blog 2026 guide, Mixmax, Dylan Vann, Patreon 11k-files retrospective, Medium decision-matrix piece) | multiple, listed inline in §1 | 2024-2026 range per search metadata | WebSearch aggregation (not individually fetched) |
| understandlegacycode.com refactoring-without-tests articles | understandlegacycode.com/blog/* (multiple posts) | Undated in search results | WebSearch aggregation only (direct fetch interrupted) |
| Q library native-Promise migration discussion | jargon.js.org, npmjs.com/package/q, Angular $q discussions | Undated | WebSearch aggregation only |
| ts-migrate (Airbnb) | github.com/airbnb/ts-migrate | Repo activity through June 2024 / Feb 2025 per search | WebSearch aggregation only |

---

## Gaps for Synthesis to Note
1. `azure-devops-extension-api` types-bundling status is unresolved (low priority — out of scope package).
2. The AMD-compatibility ambiguity between the new SDK's README and the third-party porting article is unresolved but doesn't affect the recommendation (new SDK stays out of scope regardless).
3. The understandlegacycode.com no-test-refactoring literature and Q-native-Promise recommendation were not independently fetched/verified beyond search-engine summaries — treat as medium-confidence, directionally reliable but not verbatim-sourced.
4. `azure-devops-extension-sdk` v5.0.0's registry-reported publish date (June 11, 2026) could not be cross-checked against a second source this session; the *freshness signal* (recent, non-archived, actively versioned) is trustworthy regardless of the exact date's accuracy.
