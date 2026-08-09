# Specification Audit: Speed Up Task Creation, Progress Feedback, Popup-Close Reliability, Modularize app.ts

## TL;DR
**Verdict: Mostly Compliant (pass-with-concerns).** The spec faithfully reflects every resolved decision from clarifications.md/scope-clarifications.md/requirements.md, and every line-number citation checked against the live `src/scripts/app.ts` (21 function ranges, `toolbar.html:21`, `tsconfig.json`) is accurate. However, Core Requirement 1's module-boundary table — the single artifact the whole "modularize first, verify identical behavior" strategy depends on — has **six missing cross-file dependency edges** that will produce TypeScript compile errors if followed literally, plus an unresolved ambiguity about whether Phase A creates the 5 Phase-B "new code" files as empty skeletons. 0 Critical, 1 High, 1 Medium-High, 1 Medium, 1 Low finding.

## Key Decisions
- Treated the missing `Depends on` edges as High (not Critical): they land in the exact phase/pattern (AMD cross-file imports) the spec itself already calls highest-risk and untested, but they're mechanically fixable by re-deriving the table from an actual call-graph pass — they don't require re-scoping or new decisions.
- Treated the "~13 vs 15 files" and "GetChildTypes ×3" miscounts as Low/Medium rather than blocking: both originate in `gap-analysis.md` (not introduced by the spec) and the authoritative, unambiguous file list/table already fully disambiguates what to build — the wrong headline numbers are a communication risk, not an implementability one.

## Open Questions / Risks
- Does Phase A create the 5 Phase-B "new code" files (`templateCache.ts`, `keepaliveFetchClient.ts`, `authTokenProvider.ts`, `progressDialogController.ts`, `templateClassifier.ts`) as empty/stub skeletons, or are they created fresh when Phase B populates them? Core Requirement 1 and 3 read as "yes, as part of the ~13/15-file split," but Requirement 4's Phase-A-only-relocates-existing-code rule and the spec's own minimal-implementation standard citation ("every new function must have an immediate caller") argue against pre-creating empty files. This should be resolved before implementation planning splits Phase A into task groups.

---

## Scope of This Audit

Read and cross-referenced:
- `implementation/spec.md` (the audited document)
- `src/scripts/app.ts` (629 lines, current source — read in full)
- `src/toolbar.html`, `src/tsconfig.json` (claims about entry point / build config)
- `analysis/codebase-analysis.md`, `analysis/gap-analysis.md`, `analysis/clarifications.md`, `analysis/scope-clarifications.md`, `analysis/requirements.md`
- `implementation/tdd-red-gate.md`
- `.maister/tasks/research/2026-08-08-speed-up-task-creation/outputs/high-level-design.md`, `decision-log.md` (ADR-001 through ADR-005)

No `az`/`gh` CLI verification was applicable — this is a client-only browser extension with no Azure/GitHub-hosted infrastructure to check; verification here is entirely source-code and cross-document.

---

## Findings

### Finding 1 — Module boundary table (Core Requirement 1) has six missing cross-file dependency edges [HIGH]

**Category**: Incorrect (Implementability)

**Spec Reference**: Core Requirement 1's file table, "Depends on" column; also contradicts Core Requirement 3's claim that "`templateFilters`/`templateBuilder`/`childTypes`/`templates`/`templateCache`/`authTokenProvider`/`keepaliveFetchClient`/`templateClassifier`/`progressDialogController` depend only on the base layer" (context/types/logging).

**Evidence** (verified directly against `src/scripts/app.ts`):

