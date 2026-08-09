# Phase 5 Requirements

## TL;DR
No new entry point or discovery UI — the existing toolbar/context-menu action stays the sole trigger. No external code pattern to reuse; the 5 new components are built fresh per the research design within this repo's own conventions. Versioning stays out of this task's scope (separate release step). Combined with Phase 1-3 clarifications: extraction happens incrementally (smoke-test AMD cross-file imports early), and native Promise/async-await is used for all new/touched code (Q stays only in untouched pure helpers).

## Key Decisions
- No new entry point/discovery UI — reachability/trigger unchanged (User Journey Impact already confirmed in gap-analysis.md).
- Build the 5 new components fresh, no external precedent to pattern-match — codebase analysis confirmed zero existing usage of fetch/localStorage/getAccessToken/openMessageDialog anywhere in the repo.
- Leave package.json/vss-extension.json version bumps to a separate release step, out of this task's scope.
- Modularization extraction is incremental: extract low-risk/zero-dependency files first (types.ts, context.ts, logging.ts, templateFilters.ts) to smoke-test the never-before-exercised AMD cross-file import pattern in this repo, before extracting the rest.
- Native Promise/async-await for all new/touched code (the 5 behavioral changes and the restructured orchestration); Q remains only in relocated-but-otherwise-untouched pure helper functions.

## Open Questions / Risks
None outstanding from this round — all Phase 5 technical and requirements questions resolved with recommended defaults.

---

## Initial Description
See task.description in orchestrator-state.yml — full 5-change speed-up/reliability design plus user-added full-file modularization scope.

## Technical Clarifications (Part A)

**Q1 — Extraction style for modularize-first pass?**
A: Incremental, smoke-test early. Extract lowest-risk/zero-dependency files first (`logging.ts`, `types.ts`, `context.ts`) to prove the AMD cross-file import pattern works in this repo (never exercised before — single-file codebase until now) before committing to the full ~13-file split.

**Q2 — Promise style for the 5 behavioral changes?**
A: Native `Promise`/`async`/`await` for all new/touched code. `target: ES2015` already supports this with zero config changes (confirmed by codebase analysis). Existing `Q`-based logic in relocated-but-untouched pure helpers stays as-is — no unscoped conversion sweep.

## Requirements Q&A (Part B)

**Q1 — User journey / entry point?**
A: Confirmed — no new entry point or discovery UI. Existing toolbar/context-menu action (`create-linked-tasks-button-test`, `ms.vss-web.action`) stays the sole trigger.

**Q2 — Existing code reuse?**
A: No external precedent. Build the 5 new components (Template Cache, Keepalive Fetch Client, Auth Token Provider, Progress Dialog Controller, Template Classifier) fresh, following this repo's own established conventions (naming, logging prefix, inline documentation of intentional design choices) rather than pattern-matching an external source.

**Q3 — Visual assets?**
A: Not applicable — `ui_heavy` is false (confirmed by gap analysis). The two `openMessageDialog` calls are native SDK modal dialogs invoked with a plain message string; no mockups/wireframes exist or are needed.

**Q4 — Versioning?**
A: Out of scope for this task. `package.json`/`vss-extension.json` version bumps happen at a separate release/publish step; dev builds already auto-increment via `grunt`'s `--rev-version`.

## Similar Features Identified
None — genuinely greenfield within this codebase (confirmed by both codebase analysis and gap analysis).

## Functional Requirements Summary
See `analysis/gap-analysis.md` ("Gaps Identified" section) for the full breakdown of net-new components, restructured logic, and behavioral changes. Requirements gathered here add no new functional scope beyond what gap analysis already specified — this round confirmed process/style decisions (extraction order, promise style) and ruled out additional scope (no new entry point, no external reuse, no versioning).

## Reusability Opportunities
None applicable — see "Similar Features Identified" above.

## Scope Boundaries
- IN SCOPE: the 5 speed-up/reliability changes (caching, keepalive fetch, progress dialogs, parallelized reads, bounded parallel/sequential template creates) AND the full modularization of `app.ts` into ~13 files, sequenced modularize-first.
- OUT OF SCOPE: full guarantee of popup-close survival (Hub/Hybrid architecture, ADR-001 rejected), automated tests (no framework exists, tracked separately in roadmap.md Phase 2), version bumps, normalizing the `ctx`-vs-`VSS.getWebContext()` inconsistency, fixing the pre-existing `GetChildTypes` `bugsBehavior` bug, event-driven cache invalidation.

## Technical Considerations
- AMD/RequireJS cross-file relative imports under `module: "amd"` have never been exercised in this repo — first extraction pass doubles as the validation for this pattern.
- Exact REST endpoint/`api-version` for the `fetch(keepalive:true)` replacement must be captured live via devtools network inspection (user confirmed live ADO org access) before or during implementation of the Keepalive Fetch Client.
- No automated tests exist or are added — verification is manual, via `grunt serve` against a live Azure DevOps org, consistent with how the prior TypeScript-migration task in this repo was verified.
