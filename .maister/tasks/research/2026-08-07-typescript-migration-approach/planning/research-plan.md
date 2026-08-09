# Research Plan: TypeScript Migration Approach

## TL;DR
Mixed-methodology research: analyze the existing codebase (app.js, gruntfile.js, package.json, vss-extension.json) to characterize the migration surface, then cross-reference against external best-practice sources for JS→TS migration, Grunt+TS integration, VSS SDK typings, and Q promise typing. 3 parallel gatherers cover codebase, configuration/build, and external/literature — no separate documentation gatherer needed since the 3 relevant project docs (vision, roadmap, tech-stack) are small and already read during planning. Synthesis will map best-practice options against this project's specific constraints (solo maintainer, no tests, single 618-line module, must stay marketplace-publishable throughout).

## Key Decisions
- **3 gatherer instances, not the default 4** — configuration and codebase sources overlap heavily in a project this small (the build config *is* the migration target), so they're merged into one `codebase-and-build` gatherer rather than split, freeing capacity for a dedicated `external-literature` gatherer given this is a mixed research type with a literature-heavy question.
- **No dedicated documentation gatherer** — the only project docs (vision.md, roadmap.md, tech-stack.md) are short and already fully read during this planning phase; re-gathering them would be redundant. Their key facts are captured directly in `sources.md` and this plan instead.
- **External research prioritizes VSS SDK typing precedent over generic TS-migration guides** — the riskiest/most novel unknown is whether usable type definitions exist for `vss-web-extension-sdk` (DefinitelyTyped, `azure-devops-extension-api`, or community packages), since generic incremental-migration advice (`allowJs`/`checkJs`, `strict: false` bootstrap) is well-trodden and lower-risk to under-research.

## Open Questions / Risks
- Unknown before gathering: does `@types/vss-web-extension-sdk` or equivalent exist on DefinitelyTyped/npm, or does Microsoft's newer `azure-devops-extension-sdk` (a different, non-drop-in package) offer better-typed alternatives that would themselves constitute a bigger migration than scoped here? Gatherers must flag if typing the SDK requires writing custom `.d.ts` ambient declarations.
- Q promise library has aged `@types/q` definitions (last relevant when Q was actively maintained ~2016-2018) — need to verify compatibility with modern TypeScript versions rather than assume.
- Single-module (app.js, 617 lines) scope means "incremental vs. big-bang" may resolve differently than typical incremental-migration literature (which usually addresses multi-file/multi-package codebases) — synthesis must adapt general guidance to a single-file context rather than apply it uncritically.

---

## 1. Research Overview

**Research Question**: What is the best approach for migrating the Linked-Tasks-Automation Azure DevOps extension (AMD/RequireJS, Grunt build, VSS SDK, Q promises, no tests) to TypeScript — including tooling choices, incremental vs. big-bang migration strategy, and type definitions for the VSS SDK?

**Research Type**: Mixed (technical codebase analysis + literature/best-practices research)

**Scope**:
- Included: TS tooling + Grunt build integration; incremental vs. big-bang strategy for the ~617-line `src/scripts/app.js`; typing strategy for `vss-web-extension-sdk` and `Q`; industry best practices for small/medium JS→TS migrations with no test suite.
- Excluded: actual migration implementation; new feature work (Phase 2); test framework selection (though test-suite absence as a migration *risk factor* is in scope per success criteria).
- Constraints: must remain buildable/publishable as a Marketplace `.vsix` throughout; solo maintainer favors low-overhead tooling; no automated tests to catch regressions.

## 2. Methodology

**Primary approach**: Parallel multi-source gathering (codebase/build analysis + external literature) feeding a single synthesis pass that maps findings onto this project's specific constraints.

**Fallback strategy**: If DefinitelyTyped/community VSS SDK types prove unavailable or stale, the external gatherer should surface the "hand-roll minimal `.d.ts` for the actually-used SDK surface" fallback pattern (a common approach for niche/abandoned SDKs) as a documented alternative.

