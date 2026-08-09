# Phase 1 Clarifications

## TL;DR
User has live Azure DevOps org access for endpoint capture and manual verification; the partial (non-100%-guaranteed) popup-close fix from the research design is acceptable to ship; progress dialogs are per-work-item (not aggregated across a multi-select); the completion dialog will surface partial-failure summaries to the user instead of staying console-only.

## Key Decisions
- Live ADO org access confirmed — REST endpoint/api-version for the fetch(keepalive:true) replacement will be captured via live devtools network inspection at implementation time, not guessed.
- Ship the partial popup-close fix as designed (ADR-002) — the Hub/Hybrid full-guarantee architecture remains a deferred future escalation, not built now.
- Multi-ID selections get one start/completion dialog pair per work item, matching the existing per-ID `AddTasks(workItemId)` independence.
- The completion dialog will report a partial-failure summary ("N of M tasks created", listing failures) rather than staying console-only — a new, in-scope user-facing surface.

## Open Questions / Risks
None outstanding from this round — all four questions were resolved with the recommended option.

---

## Q&A

**Q1: Live Azure DevOps org access for endpoint capture and manual verification?**
A: Yes — user has access. Implementation can capture the exact `createWorkItem`/`updateWorkItem` REST request shape via devtools and manually verify keepalive/caching/dialog behavior live, rather than falling back to best-effort public API conventions.

**Q2: Is the partial (non-100%-guaranteed) popup-close survival fix acceptable to ship, given it's the reported bug?**
A: Yes, ship it. The `fetch(keepalive:true)` approach (ADR-002) covers the common case; templates in the ordering-dependent group not yet dispatched, and any not-yet-dispatched link-to-parent call, remain exposed to popup close — an accepted, documented limitation. The full-guarantee Hub/Hybrid architecture (solution-exploration.md's top recommendation, rejected in ADR-001) stays a future escalation path if this proves insufficient in practice.

**Q3: How should the two progress dialogs behave for a multi-work-item selection?**
A: One start/completion dialog pair per work item — each `AddTasks(workItemId)` call gets its own pair, consistent with how the per-ID loop already runs independently and uncoordinated today.

**Q4: Should per-template/per-link failures be surfaced to the user, or stay console-only?**
A: Surface them. The completion dialog will show a partial-failure summary ("N of M tasks created" plus which failed), matching the design's success criteria and giving users visibility they don't have today (currently silent, console-only).

## Mid-Phase Scope Addition: Split `app.ts` into Modules

User raised, unprompted, that the current single-file `src/scripts/app.ts` (629 lines, growing with this task's 5 new components) is no longer a viable structure. Follow-up question confirmed:

**Chosen scope: Split the ENTIRE `app.ts` into a proper multi-file module structure** — not just the new/touched pieces. This includes currently-untouched functions (`GetChildTypes`, `createWorkItemFromTemplate`, filter/matching helpers, `SortTemplates`, etc.), not only the 5 new/changed components from the research design.

**Context for downstream phases**:
- The prior, separately-tracked TypeScript migration task (`.maister/tasks/development/2026-08-07-typescript-migration`, status: completed) ported `app.js` → `app.ts` but explicitly kept it as a single monolithic file — modularization was never in that task's scope.
- `tsconfig.json`'s `include: ["scripts/**/*.ts"]` is already glob-based, so adding more `.ts` files under `src/scripts/` requires no config change.
- `toolbar.html` calls `VSS.require(["scripts/app"], cb)` — the AMD entry-point module id `scripts/app` must continue to resolve and export `create(context)`; internal module boundaries are free to be introduced via ES `import`/`export` (TypeScript compiles each file to its own AMD module under `module: "amd"`, and RequireJS — already the extension's runtime loader — resolves inter-module `require`/`define` dependencies transparently).
- This significantly expands Phase 2 (gap analysis), Phase 5 (spec — needs a module boundary/file-structure section), and Phase 7 (implementation plan — needs task groups for the extraction) beyond the research's original single-file-edit assumption. Gap analysis should treat this as a first-class scope item, not a footnote.

