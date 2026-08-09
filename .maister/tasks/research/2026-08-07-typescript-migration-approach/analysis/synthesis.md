# Synthesis: TypeScript Migration Approach

## TL;DR
The three gatherers agree cleanly with no material contradictions. The riskiest unknown — VSS SDK typings — resolves favorably: `vss-web-extension-sdk` ships its own bundled `.d.ts` files, so no DefinitelyTyped lookup or hand-rolled ambient declarations are needed for the SDK's AMD/REST surface (only the non-AMD global `VSS` needs a one-line ambient `declare`). `@types/q` is current, not stale. `grunt-ts` is dead; `tsc` via the already-installed `grunt-exec` is the lowest-friction build integration. For a single 617-line file, the multi-file "incremental leaf-first" literature doesn't transplant directly — the adapted strategy is JSDoc/`checkJs` bootstrap followed by a single-shot `.ts` rename. No-test-suite risk is real and unmitigated by tooling; the answer is process (small commits, manual `.vsix` comparison), not a tool substitute.

## Key Decisions
- **Confidence-rank every finding explicitly** (below) so the report can distinguish "fetched primary source" claims from "search-summary" claims — this task's own success criteria demands source-traceable claims, and two gatherers flagged their own confidence gaps.
- **Reconcile the package-lock version discrepancy explicitly rather than silently picking one number** — report both `^1.104.0` (docs/manifest assumption) and `1.110.0` (actual resolved lockfile version) and note the typings claim holds for both since it's a repo-bundled `typings/` folder, not a version-pinned DefinitelyTyped package.
- **Treat the single-file "near-big-bang" recommendation as the synthesis's most load-bearing adaptation** — it's the one place where general literature (multi-file, leaf-first) had to be reasoned about rather than applied directly, so the report must show that reasoning, not just assert the conclusion.

## Open Questions / Risks
- Two literature threads (no-test-refactoring characterization patterns, Q→native-Promise recommendation) rest on WebSearch summaries only, never a direct WebFetch — carried into the report as medium-confidence, directionally-reliable-but-not-verbatim.
- `azure-devops-extension-sdk` v5.0.0's exact npm publish date (registry returned "June 11, 2026") could not be cross-verified — the freshness *signal* (actively versioned, non-archived) is solid; the specific date is not.
- `Q`'s exact runtime version bundled inside the minified `VSS.SDK.min.js` was not extractable by any gatherer (out of scope to unminify) — typing is against Q's known API shape as used in `app.js`, not a verified installed version number. This is a low-severity gap since `@types/q` types the interface, not a specific build.

---

## Research Question
What is the best approach for migrating the Linked-Tasks-Automation Azure DevOps extension (AMD/RequireJS, Grunt build, VSS SDK, Q promises, no tests) to TypeScript — including tooling choices, incremental vs. big-bang migration strategy, and type definitions for the VSS SDK?

## Executive Summary
All three findings files converge on a low-friction, low-risk migration path that fits a solo-maintained, single-module extension. The codebase gatherer establishes the migration *target*: one 617-line AMD module (`src/scripts/app.js`) with a narrow, enumerable SDK surface (2 REST clients, 7 methods, `Q`'s static+instance API, one non-AMD global `VSS`), plus concrete pre-existing bugs (two implicit globals, one dead-code function with a synchronous-return-of-async-value bug, three dead AMD imports, three byte-identical logging functions) that a TypeScript `strict` pass will surface as compile errors regardless of migration strategy. The configuration gatherer establishes the *build constraints*: no TS/lint tooling exists today (clean slate), `Q` is not an npm dependency at all (resolved purely through the SDK's own AMD runtime), and the compiled output must keep landing at the literal path `scripts/app.js` for the Marketplace manifest and `toolbar.html`'s loader call to keep resolving. The external-literature gatherer resolves the single highest-uncertainty question favorably: `vss-web-extension-sdk` bundles its own `.d.ts` typings (`vss.d.ts`, `tfs.d.ts`, `rmo.d.ts`) covering exactly the modules this project uses, eliminating the need for DefinitelyTyped lookups or hand-rolled ambient declarations for the SDK's AMD surface.

