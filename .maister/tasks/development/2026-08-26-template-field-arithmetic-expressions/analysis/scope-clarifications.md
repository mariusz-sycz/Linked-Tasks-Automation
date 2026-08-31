# Phase 2 Scope Clarifications

## TL;DR
The Azure DevOps template editor accepts `=`-prefixed values (verified by the user), so the headline Story Points use case is authorable via the UI. The evaluator resolves `{Field}` placeholders itself (numbers and numeric strings only), treats every `=`-prefixed value as an expression (parse failure → log + skip), writes raw numbers, and leaves `replaceReferenceToParentField` output unchanged (log only). Scope is expanded in one place: skipped expression fields are surfaced as warnings in the completion dialog. Versions are aligned to a new minor at the end.

## Key Decisions
- Authoring feasibility resolved — the user confirmed Azure DevOps accepts a template field value beginning with `=`; no spike or REST-API fallback needed.
- Evaluator resolves `{Field}` placeholders itself — textual splicing causes `undefined`/`null`/`2--3`/string-injection failures; in-evaluator lookup gives precise errors and a pure, testable module.
- `{Field}` values inside expressions: JS numbers and numeric strings (`Number(value)` finite); anything else → error + skip — custom text fields sometimes hold numeric strings; identities/dates/HTML can never survive arithmetic.
- Every value starting with `=` is an expression; trim whitespace; parse/evaluation failure → log + skip the field — consistent and heuristic-free; no escape for a literal leading `=` (documented limitation).
- Write the raw numeric result; ADO's 400 on a non-integer for an integer field surfaces as a failed template as today — docs instruct authors to wrap with `Math.round`/`ceil`/`floor`; `NaN`/`Infinity`/division-by-zero are always errors → skip.
- `replaceReferenceToParentField`: add `logError` when a placeholder resolves to `undefined`/`null`; output unchanged — replace-all was verified working; existing users' output must stay byte-for-byte identical.
- **Scope expansion**: extend `TemplateOutcome` with a warnings list and show "created with N field(s) skipped" in the completion dialog — user wants skipped fields visible outside the browser console.
- Versioning: as the last implementation step, set `vss-extension.json` and `package.json` to the same new minor version and fix the roadmap "Current State" line — packaging standard requires manual bumps; roadmap currently claims an alignment that regressed.
- Minor (recommended defaults taken): tests live in `src/tests/*.test.ts` outside the production tsconfig include; update `.maister/docs/project/roadmap.md` in this task; replace the "There is no automated test suite yet" line in both `README.md` and `src/overview.md` with `npm test` instructions.

## Open Questions / Risks
- The completion-dialog warning touches `progressDialogController.ts` and `TemplateOutcome`, which are modified in the uncommitted in-flight diff — implementation must build on the working-tree version (status-based outcomes), not HEAD.
- E2E browser verification is not practical for this extension (requires a live Azure DevOps org); `options.e2e_enabled` set to false.

## Decision Log

| ID | Question | Answer |
|----|----------|--------|
| authoring-feasibility (critical) | Does the ADO template editor accept `=Math.ceil(...)` in numeric fields? | **Verified by user: accepted.** Proceed. |
| substitution-strategy | Evaluator resolves placeholders vs textual substitution then parse | **Evaluator resolves placeholders** |
| non-numeric-references | Non-numeric parent fields inside expressions | **Numbers + numeric strings; else error + skip** |
| malformed-expressions | `=` alone, `=abc`, whitespace after marker | **Always an expression; trim; parse failure = log + skip** |
| result-typing | Non-integer result for integer-typed field | **Write raw number; docs recommend Math.round for integer fields** |
| harden-substitution | Change `replaceReferenceToParentField`? | **Log only, output unchanged** |
| failure-visibility | Skipped field visible outside console? | **Yes — show warnings in the completion dialog** (scope expansion) |
| version-bump | Version handling | **Align both manifests to a new minor at the end; fix roadmap** |
| roadmap-update (minor) | Update roadmap.md in this task? | Yes (recommended default) |
| test-location (minor) | Where do tests live? | `src/tests/*.test.ts` (recommended default) |
| readme-test-line (minor) | Replace "no automated test suite" line? | Yes, in both README.md and src/overview.md (recommended default) |

## Optional Phase Defaults
- `ui_heavy: false` → no UI mockups (Phase 4 skipped), `e2e_enabled: false` (no browser-testable UI without a live org).
- `creates_new_entities: true` → `user_docs_enabled: true`.