**Analysis framework** (mixed):
- *Technical (codebase) analysis*: component identification (what modules/functions exist in app.js), pattern recognition (AMD `define()` structure, Q `.then()` chaining depth, global mutable state like `ctx`), integration mapping (VSS SDK surface actually used: `TFS/WorkItemTracking/Services`, `TFS/WorkItemTracking/RestClient`, `TFS/Work/RestClient`, `VSS/Controls*`).
- *Literature analysis*: pattern comparison (how the TS community handles AMD-loaded, build-tool-driven, no-test legacy migrations), trade-off analysis (incremental `allowJs`/`checkJs` vs. rewrite-in-place vs. strangler/parallel-file approaches), applicability assessment (which patterns fit a single-file, solo-maintainer, Grunt-based project vs. which assume npm/webpack/monorepo scale).

## 3. Data Sources

See `planning/sources.md` for the full manifest. Summary by type:

- **Codebase sources**: `src/scripts/app.js` (617 lines — core migration target), `src/gruntfile.js` (build pipeline to integrate TS compilation into), `src/toolbar.html` (script loading / RequireJS entry point).
- **Configuration sources**: `src/package.json` / `src/package-lock.json` (current deps: grunt, grunt-cli, grunt-contrib-clean, grunt-contrib-copy, grunt-exec, requirejs, tfx-cli, vss-web-extension-sdk — note: no `typescript` dep yet), `src/vss-extension.json` (Marketplace manifest — file/addressable entries that must keep resolving post-migration), `src/configs/dev.json` / `src/configs/release.json` (env overrides).
- **Project documentation sources** (already read in planning, referenced not re-gathered): `.maister/docs/project/vision.md`, `.maister/docs/project/roadmap.md`, `.maister/docs/project/tech-stack.md`, `.maister/docs/standards/build-tooling/packaging.md` (Grunt task/packaging conventions the TS build step must respect).
- **External/literature sources**: TypeScript's official JS-to-TS migration guidance (`allowJs`, `checkJs`, `// @ts-check`, incremental `strict` adoption); DefinitelyTyped/npm search for `vss-web-extension-sdk` or `azure-devops-extension-sdk` types; `@types/q` package status; Grunt+TypeScript integration patterns (`grunt-ts`, `ttypescript`, or plain `tsc` as a pre-step via `grunt-exec`, given `grunt-ts` is unmaintained); general literature on migrating untested legacy JS to TS safely (JSDoc-first bootstrapping, `// @ts-nocheck` per-file opt-out, snapshot/manual-QA safety nets in lieu of automated tests).

## 4. Research Phases

**Phase 1 — Broad discovery**:
- Confirm full contents and structure of `app.js` (function inventory, AMD dependency list, module boundaries).
- Confirm full `gruntfile.js` task graph and where a compile step would need to slot in (before `exec:package_dev`/`exec:package_release`).
- Web-search for current (2024-2026-era) JS→TS migration guides and Grunt+TS integration options, since tooling recommendations from 5+ years ago (e.g. `grunt-ts`) may be stale/unmaintained.

**Phase 2 — Targeted reading**:
- Read `app.js` in full to catalogue: global state (`ctx`), function signatures, Q promise chain shapes, VSS SDK calls, implicit data shapes (templates, work items, filter rules) that will need explicit types.
- Read `package.json`/`package-lock.json` to confirm exact installed versions (`vss-web-extension-sdk` `^1.104.0`, no `q` version pinned directly — check if `q` is a transitive or implicit global via the SDK) and cross-check against candidate `@types/*` package version compatibility.
- Fetch/read npm and DefinitelyTyped listings for VSS SDK and Q typings.

