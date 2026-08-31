# Requirements: Arithmetic Expressions in Template Field Values

## TL;DR
Template authors prefix a field value with `=` (e.g. `=Math.ceil({Microsoft.VSTS.Scheduling.StoryPoints}*2)`); at child-creation time the extension evaluates it with a hand-rolled allowlisted arithmetic evaluator that resolves `{Field}` references from the parent work item and writes the numeric result to the child. Failures (missing/non-numeric parent field, parse error, non-finite result) log to the console, skip that field, still create the child, and are summarised in the completion dialog as "Warnings: <template> (N field(s) skipped)". The task also introduces Jest (first tests), updates README/overview/roadmap, and aligns both manifest versions to a new minor.

## Key Decisions
- Allowlisted evaluator, no `new Function`/`eval` — CSP unverified in the sandboxed iframe; templates are team-editable; `validation.md` mandates allowlists.
- `=` prefix is the sole trigger, honoured on any field — the marker alone decides; `@me`, `@currentiteration`, `System.Tags` keep their existing handling.
- Evaluator resolves `{Field}` itself (numbers + numeric strings) — avoids `undefined`/`null`/`2--3`/string-injection failure modes of textual splicing.
- Failure → log + skip field + create child + dialog warning — matches catch/log/degrade philosophy while making silent skips visible.
- Jest + ts-jest with a test-only CommonJS tsconfig, tests in `src/tests/` — production `tsconfig.json` (AMD) untouched; no test output leaks into `build/`.

## Open Questions / Risks
- Integer-typed ADO fields reject non-integer results with a 400 (template shows as failed) — mitigated by documentation only (use `Math.round`/`ceil`/`floor`).
- `progressDialogController.ts` / `TemplateOutcome` are modified in the uncommitted working tree — implement against the working-tree version (status-based outcomes), not HEAD.
- Templates are cached in `localStorage` for 4 h — manual verification must clear `linkedTasksAutomation.templateCache.*`.

---

## 1. Initial Description (user)
> I want to add implementation that will allow users to create templates that will allow to provide arithmetic calculations in template fields like "Math.ceil({Microsoft.VSTS.Scheduling.StoryPoints}*2)". It should be parsed as function and executed like standard javascript code.

## 2. Q&A — All Rounds

### Phase 1 clarifications
| # | Question | Answer |
|---|----------|--------|
| 1 | Evaluation mechanism | Safe arithmetic subset — hand-rolled allowlisted evaluator (no `new Function`/`eval`) |
| 2 | Expression marker | Leading `=` prefix |
| 3 | Missing parent field / evaluation failure | Log error (template, field, expression) and skip the field; child still created |
| 4 | Tests | Yes — add Jest + tests for evaluator and placeholder substitution |

### Phase 2 scope decisions
| ID | Question | Answer |
|----|----------|--------|
| authoring-feasibility | Does ADO's template editor accept `=...` in numeric fields? | **Verified by user: yes** |
| substitution-strategy | Who resolves `{Field}` inside expressions? | Evaluator resolves placeholders itself |
| non-numeric-references | Non-numeric parent field referenced | Numbers + numeric strings (`Number(v)` finite) accepted; else error + skip |
| malformed-expressions | `=`, `=abc`, `= 2*3` | Always an expression; trim; parse failure → log + skip. No escape for literal leading `=` |
| result-typing | Non-integer result on integer field | Write raw number; ADO 400 → template failed (as today); docs recommend `Math.round` |
| harden-substitution | Change `replaceReferenceToParentField`? | Add `logError` on undefined/null placeholder; output unchanged |
| failure-visibility | Skipped fields visible outside console? | **Yes** — completion dialog warning (scope expansion) |
| version-bump | Versions | Align `vss-extension.json` + `package.json` to the same new minor at the end; fix roadmap |
| roadmap-update | Update roadmap.md? | Yes |
| test-location | Test files | `src/tests/*.test.ts` |
| readme-test-line | Replace "no automated test suite" line? | Yes, in both README.md and src/overview.md |

### Phase 5 requirements
| # | Assumption | Answer |
|---|-----------|--------|
| 1 | **User journey**: persona = team member editing ADO work item templates (Project Settings › Boards › Team configuration › Templates), types an `=` formula, later clicks the extension's "Create linked tasks" toolbar button on a parent; discovery via README / Marketplace page | Confirmed |
| 2 | **Code reuse**: reuse `logInfo`/`logError` (`logging.ts`), `WorkItemFields` (`types.ts`); plug into `templateBuilder.ts` beside `@me`/`@currentiteration` handling; extend existing `TemplateOutcome`/`showCompletionDialog` — no new dialog, no new REST calls | Confirmed |
| 3 | **Visual assets**: none | Confirmed — dialog wording specified in text |
| 4 | **Grammar**: integer + decimal literals, binary `+ - * / %`, unary minus, parentheses, `{Field.Ref.Name}` references, `Math.ceil/floor/round/abs/min/max/pow` with comma-separated args, standard JS precedence; no `**`, no comparisons/ternary, no variables | Confirmed |
| 5 | **Dialog wording**: `Work item #N: X tasks of Y templates created. Warnings: Task A (1 field skipped), Task B (2 fields skipped)` — template name + count only; details in console | Confirmed |
| 6 | **Field scope**: `=` honoured on any template field; reserved values keep existing handling | Confirmed |

