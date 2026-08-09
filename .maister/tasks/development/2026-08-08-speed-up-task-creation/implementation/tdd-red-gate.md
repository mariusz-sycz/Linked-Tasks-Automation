# TDD Red Gate

## TL;DR
No automated test framework exists in this project (confirmed independently by Phase 1 codebase analysis and the completed TypeScript-migration task). The popup-close data-loss defect is real and manually reproducible, but cannot be captured as an automated failing test. Per the same pattern used in the prior TypeScript-migration task in this repo, the TDD Red/Green gate is adapted into a documented manual-reproduction record; automated coverage remains tracked separately under `roadmap.md` Phase 2.

## Key Decisions
- Skip the automated failing-test requirement; substitute a documented manual reproduction procedure (below) as the Red-gate artifact.
- The manual reproduction procedure becomes the basis for the Green-gate check in Phase 9 (re-run the same manual steps post-implementation and confirm the improved, accepted-partial behavior from ADR-002/clarification Q2).

## Open Questions / Risks
- No automated regression protection exists or will exist after this task — every future change to this area carries the same manual-verification burden. Already tracked as project-level technical debt in `roadmap.md`.

---

## Why the automated Red/Green gate is adapted

Phase 1 codebase analysis (`analysis/codebase-analysis.md`) and Phase 2 gap analysis (`analysis/gap-analysis.md`, Defect Analysis section) both confirm: zero test files, zero test framework/script in `package.json`, and `high-level-design.md` (line 235) explicitly places automated test coverage for this feature out of scope, deferred to `roadmap.md` Phase 2. The same constraint was handled identically in the prior, separately-tracked TypeScript-migration task (`.maister/tasks/development/2026-08-07-typescript-migration`), which also skipped the TDD gate and substituted a manual `.vsix` verification checklist.

## Defect: popup-close data loss (manual reproduction record)

**Steps** (from gap-analysis.md's Defect Analysis section):
1. Open a parent work item with 2+ matching child templates, where at least one template alphabetically after another has a `linkTo` rule referencing a `justCreatedTasks`-derived helper (e.g. `PreviouslyCreatedTask`).
2. Click "Create linked tasks."
3. Close the work-item popup/dialog shortly after — before the first template's create response has been read.

**Inputs**: Parent work item ID; ≥2 matching templates sorted alphabetically with an ordering dependency between them (per `SortTemplates`, `app.ts:501-508`).

**Expected** (desired end state, per the accepted partial fix from ADR-002 / clarification Q2): requests already dispatched via `fetch(keepalive:true)` before the popup closes complete server-side regardless of popup state. Requests not yet dispatched at the moment of teardown (an ordered-group create still waiting on a prior template's response, or any not-yet-dispatched link-to-parent/`ToAllOtherChilds` link call) remain exposed — a narrower, explicitly accepted failure window, not a 100% guarantee.

**Actual today (pre-implementation, "Red" state)**: the toolbar iframe tears down on popup close, aborting every in-flight `witClient`-wrapped REST call immediately regardless of dispatch state — any template create not yet responded to, and any template waiting in the sequential chain, is silently never created. No error, no partial-success indication.

**This is the documented "Red" baseline.** Phase 9 (TDD Green Gate) will re-walk these same manual steps against the implemented `fetch(keepalive:true)` behavior and confirm the narrower, accepted-partial "Green" outcome described above — not a full guarantee, per the already-resolved scope decision.