**Phase 3 — Deep dive**:
- Compare incremental-migration approaches (`allowJs`+`checkJs` bootstrap, file-by-file rename with `.ts` extension, parallel-implementation strangler) specifically against a *single 617-line file* context — most literature assumes multi-file codebases, so this phase adapts rather than transplants advice.
- Investigate whether renaming `app.js` → `app.ts` in one shot (given it's already one file) makes "big-bang" more viable here than typical multi-file guidance would suggest, weighed against the no-test-suite risk.
- Investigate VSS SDK typing options in depth: exact DefinitelyTyped package name/existence, freshness (last publish date), coverage of the specific modules used (`TFS/WorkItemTracking/Services`, `RestClient`, `VSS/Controls`, `Dialogs`, `StatusIndicator`), and the hand-rolled ambient `.d.ts` fallback pattern if no adequate package exists.
- Investigate `Q` typing: `@types/q` availability/freshness vs. the option of migrating `.then()` chains to native Promises (out of scope to *implement*, but worth surfacing as an option the recommendation should address given it affects typing complexity).

**Phase 4 — Verification**:
- Cross-reference tooling recommendations against the "solo maintainer, low-overhead" constraint — discard any option requiring heavyweight infra (e.g. full webpack/rollup bundler introduction) unless literature strongly favors it over `tsc`-only compilation.
- Validate that any proposed build integration preserves the existing `grunt package-dev`/`package-release`/`publish-dev`/`publish-release` task names and `--rev-version`/override-file conventions documented in `standards/build-tooling/packaging.md`.
- Sanity-check that recommended incremental steps keep the extension buildable/publishable at every intermediate step (the stated constraint), not just at the end state.

## 5. Gathering Strategy

### Instances: 3 (max 8)

| # | Category ID | Focus Area | Tools | Output Prefix |
|---|------------|------------|-------|---------------|
| 1 | codebase | `app.js` structure, function/data-shape inventory, AMD/Q usage patterns | Glob, Grep, Read | codebase |
| 2 | configuration | Grunt build pipeline, package.json/lock deps, vss-extension.json manifest, dev/release configs — what must keep working through migration | Read, Grep | config |
| 3 | external-literature | JS-to-TS migration best practices, Grunt+TS integration options, VSS SDK type definition availability, Q typing status | WebSearch, WebFetch | external |

### Rationale
The codebase here is unusually small (one core module, one build file, one manifest), so the standard 4-way split (codebase/documentation/configuration/external) would over-fragment effort: a "documentation" gatherer would have almost nothing new to gather beyond what's already captured in this plan from the three short project docs read during planning. Merging codebase+configuration into two focused-but-related instances (source code vs. build/manifest config) while giving external literature its own full instance better matches this mixed research type, where the literature side (migration strategy patterns, SDK typing precedent) carries as much weight as the code-reading side. 3 instances is sufficient given the narrow, well-bounded scope; going higher would risk redundant/overlapping findings on a codebase this size.

## 6. Success Criteria
- Recommended TypeScript tooling and Grunt build integration approach identified, with rationale tied to the solo-maintainer/low-overhead constraint.
- Recommended migration strategy (incremental vs. big-bang) determined specifically for the single ~617-line `app.js` module, with rationale that accounts for the no-test-suite risk.
- Recommended approach for typing the VSS SDK (existing package vs. hand-rolled `.d.ts`) and Q (typed via `@types/q` vs. Promise-conversion consideration) documented with evidence of what's actually available/current.
- Key risks specific to migrating without an existing test suite identified, each with at least one concrete mitigation (e.g., manual QA checklist, `.vsix` side-by-side comparison, JSDoc-first bootstrap before full `.ts` conversion).
- All claims traceable to a cited source (codebase file+line, or external URL/doc).

## 7. Expected Outputs
- Research report (via research-synthesizer) with a clear recommendation covering all 4 success-criteria points.
- Evidence-backed comparison table of migration-strategy options (incremental vs. big-bang) applicable to this project's scale.
- Summary of VSS SDK and Q typing options with freshness/viability assessment.
- Risk/mitigation list for no-test-suite migration.
- No new specifications or implementation artifacts (explicitly excluded from scope).