The synthesis's main analytical contribution is reconciling the "incremental vs. big-bang" question for a codebase that doesn't fit the shape the literature assumes. Industry guidance (Patreon, Mixmax, Dylan Vann, generic 2025-2026 decision-matrix pieces) defaults to incremental, leaf-first migration — but that pattern presumes a multi-file tree with genuine leaves (utils, types) to peel off before touching entry points. `app.js` is one file with no internal module boundaries; "incremental" in the leaf-first sense doesn't apply. The literature's own stated exception criteria for big-bang (unmaintainable codebase size N/A here — it's small; test coverage — none, cuts the other way; team too small to maintain two stacks — true, solo maintainer) partially argue big-bang, but the no-test-suite constraint is exactly the scenario general literature warns hardest against for big-bang. The resolution both gatherers converge toward is a hybrid: front-load the safety net into a JSDoc + `allowJs`/`checkJs` bootstrap phase *while still in `.js`*, fix everything the compiler catches, and only then do a single-shot rename to `.ts` — effectively getting incremental-migration safety without needing multiple files to incrementalize across.

For the no-test-suite risk specifically, no source proposes a tooling substitute for tests — the consistent recommendation across the TypeScript-adoption literature and the legacy-refactoring literature (understandlegacycode.com summaries) is process discipline: small reversible commits, the compiler itself as one "independent source of proof," and manual/characterization-style verification (side-by-side `.vsix` behavior comparison in a real or sandbox Azure DevOps org) as the closest available approximation to a regression safety net.

## Cross-Source Analysis

### Validated findings (confirmed by multiple sources)
- **AMD/`define()` output must be preserved.** Codebase gatherer confirms via `toolbar.html:21` (`VSS.require(["scripts/app"], ...)`) and `app.js:1` (`define([...])`); config gatherer independently confirms via the manifest's literal `files[]` path (`vss-extension.json:57`) and the packaging standard. External gatherer confirms the SDK's own sample `tsconfig.json` uses `"module": "amd"` — all three agree TS must compile to AMD output at the unchanged `scripts/app.js` path. **Confidence: High** (three independent sources, direct evidence in each).
- **`Q` is not an npm dependency.** Config gatherer confirms via exhaustive `package-lock.json` search (zero matches) and codebase gatherer independently confirms via `app.js:1-2`'s AMD `define([..., "q", ...])` declaration with no corresponding `package.json` entry. Both conclude runtime resolution happens through the SDK's bundled AMD loader, not npm. **Confidence: High**.
- **`grunt-exec` is the lowest-overhead build-integration path.** Config gatherer identifies it as already-installed and structurally suited (`gruntfile.js:4-23` already uses it for `tfx-cli` invocation); external gatherer independently confirms `grunt-ts` is unmaintained (direct README quote: "mature maintenance phase," "Looking for Maintainers") and that wrapping arbitrary CLI tools via `grunt-exec` is exactly the plugin's documented use case. **Confidence: High** (convergent from two independent angles — the config gatherer never read the external grunt-ts findings, yet arrived at the same recommendation from the task-graph shape alone).

### Contradictions identified and resolved
- **SDK version: `^1.104.0` (docs/tech-stack.md, package.json range) vs. `1.110.0` (package-lock.json resolved version).** Not a true contradiction — `^1.104.0` is a semver range in `package.json`, and `1.110.0` is what actually resolved within that range. Resolution: report the actual installed version (`1.110.0`) as authoritative for compatibility statements, since it's what's really in `node_modules`. This doesn't affect the typings conclusion because the `typings/` folder ships inside every published version of the package as a repo-bundled asset, not a version-gated add-on — confirmed by the external gatherer's finding that the SDK requires only "TypeScript 2.5+," trivially satisfied regardless of which 1.x SDK version is installed.
- **AMD-compatibility ambiguity for the *newer* `azure-devops-extension-sdk`** (external gatherer's own flagged open question — porting article says AMD/webpack changes are needed, the new SDK's README says AMD compat is retained). Resolution: irrelevant to this project's recommendation, since both this synthesis and the external gatherer conclude the newer SDK is out of scope regardless of how that ambiguity resolves. Flagged in the report as a non-blocking open question only for completeness.

### Confidence assessment (rollup)
| Claim | Level | Basis |
|---|---|---|
| VSS SDK ships bundled `.d.ts` typings covering the used surface | High | Direct fetch of GitHub README + npm registry, cross-checked against codebase's own SDK-surface inventory |
| `@types/q` is current (not stale) | High | Direct npm registry fetch, single unambiguous version/date |
| `grunt-ts` unmaintained; `grunt-exec`+`tsc` preferred | High | Direct README fetch + convergent independent config-gatherer reasoning |
| AMD output must be preserved at `scripts/app.js` | High | Three independent sources, direct file/line evidence each |
| Single-file JSDoc-bootstrap-then-rename is the right strategy | Medium-High | Sound literature-to-context reasoning, but the specific "single-file adaptation" framing is synthesized/adapted rather than found verbatim in a source |
| No-test-suite mitigation via manual/characterization verification | Medium | Search-summary sourcing only, not directly fetched; directionally consistent across multiple independent search hits |
| Q→native-Promise as optional companion step | Medium | Search-summary sourcing only |
| `azure-devops-extension-sdk` publish-date freshness | Medium (signal) / Low (exact date) | Registry fetch returned an internally-inconsistent forward date |

## Patterns and Themes

### Pattern: "Bundled types over registry lookup" for niche/legacy SDKs
**Description**: Rather than assuming DefinitelyTyped coverage, the highest-value external research step was checking the SDK package itself for a `typings/` directory.
**Evidence**: `vss-web-extension-sdk` npm package ships `typings/vss.d.ts`, `tfs.d.ts`, `rmo.d.ts` directly (external finding §3).
**Prevalence**: Single instance in this research, but methodologically generalizable — worth calling out because the research plan's own risk framing ("does typing the SDK require writing custom `.d.ts` ambient declarations?") assumed the harder path by default.
**Quality assessment**: High-quality resolution — directly fetched primary sources (GitHub README, npm registry), not inferred.

### Pattern: Deprecated-but-still-typed vs. actively-maintained-but-incompatible
**Description**: The project faces a fork between two SDKs where the *old* one (`vss-web-extension-sdk`) is archived/deprecated at the project level but has adequate, stable, already-present types; the *new* one (`azure-devops-extension-sdk`) is actively maintained but is a structurally different, non-drop-in migration.
**Evidence**: Old SDK archived Jan 27, 2023, last code release 2018, npm carries a deprecation notice pointing at the new SDK — yet its types are complete and version-compatible (external §3). New SDK is actively versioned but requires reworking `VSS.init()`/`VSS.require()` bootstrap and REST client naming (external §3, Phong Cao porting article).
**Prevalence**: Central to scoping this migration; recurs in both the codebase gatherer's dead-import/globals findings (this project's *actual* usage of the SDK is narrow) and the external gatherer's SDK-comparison section.
**Quality assessment**: High confidence on the "don't adopt the new SDK now" conclusion; the underlying deprecation-vs-typed tension is a legitimate open strategic question for a *future*, separately-scoped migration (flagged as a recommendation in the report, not executed here).

