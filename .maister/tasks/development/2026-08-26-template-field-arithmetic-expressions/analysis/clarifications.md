# Phase 1 Clarifications

## TL;DR
Expressions are evaluated by a hand-rolled, allowlisted arithmetic evaluator (no `new Function`/`eval`), triggered only by a leading `=` prefix on the template field value. Missing parent fields or evaluation errors are logged and the field is omitted from the child work item, which is still created. This task introduces Jest as the project's first test runner, with unit tests for the evaluator and placeholder substitution.

## Key Decisions
- Safe arithmetic subset instead of real JavaScript evaluation — the sandboxed Azure DevOps iframe's `unsafe-eval` CSP status is unverified, templates are editable by any team member, and `validation.md` mandates allowlists over blocklists.
- Leading `=` prefix marks a value as an expression — follows the `@me`/`@currentiteration` sentinel precedent and keeps literal text such as "Fix: 2+2" untouched.
- On missing parent field or evaluation failure: log (template name, field, expression) and skip the field; create the child with its remaining fields — consistent with the project's catch/log/degrade philosophy.
- Add Jest + ts-jest with a test-only tsconfig (CommonJS) and an `npm test` script — the evaluator is pure logic and the roadmap already plans Jest.

## Open Questions / Risks
- Exact allowlisted grammar (which `Math.*` functions, decimal/negative literals, operator precedence) to be pinned in the specification.
- Result typing (native number vs string) to be confirmed in the specification; default assumption is native number for successful evaluations.

## Q&A

| # | Question | Answer |
|---|----------|--------|
| 1 | How should expressions be evaluated — real JS via `new Function`, a safe arithmetic subset, or `new Function` with an allowlist pre-check? | **Safe arithmetic subset**: numbers, `+ - * / % ( )`, fixed `Math.*` set (ceil, floor, round, abs, min, max, pow). |
| 2 | How does the extension recognise an expression vs literal text? | **Leading `=` prefix**, e.g. `=Math.ceil({Microsoft.VSTS.Scheduling.StoryPoints}*2)`. Values without `=` behave as today. |
| 3 | Behaviour when a referenced parent field is missing/empty or evaluation fails? | **Skip the field, create the item**: log error with template name, field and expression; omit that field from the child. |
| 4 | Should this task introduce the first unit tests? | **Yes**: add Jest + tests for the evaluator and placeholder substitution. |

Answered: 2026-08-26 (session clock, UTC)