1. `templateBuilder.ts`'s `createWorkItemFromTemplate` calls `replaceReferenceToParentField` at `app.ts:246`. `replaceReferenceToParentField` is placed in `templateFilters.ts` by the same table. **`templateBuilder.ts`'s "Depends on" column lists only `context.ts, types.ts` — missing `templateFilters.ts`.**
2. `workItemCreation.ts`'s `createChildFromTemplate` calls `getTemplate(template.id)` at `app.ts:74`. `getTemplate` is placed in `templates.ts`. **`workItemCreation.ts`'s "Depends on" column (`keepaliveFetchClient.ts, templateBuilder.ts, templateFilters.ts, context.ts, logging.ts`) is missing `templates.ts`.**
3. Core Requirement 8 itself states the Template Classifier reuses "the same JSON extracted by `IsValidTemplateWIT`/`createWorkItem` via `extractJSON`" — and `extractJSON`/`IsJsonString` are placed in `templateFilters.ts`. **`templateClassifier.ts`'s "Depends on" column lists only `types.ts` — missing `templateFilters.ts`, contradicting the spec's own Requirement 8 text.**
4. `templateFilters.ts`'s `checkRules`, `IsValidTemplateWIT`, `matchField`, and `replaceReferenceToParentField` all take/return the `WorkItemFields` type alias (defined in `types.ts`, e.g. `app.ts:284, 302, 354, 473`). **`templateFilters.ts`'s "Depends on" column lists only `logging.ts` — missing `types.ts`**, needed just for the type import.
5. `orchestrator.ts`'s `AddTasks` declares `var witClient: WitClient`, `var workClient: WorkClient`, and `var currentWorkItem: WorkItemFields` (`app.ts:25-26, 43`). **`orchestrator.ts`'s "Depends on" column omits `types.ts`.**
6. `childTypes.ts`'s `GetChildTypes(witClient: WitClient, ...)` (`app.ts:541`) takes a `WitClient`-typed parameter. **`childTypes.ts`'s "Depends on" column says "VSS SDK ambient typings only" — omits `types.ts`.**
7. `workItemCreation.ts`'s `createWorkItem`/`createChildFromTemplate`/`linkItems` all use `WorkItemFields` (`app.ts:104, 72, 201`) in addition to the missing `templates.ts` edge from point 2. **`types.ts` is also absent from `workItemCreation.ts`'s "Depends on" column.**

**Gap Description**: Under `tsconfig.json`'s `strict: true` / `module: "amd"` with one file per module, any identifier used in a file must be imported there — there is no ambient sharing across sibling `.ts` files. Six of the ~10 relocated/structural files are missing at least one dependency edge their actual (unmodified) function bodies require. If an implementer follows the table as an exact import checklist during Phase A's incremental extraction — the exact step the spec calls "the single biggest debugging lever available" and explicitly flags as exercising a never-before-used AMD cross-file `import` pattern in this repo — the result will not compile, and the failure will look like a cross-file-import problem (the actual known risk) rather than a table-construction error (the real cause), which will cost debugging time the spec's own phased strategy is designed to avoid.

This also means Core Requirement 3's claim that those nine files "depend only on the base layer" is not fully accurate as written — `templateBuilder.ts` and `templateClassifier.ts` in that list also need `templateFilters.ts`, a same-tier sibling, not the base layer. (This doesn't introduce a cycle — `templateFilters.ts` doesn't depend back on either — so the DAG-acyclic property itself survives, but the stated tier boundaries do not.)

**Severity**: High — compile-blocking if the table is used as a literal implementation checklist, landing in the exact phase and exact untested mechanism (AMD cross-file imports) the spec itself flags as the highest structural risk in this task.