## 3. Similar Features Identified
- `{Field}` placeholder substitution — `src/scripts/templateFilters.ts:194-205` (`replaceReferenceToParentField`), called only from `src/scripts/templateBuilder.ts:22`.
- Reserved-value sentinels `@me` / `@currentiteration` — gated in `IsPropertyValid` (`templateFilters.ts:177`) and resolved in `templateBuilder.ts:41-48`; the precedent for special value syntax.
- `applywhen`/`notapplywhen` rules engine — `templateFilters.ts:5-109`; string-equality only, no operators (nothing to reuse for arithmetic).
- Per-template outcome reporting — `TemplateOutcome` (`progressDialogController.ts:12-17`, working-tree version with `status: "created" | "failed" | "skipped"`) and `showCompletionDialog` (`:58`).

## 4. Visual Assets and Insights
None. Only visible change: an additional "Warnings: …" suffix in the existing completion dialog line.

## 5. Functional Requirements Summary
1. A template field value whose trimmed form starts with `=` is an expression; the remainder is evaluated.
2. Grammar (allowlist): numeric literals (`2`, `0.5`, `.5` optional), `+ - * / %`, unary `-`, `( )`, `{Field.Ref.Name}`, `Math.ceil|floor|round|abs|min|max|pow(args)`; JS precedence and left-associativity.
3. `{Field}` resolution reads `currentWorkItem[field]`: JS number → as-is; string with finite `Number()` → that number; `undefined`/`null`/`""`/other → error.
4. Result must be a finite number; `NaN`/`Infinity` (incl. division by zero) → error.
5. On success: push `{ op: "add", path: "/fields/<key>", value: <number> }`.
6. On any error: `logError` with template name, field ref name, raw expression, reason; omit the field; record a skipped-field warning for that template.
7. Child creation proceeds with remaining fields; `TemplateOutcome` carries `skippedFields` (count and/or names); `showCompletionDialog` appends `Warnings: <template> (N field(s) skipped)` for affected templates.
8. Non-`=` values behave byte-for-byte as today; `replaceReferenceToParentField` gains a `logError` when a placeholder resolves to `undefined`/`null` but its output is unchanged.
9. No `eval`, `new Function`, or third-party parser; the module is synchronous and AMD-bundled automatically.
10. Jest + ts-jest added (`src/package.json` devDependencies, `npm test` script, `src/jest.config.js`, `src/tsconfig.test.json` CommonJS incl. SDK typings); tests in `src/tests/` cover evaluator grammar, precedence, placeholder resolution, error cases, and `replaceReferenceToParentField`.
11. Docs: README.md and src/overview.md (kept identical) gain a "Field placeholders and expressions" section, a Project Structure row for the new module, and `npm test` instructions; roadmap.md updated (feature, tests, version line, follow-ups).
12. Versions: `src/vss-extension.json` and `src/package.json` set to the same new minor version as the final step.

## 6. Reusability Opportunities
- `logInfo`/`logError` (`logging.ts`), `WorkItemFields` (`types.ts`).
- `IsPropertyValid` gate stays as-is; the `=` branch sits inside `createWorkItemFromTemplate`.
- `TemplateOutcome` / `showCompletionDialog` extended, not duplicated.

## 7. Scope Boundaries
**In scope**: evaluator module + tests; builder integration; substitution logging; outcome warnings + dialog suffix; Jest setup; README/overview/roadmap docs; version alignment.
**Out of scope**: `**`, comparisons, ternaries, string concatenation, variables; field-type lookup/auto-rounding; escape syntax for a literal leading `=`; changes to `src/scripts/app.js` (stale artifact); CI/CD; `bugsBehavior` bug; any change to non-`=` value output.

## 8. Technical Considerations
- TypeScript strict, AMD, ES2015 target; new module must import only from `src/scripts/*` so the RequireJS optimizer inlines it.
- Evaluator: tokenizer + recursive-descent parser (precedence: unary → `* / %` → `+ -`), evaluating directly during parse or via a small AST — implementer's choice, keep minimal.
- Work against the working-tree `TemplateOutcome` (status-based) in `progressDialogController.ts` / `workItemCreation.ts`.
- Jest must not compile under the production tsconfig: tests outside `scripts/**`, separate `tsconfig.test.json` with `module: commonjs` and the SDK `typings/*.d.ts` for `TFS/WorkItemTracking/Contracts` type imports.
- Manual verification: clear `linkedTasksAutomation.templateCache.*` localStorage keys after editing templates.