### Pattern: Compiler-as-safety-net in place of tests
**Description**: Every source touching the no-test-suite risk converges on the same idea — TypeScript's own type-checker, invoked early (JSDoc/`checkJs`) and strictly, functions as partial regression protection that a pure-JS codebase never had.
**Evidence**: TS handbook's own framing ("similar to spell-check," progressive strictness); codebase gatherer's concrete discovery that two implicit-global bugs and one sync-return-of-async-value bug will surface as compile errors immediately upon typing, independent of any test.
**Prevalence**: Cross-cutting theme across all three findings files.
**Quality assessment**: High confidence for the "compiler catches real, demonstrated bugs" half (codebase gatherer found actual bugs, not hypothetical ones); medium confidence for the broader "this substitutes adequately for tests" framing, which is external literature's opinion, not something this project can empirically verify pre-migration.

## Key Insights

1. **The migration will fix bugs it wasn't asked to fix.** The codebase gatherer's discovery of two implicit-global leaks (`app.js:459`, `app.js:526`) and one dead function with a synchronous-return-of-a-still-pending-promise bug (`getWorkItemFormService`, `app.js:572-576`) means a `strict`-mode TS pass is not purely mechanical translation — it will force explicit decisions on pre-existing defects. **Implication**: the migration plan (a downstream artifact, out of this report's scope to write) should budget for "fix or explicitly suppress" decisions on these specific lines, not assume type-only translation. **Confidence: High** — directly observed in code, not inferred.

2. **"Incremental vs. big-bang" is a false binary for this specific codebase; the real axis is "when does the safety net go up."** Because there is exactly one file, the file-count axis that usually defines incremental migration doesn't exist here. The meaningful choice is *whether type-checking happens before or after the syntactic `.ts` rename* — i.e., JSDoc+`checkJs` bootstrap (checking happens first, in `.js`) vs. rename-then-fix (checking happens after, in `.ts`, potentially with the file red for a while). **Implication**: the report's strategy section should reframe the question this way rather than force-fitting "incremental" or "big-bang" labels. **Confidence: Medium-High** — this is synthesis-level reasoning built on solid component evidence (single-file structure from codebase gatherer, leaf-first literature assumption from external gatherer) but is itself an adapted conclusion, not a verbatim source claim.

3. **The build-integration answer required zero new information beyond what the config gatherer already had.** `grunt-exec` was already a dependency for an unrelated purpose (`tfx-cli` invocation); the external gatherer's independent confirmation that `grunt-ts` is dead only reinforces a conclusion the config gatherer could already reach from the existing task graph alone. **Implication**: this is the lowest-risk, highest-confidence piece of the whole recommendation — worth stating plainly and not hedging in the report. **Confidence: High**.

4. **The no-test-suite risk is the one area where "best approach" cannot be a specific tool/package recommendation — it's a process commitment.** Every other success criterion (tooling, VSS typing, Q typing) resolved to a specific artifact (a package, a compiler flag, a `.d.ts` source). The no-test-suite risk resolves to *behavior* (commit size discipline, manual verification checklist, side-by-side `.vsix` comparison), which is inherently harder to verify as "done" and depends on the maintainer's discipline rather than a one-time setup decision. **Implication**: the report should present this section differently from the others — as a checklist/discipline, not a tool selection. **Confidence: Medium** (the recommendation pattern itself is medium-confidence per the source-quality table above, but the *meta-observation* that it's process-not-tooling is high confidence given the contrast with the other three criteria).

## Relationships and Dependencies

- **Build tooling choice → migration strategy viability.** The `tsc`-via-`grunt-exec` decision (config + external) is a *precondition* for either migration strategy being executable at all — without a compile step wired into `package-dev`/`package-release`, no `.ts` file could ever ship as a working `.vsix`, regardless of incremental vs. big-bang choice. This is why the report should present tooling before strategy, even though the research plan lists strategy as success criterion #2 and tooling as #1 — the existing ordering is actually correct dependency-wise.
- **VSS SDK typing availability → scope boundary of "no external migration needed."** Because the SDK's own bundled types cover the actually-used surface (per codebase gatherer's §6 surface inventory cross-referenced against external gatherer's §3 typings-file contents), the project does not need to touch the `azure-devops-extension-sdk` question at all for *this* migration. This dependency is what lets the report confidently exclude the newer SDK from scope rather than hedge.
- **Dead imports/dead code → reduced typing surface.** The three unused AMD deps (`Controls`, `StatusIndicator`, `Dialogs`) and one dead function (`getWorkItemFormService`) mean the *actual* typing effort is smaller than "type everything imported" would suggest — codebase gatherer's zero-usage grep confirms this, directly shrinking what needs type coverage during the port.
- **No-test-suite risk → strategy sequencing.** The absence of tests is why the JSDoc-bootstrap-before-rename sequencing matters: it's the only way to get compiler feedback (a partial safety net) before committing to the higher-risk single-shot rename step.

## Gaps and Uncertainties

- **Understandlegacycode.com no-test-refactoring content**: search-summary only, direct fetch failed mid-session (external gatherer's own note). The characterization/golden-master framing is directionally trustworthy (consistent across multiple independent search hits, and matches well-known general software engineering practice — e.g., Feathers' "Working Effectively with Legacy Code" characterization-test concept, which the search summaries clearly echo) but should not be quoted as verbatim source text in the report.
- **Q→native-Promise recommendation**: also search-summary only. Presented in the report as an optional, clearly-labeled-as-lower-confidence follow-up suggestion, not a required step.
- **`azure-devops-extension-sdk` v5.0.0 exact publish date**: registry returned an internally implausible forward date (June 11, 2026) relative to this research's own dated context. Since this package is out of scope for the current migration recommendation, this gap is low-severity — it's mentioned in the report only insofar as it supports "the new SDK is actively maintained" (a conclusion that holds regardless of the exact date's accuracy, since the package is non-archived and versioned well past its initial release either way).
- **Bundled Q version inside `VSS.SDK.min.js`**: not extractable without unminifying vendored code, which both the sources.md manifest and the config gatherer explicitly scoped out. Low severity — `@types/q` describes the API contract Q exposes, and `app.js`'s actual usage (`.then()`, `Q.all()`, `Q.when()`) is well within Q's long-stable public API, so a version mismatch inside the bundle is unlikely to invalidate the typing approach.
- **No source verified whether other contribution entry points beyond `toolbar.html` exist** (codebase gatherer's own flagged limitation) — `vss-extension.json`'s single contribution (`create-linked-tasks-button`, confirmed by config gatherer) makes this unlikely to matter, since config gatherer's manifest read shows only one contribution defined, but it's worth a one-line caveat rather than silent assumption.

## Synthesis by Framework (Mixed: Technical + Literature)

**Technical (codebase) framework**:
- *What exists*: 1 AMD module, 24 internal functions + 1 public method, 1 module-level mutable variable, narrow SDK surface (2 REST clients/7 methods), Q used via 3 API shapes (single-callback `.then`, two-callback `.then(ok,err)`, `Q.all`/`Q.when`).
- *How it's structured*: flat function-soup inside one `define()` factory — no sub-modules, no class boundaries, no existing type annotations (not even JSDoc).
- *How it works*: nested-callback-pyramid async flow (not flat-chained), fire-and-forget from the caller (`create()` never awaits `AddTasks()`), zero error handling on the primary flow.
- *How it integrates*: two integration boundaries needing types — the AMD-declared `TFS/*`/`VSS/*`/`q` modules (covered by bundled SDK typings + `@types/q`) and the non-AMD global `VSS` (needs one hand-written `declare const VSS: {...}` ambient block, minimal surface: `getWebContext()`, `init()`, `require()`, `register()`).

**Literature framework**:
- *Current state*: no TS tooling, no JSDoc, no lint — a genuine blank slate, which simplifies the decision (no legacy TS config to reconcile).
- *Best practices comparison*: official TS handbook favors `allowJs`+`checkJs` bootstrap → incremental rename → progressive strictness; grunt-specific literature favors `grunt-exec`+`tsc` over `grunt-ts`; general 2024-2026 industry sources favor incremental-by-default but explicitly carve out big-bang as reasonable for small/unmaintainable/short-timeline cases.
- *Trade-off analysis*: incremental (safer, slower, but "incremental" has no natural unit here) vs. pure big-bang rename (faster, but removes the compiler as a safety net during the highest-risk step) vs. the adopted hybrid (JSDoc bootstrap first, then single-shot rename — front-loads safety without needing file-count granularity).
- *Applicability assessment*: fits — solo maintainer, no CI, low-overhead constraint all favor the lightest-process option that still gets compiler feedback before the point of no return.

## Conclusions

**Primary conclusions**:
1. Use `tsc` (added as a `typescript` devDependency) invoked via a new `grunt-exec` target, inserted ahead of `exec:package_dev`/`exec:package_release` in `gruntfile.js`, compiling to AMD output landing at the unchanged `scripts/app.js` path. **Confidence: High.**
2. For the single 617-line `app.js`, use a JSDoc + `allowJs`/`checkJs` bootstrap phase to get compiler-checked feedback while still in `.js`, fix what surfaces, then do a single-shot rename to `app.ts` — not a classic multi-file incremental rollout (there's nothing to incrementalize across) and not an unprotected pure big-bang rename either. **Confidence: Medium-High** (sound adapted reasoning; not a source's verbatim recommendation).
3. Type the VSS SDK surface via the SDK package's own bundled `typings/tfs.d.ts`/`vss.d.ts` (no DefinitelyTyped, no hand-rolled `.d.ts` needed for the AMD-declared modules); add one small hand-written `declare const VSS: {...}` ambient block for the non-AMD global. Type `Q` via `@types/q` (current, TS 4.5+ compatible). **Confidence: High.**
4. The no-test-suite risk cannot be tooled away; mitigate via small reversible commits, treating the compiler as one verification source among several, and manual side-by-side `.vsix` behavior comparison against a checklist derived from the function inventory. **Confidence: Medium** (pattern well-supported directionally, sourcing quality medium per gaps above).

**Secondary conclusions**:
- Three dead AMD imports and one dead function are candidates to delete during the port rather than type — reduces both migration effort and long-term maintenance surface.
- Do not adopt `azure-devops-extension-sdk` as part of this migration; it is a distinct, larger, separately-scoped migration.
- The `package.json`/`vss-extension.json` version mismatch (`0.10.1` vs `1.1.17`) and the `^1.104.0` vs. resolved `1.110.0` SDK version discrepancy are both pre-existing, low-severity, and orthogonal to the TS migration — worth fixing opportunistically but not blockers.

**Recommendations**: see `outputs/research-report.md` §Recommendations for the full prioritized list.