**Recommendation**: Before implementation planning, re-derive Core Requirement 1's "Depends on" column from an actual call-graph pass over each relocated function's body (not just the original design's conceptual Key Components table), and correct Core Requirement 3's tier description accordingly.

---

### Finding 2 — Ambiguous whether Phase A creates the 5 Phase-B "new code" files as empty skeletons [MEDIUM-HIGH]

**Category**: Ambiguous

**Spec Reference**: Core Requirement 1 ("Split `app.ts` into the following files... exactly matching the module boundary below" — table includes `templateCache.ts`, `keepaliveFetchClient.ts`, `authTokenProvider.ts`, `progressDialogController.ts`, `templateClassifier.ts`, all marked "(new code)"); Core Requirement 3 ("the dependency graph among the ~13 files is a DAG... Verify no cycle is introduced during extraction" — explicitly includes the 5 new-code files in "the ~13 files"); vs. Core Requirement 4 ("Each relocated function keeps its existing logic body... Phase A must not... otherwise 'clean up' anything not explicitly listed above") and the Standards Compliance section's minimal-implementation citation ("every new function must have an immediate caller").

**Gap Description**: A competent implementer could reasonably read this two ways:
- **(a)** Phase A creates all ~13-15 files, including empty/stub versions of the 5 Phase-B components, so the "full split is complete" (Success Criteria 8, 9) and "verify no cycle" (Requirement 3) checks are literally true at the end of Phase A — then Phase B fills in their bodies.
- **(b)** Phase A only relocates the 10 files with actual existing content (app, orchestrator, context, types, logging, workItemCreation, templateBuilder, templateFilters, childTypes, templates); the 5 new-code files are created for the first time in Phase B, when they have real callers — consistent with minimal-implementation ("no speculative... when [it]'s the only backend this design needs... every new function must have an immediate caller") and with Requirement 4's "Phase A must not... otherwise clean up/add anything not explicitly listed."

These produce materially different Phase A task-group scopes (10 files vs. 15 files) and different meanings for "Phase A verified as behavior-identical" (Success Criteria 8) — under reading (a), Phase A's manual smoke test would need to confirm 5 files with no behavior are harmlessly inert; under (b), Phase A's file count and the "~13-file split is complete" success criterion wouldn't literally be true until Phase B finishes.

**Severity**: Medium-High — doesn't block starting Phase A (the 3 lowest-risk files are unambiguous either way), but must be resolved before the implementation plan splits Phase A vs. Phase B into task groups, since it changes what "Phase A done" means.

**Recommendation**: Add one sentence to Core Requirement 1 or 2 stating explicitly whether the 5 new-code files are created empty during Phase A or first created in Phase B.

---

### Finding 3 — "~13 files" is inconsistent with the 15 files actually named in the table [MEDIUM]

**Category**: Ambiguous / Incorrect (internal consistency)

**Spec Reference**: Title, TL;DR, Core Requirement 1 intro, Core Requirement 2 ("extracting the remaining ~10 files"), Core Requirement 3 ("the ~13 files"), Success Criteria 8 and 9 — six separate "~13" references.

**Evidence**: Core Requirement 1's table lists 15 distinct files by name: `app.ts`, `orchestrator.ts`, `context.ts`, `types.ts`, `logging.ts`, `templateCache.ts`, `keepaliveFetchClient.ts`, `authTokenProvider.ts`, `progressDialogController.ts`, `templateClassifier.ts`, `workItemCreation.ts`, `templateBuilder.ts`, `templateFilters.ts`, `childTypes.ts`, `templates.ts`. Extracting `logging.ts`/`types.ts`/`context.ts` first (3) leaves 12 remaining, not the "~10" Requirement 2 cites. This is not a rounding artifact of "~" — it's an off-by-2 (13%) miscount, consistent across every mention.

**Gap Description**: This discrepancy is inherited verbatim from `gap-analysis.md` (whose own proposed module boundary table also has 15 rows, also narrated as "~13-file split" throughout) and was carried through `scope-clarifications.md`/`requirements.md` without correction. The spec's own table is fully authoritative and unambiguous, so this doesn't change what gets built — but it risks confusing anyone using the "~13" figure as a completion checklist (e.g., "have we extracted all 13 files yet" when there are actually 15 named), or as an effort/communication anchor with stakeholders.

**Severity**: Medium — non-blocking (the named table is the real source of truth) but a verifiable, repeated factual inaccuracy worth correcting before implementation planning uses it for task-group counts.

---

### Finding 4 — "GetChildTypes (×3)" undercounts actual `VSS.getWebContext()` call sites [LOW]

**Category**: Incorrect (citation accuracy)

**Spec Reference**: Core Requirement 1 (`childTypes.ts` row: "calls `VSS.getWebContext()` directly, does not use `ctx` — preserve as-is"), Explicitly Not Changed item 15 ("`GetChildTypes` (×3) and `createWorkItem` (×1)'s direct `VSS.getWebContext()` calls... stay exactly as-is").

**Evidence**: `src/scripts/app.ts:541-601` (`GetChildTypes`) contains 10 literal occurrences of `VSS.getWebContext()` — lines 543, 560, 567, 569, 572, 573, 575, 578, 580, 582 — not 3. `createWorkItem`'s count of ×1 (`app.ts:110`) is correct.

**Gap Description**: This miscount also originates in `gap-analysis.md`'s Open Questions/Risks ("`GetChildTypes` (×3 call sites)...") and was carried forward unchanged. It doesn't change the required action — Requirement 4 already mandates preserving relocated functions "byte-for-byte," which covers all 10 occurrences regardless of the cited count — so it's not implementation-blocking, but it is a factual inaccuracy that would mislead a manual "did we preserve all the `VSS.getWebContext()` call sites" spot-check.

**Severity**: Low.

---

## Completeness Check — Resolved Decisions vs. Spec Coverage

All decisions in `clarifications.md`, `scope-clarifications.md`, and `requirements.md` were traced into the spec; none found missing:

| Decision | Reflected in spec |
|---|---|
| Modularize-first sequencing (scope-clarifications Critical 1) | Core Requirements section headers (Phase A/B split), Key Decision 1, Technical Approach |
| Shared `ctx` as exported module state, no param-threading (Critical 2) | Key Decision 2, Requirement 1 `context.ts` row |
| Flat file layout, no subfolder (Important 1) | Out of Scope item 10 |
| Extract shared types into `types.ts` (Important 2) | Requirement 1 `types.ts` row |
| Preserve `ctx`-vs-`VSS.getWebContext()` inconsistency (Important 3) | Requirement 15, Out of Scope |
| ~13-file granularity as proposed (Important 4) | Requirement 1 table (see Finding 3 on the count itself) |
| Live ADO org access for endpoint capture (clarifications Q1) | Key Decision 6, Requirement 9, Technical Approach |
| Ship partial popup-close fix (Q2) | Open Questions/Risks, Requirement 10 |
| Per-work-item dialog pairs (Q3) | Requirement 11 |
| Partial-failure summary dialog, not console-only (Q4) | Requirement 11, 12 |
| Mid-phase modularization scope addition | Entire Phase A section |
| No new entry point (requirements Q1) | Requirement 13 |
| No external code reuse — build fresh (Q2) | Reusable Components / New Components Required |
| No versioning changes (Q4) | Requirement 16 |
| Incremental extraction order, AMD smoke test (Technical Q1) | Requirement 2 |
| Native Promise/async-await for new/touched code, Q stays in untouched helpers (Technical Q2) | Technical Approach "Promise style" |

## Risk Coverage Check

All four risk areas called out in the audit brief are explicitly flagged in the spec's Open Questions/Risks:
- REST-endpoint-must-be-captured-live dependency — Requirement 9, Technical Approach, Key Decision 6.
- Partial (non-100%) popup-close guarantee — Open Questions items 1-2, Requirement 10, matches `tdd-red-gate.md`'s Green-gate framing exactly.
- AMD cross-file import pattern unexercised in this repo — Key Decision 3, Open Questions item 4, Requirement 2.
- Template Classifier rule-name list (Requirement 8: `ToAllJustCreatedTasks`, `PreviouslyCreatedTask`, `PreviouslyJustCreatedTask`, `SecondPreviouslyJustCreatedTask`, `FirstJustCreatedTask`, `SecondJustCreatedTask`) — verified to match `high-level-design.md`'s Key Components table and ADR-002's Consequences list exactly, word-for-word.

## Scope Discipline Check

- `bugsBehavior` bug left untouched — Requirement 14, Out of Scope. Confirmed present at `app.ts:557,568,574,577` (declaration + 3 comparisons).
- `ctx`-vs-`VSS.getWebContext()` inconsistency left untouched — Requirement 15, Out of Scope (count is off — see Finding 4 — but the preserve-as-is instruction itself is correct and unambiguous).
- No version bumps — Requirement 16.
- No nested folder structure — Out of Scope item 10.
- No automated test framework introduced — Requirement 17, Testing Approach section, consistent with `tdd-red-gate.md`.

---

## Recommendations

1. **Before implementation planning**: re-derive Core Requirement 1's "Depends on" column via an actual per-function call-graph pass (Finding 1) — this is the highest-leverage fix, since it sits at the root of Phase A's file-by-file extraction order.
2. **Before implementation planning**: add one clarifying sentence resolving whether the 5 Phase-B component files are created empty in Phase A or first created in Phase B (Finding 2).
3. Optional, non-blocking: correct "~13" to "15" (or list the exact count) throughout, and correct "GetChildTypes (×3)" to the actual count, for documentation accuracy (Findings 3-4).

## Compliance Status

**⚠️ Mostly Compliant** — the spec is unusually thorough and faithfully traces every upstream decision with accurate line-number evidence; the one High finding is a mechanical table-correction, not a scope or design defect, and is fixable without revisiting any decision already made.
