# Phase 2 Scope Clarifications

## TL;DR
All 6 decisions flagged by gap analysis were resolved with the recommended option: modularize `app.ts` into ~13 files FIRST as a pure, independently-verified, behavior-preserving refactor, then implement the 5 speed-up/reliability changes into that new structure. Shared `ctx` state stays as simple exported module state (no signature-changing refactor). Files stay flat under `src/scripts/`, shared types get their own `types.ts`, the pre-existing `ctx`-vs-`VSS.getWebContext()` inconsistency is preserved as-is (not normalized), and the ~13-file granularity from the research design's Key Components table is kept as proposed.

## Key Decisions
- Modularize first, then add behavior — separates refactor risk from behavioral risk into two independently-verifiable passes, the only real bisection lever available with zero test coverage.
- Shared `ctx: WebContext` becomes `export let ctx` in a new `context.ts`, imported directly by `orchestrator.ts`/`templateBuilder.ts`/`templates.ts` — minimal diff, no signature changes to functions the research called "untouched."
- Flat file layout under `src/scripts/` (no subfolder) — 13 files doesn't yet justify the extra structure.
- Shared types (`WitClient`, `WorkClient`, `WorkItemFields`) extracted into `types.ts`.
- `GetChildTypes`/`createWorkItem`'s direct `VSS.getWebContext()` calls (instead of reusing `ctx`) are preserved exactly as-is — normalization is out of scope, a drive-by fix would conflate unrelated behavior changes with a refactor that's supposed to be behavior-preserving.
- ~13-file module granularity (per `high-level-design.md`'s Key Components table) kept as proposed, not coarsened.

## Open Questions / Risks
None outstanding — all 6 decisions resolved with the recommended option, no dissent from defaults.

---

## Q&A

**Critical 1 — Sequencing: modularize vs. 5 behavioral changes, which first?**
A: Modularize first. Pure behavior-preserving refactor across all ~13 files, manually verified against today's behavior, THEN the 5 behavioral changes land in the new structure.

**Critical 2 — Shared `ctx: WebContext` handling across new file boundaries?**
A: Keep as shared exported state in `context.ts` (`export let ctx: WebContext`, set once by `create()`). No parameter-threading refactor of functions the research called untouched.

**Important 1 — File naming/foldering?**
A: Flat under `src/scripts/`, camelCase filenames.

**Important 2 — Extract shared types?**
A: Yes, into `types.ts`.

**Important 3 — Preserve or normalize the `ctx`-vs-`VSS.getWebContext()` inconsistency?**
A: Preserve exactly as-is; normalization is separate, explicitly out-of-scope follow-up work.

**Important 4 — Module split granularity?**
A: ~13-file breakdown as proposed, mirroring the research design's Key Components table.
