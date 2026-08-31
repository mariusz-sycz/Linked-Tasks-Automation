# Specification: Arithmetic Expressions in Template Field Values

## TL;DR
A template field value whose trimmed form starts with `=` is evaluated by a new pure module `src/scripts/expressionEvaluator.ts` (tokenizer + recursive-descent parser, allowlisted grammar: numbers, `+ - * / %`, unary minus, parentheses, `{Field.Ref.Name}` placeholders resolved from the parent, `Math.ceil|floor|round|abs|min|max|pow`); the finite numeric result is pushed into the child's JSON-Patch document. `templateBuilder.ts` gains the `=` branch (evaluated instead of `replaceReferenceToParentField`) and returns `{ patchDocument, skippedFields }`; failures `logError` and skip the field, the child is still created, and `TemplateOutcome.skippedFields` drives a `Warnings: <template> (N field(s) skipped)` suffix in the existing completion dialog. Jest + ts-jest (CommonJS test tsconfig, tests in `src/tests/`) become the project's first test runner; README/overview/roadmap are updated and both manifests are set to `1.3.0` as the final step.

## Key Decisions
- `createWorkItemFromTemplate` returns `{ patchDocument, skippedFields }` instead of an out-parameter — single caller (`workItemCreation.ts:58`), explicit and unit-testable, no mutable argument threading.
- `skippedFields` is attached only to `created` outcomes — a `failed` template is already flagged by name; the warning's meaning is "created but incomplete".
- Placeholders are resolved inside the evaluator from `currentWorkItem`; `replaceReferenceToParentField` is not called for `=` values — avoids `undefined`/`null`/`2--3`/string-injection failure modes; the helper's output stays byte-identical for non-`=` values.
- Errors inside the evaluator use one private typed error class caught at the `evaluateExpression` boundary; the module never throws to callers — matches `error-handling.md` (typed exceptions, centralized handling) and the project's catch/log/degrade philosophy.
- Evaluation happens during parsing (no AST) — the grammar is tiny and has no second consumer; an AST would be a speculative abstraction (`minimal-implementation.md`).
- `showCompletionDialog`'s message assembly is extracted into an exported pure `formatCompletionMessage` — the only way to unit-test the exact dialog wording without stubbing the `VSS` global; `showCompletionDialog` becomes its sole runtime caller.
- Jest 29 / ts-jest 29 / @types/jest 29, `tsconfig.test.json` extends `tsconfig.json` with `module: commonjs`, `noEmit: true` and a `files` entry for `node_modules/vss-web-extension-sdk/typings/tfs.d.ts`; **no `esModuleInterop`** — it would make the `import * as Q from "q"; Q(...)` pattern in `childTypes.ts`/`templates.ts` fail with TS2349. The type-only `TFS/*` namespace imports are elided, so no `moduleNameMapper` stub is needed; the gate is `npx tsc --noEmit -p tsconfig.test.json` (from `src/`) exiting 0.
- Version `1.3.0` for both `vss-extension.json` and `package.json` — new feature on top of the `1.2.8` already committed at HEAD `551aa91`; a new minor per the `version-bump` decision; `package-lock.json` is realigned with `npm install --package-lock-only`.

## Open Questions / Risks
- Integer-typed Azure DevOps fields (e.g. `Microsoft.VSTS.Common.Priority`) reject non-integer results with HTTP 400; the template then shows as `Failed` — mitigated by documentation only (`Math.round`/`ceil`/`floor`).
- Baseline is HEAD `551aa91` ("Commit changes from last release", 2026-08-27): status-based `TemplateOutcome`, `vss-extension.json` already at `1.2.8`, `src/scripts/app.js` committed as a tracked legacy artifact; the working tree has no source changes (`git diff HEAD -- src/` is empty). All line references in this spec are against that commit.
- Templates are cached in `localStorage` for 4 h; manual verification must clear `linkedTasksAutomation.templateCache.*` keys after editing a template.
- ts-jest seeds its language service from the tsconfig `files`/`include` list; if a `Cannot find module 'TFS/WorkItemTracking/Contracts'` diagnostic still appears, the fallback is a `/// <reference path="../node_modules/vss-web-extension-sdk/typings/tfs.d.ts" />` line at the top of the affected test file.
- No live Azure DevOps org is available for automated verification; runtime behaviour is covered by the manual checklist in Success Criteria.

---

## Goal
Let template authors compute numeric child-field values from parent-field values with a safe, allowlisted arithmetic expression (`=Math.ceil({Microsoft.VSTS.Scheduling.StoryPoints}*2)`), while making every evaluation failure visible (console detail + dialog warning) without ever blocking child creation.

## User Stories
- As a **template author** (team member with template-manage rights), I want to write `=Math.ceil({Microsoft.VSTS.Scheduling.StoryPoints}*2)` in a task template's Story Points field so that each generated task gets Story Points derived from its parent without manual editing.
- As a **template author**, I want a mistyped or unresolvable expression to skip only that field (not the whole task) so that a typo in one field never stops the breakdown from being created.
- As a **user clicking "Create linked tasks"**, I want the completion dialog to tell me which templates had fields skipped so that I do not silently end up with tasks missing values.
- As a **developer**, I want `npm test` to run unit tests for the evaluator, placeholder substitution, builder and dialog wording so that changes to the parser are safe to make.
- As a **Marketplace user reading the overview page**, I want the placeholder and expression syntax documented (including the integer-field rounding rule) so that I can adopt the feature without reading source code.

## Core Requirements

### A. Expression detection and evaluation (`src/scripts/expressionEvaluator.ts`, new)

**R1. Expression marker.** A template field value is an expression when, after trimming leading and trailing whitespace, its first character is `=`. Everything after that `=` (trimmed again) is the expression body. There is no escape for a literal leading `=`. Examples: `"=1+1"`, `" =1"`, `"= 2*3 "` are expressions; `"x=1"`, `"Fix: 2+2"`, `""` are not. `"="` and `"=   "` are expressions with an empty body (an error, see R7).

**R2. Public API.** The module exports exactly:
- `isExpression(fieldValue: string): boolean` — implements R1.
- `evaluateExpression(fieldValue: string, currentWorkItem: WorkItemFields): EvaluationResult` — takes the raw template value (including the `=`), strips the marker per R1, tokenizes, parses and evaluates the body, resolving placeholders against `currentWorkItem`. Precondition: `isExpression(fieldValue)` is true; if it is not, the result is `{ ok: false, reason: "value is not an expression" }`.
- `type EvaluationResult = { ok: true; value: number } | { ok: false; reason: string }`.

The module is synchronous, imports only `WorkItemFields` from `./types` (a type import), never throws to its caller, never logs (logging is the caller's responsibility so the message can carry template and field names), and uses no `eval`, `new Function`, or third-party parser. Everything other than the three exports above is module-private.

**R3. Tokenizer.** Operating on the expression body, with `i` = 0-based index into the body:
| Token | Rule |
|---|---|
| whitespace | space, tab, CR, LF between tokens are skipped; never part of a token |
| `NUMBER` | `digits [ "." digits ]` or `"." digits` (e.g. `2`, `0.5`, `.5`, `10.25`). No exponent, no sign (sign is the unary operator), no `1.` |
| `FIELD` | `"{"` followed by one or more characters that are not `{` or `}`, followed by `"}"`. The content is used verbatim (no trim, case-sensitive) as the parent field reference name. `{}` → error `empty field reference at index i`; missing `}` → error `unterminated field reference at index i`; a `{` inside a field reference → error `unexpected character '{' at index i` where `i` is the index of the inner `{` (e.g. `{A{B}` → `unexpected character '{' at index 2`) |
| `IDENT` | `[A-Za-z_][A-Za-z0-9_.]*` — the tokenizer accepts any such identifier; the parser (R4) decides: an `IDENT` followed by `(` is a `call` and must be one of the seven `Math.<fn>` names in R5, otherwise `unsupported function '<ident>'`; an `IDENT` not followed by `(` is always `unknown identifier '<ident>'` (even `Math.ceil` without parentheses) |
| `OP` | one of `+ - * / %` |
| `LPAREN` `RPAREN` `COMMA` | `(` `)` `,` |
| `END` | end of body |
Any other character (e.g. `^`, `**` is two `*` tokens and fails in the parser, `"`, `'`, `;`, `[`, `!`) → error `unexpected character 'c' at index i`.

**R4. Grammar (EBNF) and precedence.**
```
expression      = additive END ;
additive        = multiplicative { ( "+" | "-" ) multiplicative } ;
multiplicative  = unary { ( "*" | "/" | "%" ) unary } ;
unary           = "-" unary | primary ;
primary         = NUMBER | FIELD | call | "(" additive ")" ;
call            = IDENT "(" [ additive { "," additive } ] ")" ;      (* IDENT must be Math.<fn> *)
```
`primary` on an `IDENT` token: if the next token is `(` it is a `call`; a `call` whose identifier is not in the R5 table → `unsupported function '<ident>'` (checked before the arguments are parsed); an `IDENT` not followed by `(` → `unknown identifier '<ident>'`. So `=abc(1)` → `unsupported function 'abc'`, `=Math.ceil` → `unknown identifier 'Math.ceil'`, `=abc` → `unknown identifier 'abc'`.
Precedence, highest first: parentheses and function calls; unary minus (right-associative, stackable: `--3` = 3); `* / %` (left-associative); `+ -` (left-associative). This matches JavaScript for the supported operator set. Examples: `1+2*3` = 7; `(1+2)*3` = 9; `2*-3` = -6; `-2*3` = -6; `10-4-3` = 3; `7%3` = 1; `-Math.abs(-2)` = -2. Not supported and therefore parse errors: `**`, unary `+`, comparisons, `?:`, `&& ||`, variables, string literals, member access other than `Math.<fn>`. Trailing tokens after a complete expression (e.g. `1 2`, `1)`) → `unexpected token 'x' at index i`; premature end (e.g. `1+`, `(1`, `Math.max(`) → `unexpected end of expression`.

**R5. Function allowlist and arity.** Exactly these, dispatched to the corresponding `Math` member (no dynamic property lookup on `Math`):
| Name | Arity | Error on wrong arity |
|---|---|---|
| `Math.ceil`, `Math.floor`, `Math.round`, `Math.abs` | 1 | `Math.ceil expects 1 argument, got N` |
| `Math.pow` | 2 | `Math.pow expects 2 arguments, got N` |
| `Math.min`, `Math.max` | 1 or more | `Math.min expects at least 1 argument, got 0` |
Names are case-sensitive (`math.ceil`, `Math.Ceil`, `Math.ciel` → `unsupported function '<as written>'`).

**R6. Placeholder resolution.** For a `FIELD` token with name `n`, `v = currentWorkItem[n]`:
| `v` | Result |
|---|---|
| JavaScript `number` (finite) | `v` |
| `string` whose `Number(v)` is finite and whose trimmed form is non-empty (e.g. `"3"`, `" 2.5 "`) | `Number(v)` |
| `undefined` (field absent) | error `parent field 'n' is missing` |
| `null` | error `parent field 'n' is empty` |
| `""` or whitespace-only string | error `parent field 'n' is empty` |
| anything else (non-numeric string, boolean, object, array, date string, identity object, HTML) | error `parent field 'n' value '<shown>' is not numeric`, where `<shown>` is `String(v)` truncated to its first 40 characters followed by `…` (U+2026) when `String(v)` is longer than 40 characters, otherwise `String(v)` unchanged |
The same field may be referenced any number of times. Placeholders are resolved when the token is consumed; the first failing placeholder (left to right) determines the reason.

**R7. Result and error taxonomy.** Success: the final value must satisfy `Number.isFinite`; otherwise error `result is not a finite number` (covers `1/0`, `0/0`, `5%0`, overflow). Every failure returns `{ ok: false, reason }` where `reason` is one of the strings defined in R1-R7 (`expression is empty` for an empty body; `unexpected error: <message>` for anything unforeseen caught at the boundary). Reasons are short (the only embedded parent value is the R6 fragment, bounded at 40 characters + `…`), contain no stack traces, and always name the offending token/field so the author can fix the template.

### B. Builder integration (`src/scripts/templateBuilder.ts`)

**R8. Return shape.** `createWorkItemFromTemplate(currentWorkItem, taskTemplate, teamSettings)` returns `BuiltWorkItem = { patchDocument: WorkItemFields[]; skippedFields: string[] }` (exported interface). `patchDocument` is exactly today's JSON-Patch array; `skippedFields` lists the field reference names (the `key` values) whose expressions failed, in template iteration order, empty when nothing was skipped.

**R9. The `=` branch.** Inside the existing `for (var key in taskTemplate.fields)` / `IsPropertyValid` loop, the non-empty-value branch becomes:
1. `fieldValue = taskTemplate.fields[key]`.
2. If `isExpression(fieldValue)`: call `evaluateExpression(fieldValue, currentWorkItem)`. On `ok`, push `{ op: "add", path: "/fields/" + key, value: result.value }` (a native `number`, not a string). On failure, `logError` per R10, push nothing for this key, and append `key` to `skippedFields`. `replaceReferenceToParentField` is **not** called for this value.
3. Else: exactly today's code — `replaceReferenceToParentField(fieldValue, currentWorkItem)` and push the string.

The `=` marker is honoured on any field that reaches this loop (including `System.Title`, `System.AssignedTo`, `System.IterationPath`, custom fields). Note that when a skipped field is required by the work item type (e.g. a failing `=` expression on `System.Title`), the builder pushes no entry for it and the defaults block does not backfill it (`templateBuilder.ts:30-31` only backfills when the template key is absent), so Azure DevOps rejects the child and the template is reported as `Failed` via the existing error path — see Known Limitations. `IsPropertyValid` is unchanged: `System.Tags`, `@me`, `@currentiteration` keep their existing handling and the empty-value inheritance branch is untouched. The defaults block after the loop (Title/AreaPath/IterationPath/`@me`) is unchanged and cannot double-push, because it only acts on `null`/`@currentiteration`/`@me` values.

**R10. Log message format (builder).** One `logError` call per skipped field:
`Template '<template name>' field '<field reference name>': expression '<raw template value>' skipped - <reason>`
Example console output: `linked-tasks-automation: Template 'Task A' field 'Microsoft.VSTS.Scheduling.StoryPoints': expression '=Math.ciel({Microsoft.VSTS.Scheduling.StoryPoints}*2)' skipped - unsupported function 'Math.ciel'`. `templateBuilder.ts` imports `logError` from `./logging` for this (new import; the file currently does not log).

### C. Outcome reporting (`src/scripts/workItemCreation.ts`, `src/scripts/progressDialogController.ts`)

**R11. Caller update.** In `createWorkItem` (`workItemCreation.ts:54-162`): `var built = createWorkItemFromTemplate(...)`; every existing use of the patch document (`keepaliveFetch.createWorkItem(...)`, the `console.log(newWorkItem)` calls) uses `built.patchDocument`. When the parent link succeeds and the outcome is `created`, and `built.skippedFields.length > 0`, the returned outcome carries `skippedFields: built.skippedFields`. `failed` and `skipped` outcomes never carry `skippedFields`.

**R12. `TemplateOutcome` extension.** `TemplateOutcome` gains an optional member `skippedFields?: string[]` — "field reference names whose `=` expression failed to evaluate; present only on `created` outcomes and only when non-empty". The JSDoc above the type is extended with that sentence; the union `TemplateOutcomeStatus` is unchanged.

**R13. Dialog wording.** `formatCompletionMessage(perWorkItemOutcomes: { workItemId: number, outcomes: TemplateOutcome[] }[]): string` is a new exported pure function in `progressDialogController.ts` containing the current message assembly (`'Task creation finished:\n\n' + lines.join('\n')`), and `showCompletionDialog` calls it, then `logInfo`s and shows the result exactly as today. Per work item, the line is:
`Work item #<id>: <created> tasks of <total> templates created` + (if any failed) `. Failed: <name>, <name>` + (if any created outcome has `skippedFields`) `. Warnings: <name> (<n> field skipped|fields skipped), <name> (...)`.
Pluralisation: `1 field skipped`, otherwise `<n> fields skipped`. Warnings are listed in outcome order, template name and count only — field names and expressions stay in the console (R10). Examples:
- `Work item #123: 3 tasks of 3 templates created. Warnings: Task A (1 field skipped), Task B (2 fields skipped)`
- `Work item #123: 2 tasks of 3 templates created. Failed: Task C. Warnings: Task A (1 field skipped)`
- `Work item #123: 3 tasks of 3 templates created` (unchanged when nothing was skipped or failed)

### D. Substitution helper observability (`src/scripts/templateFilters.ts:194-205`)

**R14. `replaceReferenceToParentField` logging.** Signature and returned string are unchanged. When a placeholder's parent value is `undefined` or `null`, the function calls `logError` before performing the (unchanged) replacement:
`Parent field '<name>' referenced in template value '<original template value>' is <missing|null>; substituting the literal text '<undefined|null>'`
(`missing` for `undefined`, `null` for `null`; `<original template value>` is the value as received, before any replacement). Exactly one `logError` per placeholder occurrence, i.e. per regex match: `{A}+{A}` with `A` missing logs twice. The log is emitted only when `fieldValue.indexOf('{' + parentField + '}') >= 0` at that iteration, so a stray-`}` match such as `"abc}"` (which the regex `/[^{\}]+(?=})/g` at `templateFilters.ts:195` reports as `abc` although no `{abc}` exists) logs nothing — a logging-only guard; the `replace` call runs exactly as today. No other behaviour changes: first-occurrence-per-match replacement, the regex, and numeric stringification stay as they are (`{A}+{A}` continues to resolve both occurrences because the regex returns the name twice), and the returned string is byte-identical to today's for every input.

### E. Test infrastructure (first in the repository)

**R15. Tooling.** `src/package.json` gains devDependencies `jest` (`^29.7.0`), `ts-jest` (`^29.2.5`), `@types/jest` (`^29.5.14`) and the script `"test": "jest"`. `package-lock.json` is updated by `npm install`. No change to `tsconfig.json`, `gruntfile.js`, `bundle-scripts.js`, or `vss-extension.json` for testing.

**R16. `src/jest.config.js`** (CommonJS, self-contained):
- `preset: "ts-jest"`, `testEnvironment: "node"`
- `testMatch: ["<rootDir>/tests/**/*.test.ts"]`
- `transform: { "^.+\\.ts$": ["ts-jest", { tsconfig: "tsconfig.test.json" }] }`

**R17. `src/tsconfig.test.json`:**
- `"extends": "./tsconfig.json"`
- `compilerOptions`: `"module": "commonjs"`, `"types": ["jest"]`, `"noEmit": true` (the inherited `outDir: ../build/scripts` must never receive CommonJS output from a manual `tsc -p tsconfig.test.json`; ts-jest overrides `noEmit` internally, so tests are unaffected). `strict`, `target ES2015`, `skipLibCheck` are inherited. **Do not set `esModuleInterop`**: `src/scripts/childTypes.ts:4` and `src/scripts/templates.ts:3` use `import * as Q from "q"` and call `Q(...)`, which is TS2349 ("not callable") under `esModuleInterop`. The ts-jest interop hint (TS151001) is a warning, not an error; it may optionally be silenced with `diagnostics: { ignoreCodes: [151001] }` in the ts-jest transform options in `jest.config.js` — not required.
- `"include": ["scripts/**/*.ts", "tests/**/*.ts"]`
- `"files": ["node_modules/vss-web-extension-sdk/typings/tfs.d.ts"]` — seeds the ambient `TFS/WorkItemTracking/Contracts` and `TFS/Work/Contracts` module declarations (`tfs.d.ts` references `vss.d.ts`, which supplies `WebContext` for `context.ts`). The type-only `TFS/*` imports are elided under CommonJS, so `templateFilters.ts`/`templateBuilder.ts` require only `./logging`, `./context`, `./templateFilters`.
- **Type-check gate**: `npx tsc --noEmit -p tsconfig.test.json` (run from `src/`) must exit 0 over the whole program (all of `scripts/**` and `tests/**`), not only the files Jest happens to transform.
The production build is unaffected: `tsconfig.json` still includes only `scripts/**/*.ts`, so `tsc -p tsconfig.json` never sees `tests/`, and `types: []` keeps Jest globals out of production compilation.

**R18. Test files** live in `src/tests/` (never under `scripts/`). Tests are behaviour-focused (`test-writing.md`), use descriptive names, and mock nothing except `console.error` (via `jest.spyOn`) where log output is asserted. Concrete case list, grouped (the planner keeps 2-8 tests per step group):

| # | File / group | Cases |
|---|---|---|
| T1 | `tests/expressionEvaluator.test.ts` — `isExpression` | `"=1"` true; `" =1"` true; `"= 1"` true; `"="` true; `"x=1"` false; `"Fix: 2+2"` false; `""` false; `"{A}"` false |
| T2 | same — literals and precedence | `=2` → 2; `=0.5` → 0.5; `=.5` → 0.5; `=1+2*3` → 7; `=(1+2)*3` → 9; `=10-4-3` → 3; `=7%3` → 1; `=8/2/2` → 2; `= 2 * 3 ` (whitespace) → 6 |
| T3 | same — unary minus | `=-2` → -2; `=2*-3` → -6; `=--3` → 3; `=2 - -3` → 5; `=-(1+2)` → -3; `=+2` → error `unexpected token '+' at index 0` (unary plus is not in the grammar; `+` is a valid token, so the parser rejects it) |
| T4 | same — Math functions | `=Math.ceil(1.2)` → 2; `=Math.floor(1.8)` → 1; `=Math.round(2.5)` → 3; `=Math.abs(-4)` → 4; `=Math.min(3,1,2)` → 1; `=Math.max(3,1,2)` → 3; `=Math.pow(2,10)` → 1024; nested `=Math.max(Math.ceil(1.1), 1)` → 2 |
| T5 | same — allowlist and arity errors | `=Math.sqrt(4)` → `unsupported function 'Math.sqrt'`; `=Math.random()` → unsupported; `=math.ceil(1)` → unsupported; `=abc` → `unknown identifier 'abc'`; `=Math.ceil` (no parentheses) → `unknown identifier 'Math.ceil'`; `=abc(1)` → `unsupported function 'abc'`; `=Math.pow(2)` → `Math.pow expects 2 arguments, got 1`; `=Math.ceil(1,2)` → expects 1, got 2; `=Math.min()` → at least 1, got 0; `=2**3` → parse error; `=1 2` → `unexpected token`; `=(1` → `unexpected end of expression`; `=1+` → unexpected end; `=` → `expression is empty`; `=1 ^ 2` → `unexpected character '^'` |
| T6 | same — placeholder resolution | `{SP: 5}`, `=Math.ceil({SP}*2)` → 10; `={SP}+{SP}` → 10; string `"3"` → 3; string `" 2.5 "` → 2.5; absent → `parent field 'X' is missing`; `null` → `is empty`; `""` → `is empty`; `"abc"` → `parent field 'X' value 'abc' is not numeric`; `true` → `value 'true' is not numeric`; a 60-character non-numeric string → reason contains its first 40 characters followed by `…` and not the full string; `{}` → `empty field reference`; `={SP` → `unterminated field reference`; `={A{B}` → `unexpected character '{' at index 2`; field name with dots and spaces resolves verbatim (`{Custom.My Field}`) |
| T7 | same — non-finite results | `=1/0`, `=0/0`, `=5%0`, `=Math.pow(10,400)` → `result is not a finite number`; `=Math.min(1/0, 1)` → 1 (only the final value is checked) |
| T8 | `tests/templateFilters.test.ts` — `replaceReferenceToParentField` | `"Fix for {System.Title}"` → substituted; `"{A}+{A}"` → both resolved; numeric parent → stringified (`"SP: 5"`); missing field → output contains literal `undefined` **and** `console.error` called once with a message containing the field name and `missing`; `"{A}+{A}"` with `A` missing → `"undefined+undefined"` and `console.error` called exactly twice; `null` field → literal `null` and message contains `null`; `"abc}"` (stray `}`) → returned unchanged and `console.error` not called; value without placeholders → returned unchanged and no log |
| T9 | `tests/templateBuilder.test.ts` — `createWorkItemFromTemplate` | template `{ "Microsoft.VSTS.Scheduling.StoryPoints": "=Math.ceil({Microsoft.VSTS.Scheduling.StoryPoints}*2)", "System.Title": "Fix for {System.Title}" }` with parent `{ StoryPoints: 2.5, Title: "Bug" }` → `patchDocument` contains `value: 5` (typeof number) and `value: "Fix for Bug"`, `skippedFields` empty; failing expression → no patch entry for that path, `skippedFields === [key]`, `console.error` message contains template name, field name, raw expression and reason; two failing fields → both listed in order; `=` on `System.Title` evaluates to a number (any-field rule); failing `=` on `System.Title` → no `/fields/System.Title` entry in `patchDocument` (no parent-title backfill) and `skippedFields === ["System.Title"]`; non-`=` values and `""` inheritance produce the same entries as before; `@me`/`@currentiteration` values still bypass the loop (test with `ctxState.setCtx` stub for `@me`) |
| T10 | `tests/progressDialogController.test.ts` — `formatCompletionMessage` | no warnings → unchanged line; one created outcome with 1 skipped → `Warnings: Task A (1 field skipped)`; two outcomes 1 and 2 → `Task A (1 field skipped), Task B (2 fields skipped)`; failed + warnings → `. Failed: Task C. Warnings: ...` ordering; multiple work items → one line each joined by `\n` |

`npm test` (run from `src/`) must pass with zero failures; `npm run build` must still succeed and `build/scripts/app.js` must not contain any test code.

### F. Documentation

**R19. README.md and src/overview.md** (must remain byte-identical; `overview.md` is the Marketplace details page):
1. New `## Field values: placeholders and expressions ##` section inserted between `## What's New ##` and `## Filtering templates ##`, containing:
   - A short table of the special value forms: empty (inherit parent value), `@me`, `@currentiteration`, `{Field.Reference.Name}` text substitution (pre-existing, previously undocumented), and `=` expressions.
   - `### Expressions ###`: the `=` rule (whitespace tolerated, no escape for a literal leading `=`); the supported grammar in prose (numbers incl. decimals, `+ - * / %`, unary minus, parentheses, `{Field}` references, `Math.ceil/floor/round/abs/min/max/pow`, standard precedence); an examples table, e.g. `=Math.ceil({Microsoft.VSTS.Scheduling.StoryPoints}*2)`, `={Microsoft.VSTS.Scheduling.Effort}/2`, `=Math.max({Microsoft.VSTS.Scheduling.StoryPoints}-1, 1)`, `=Math.round({Microsoft.VSTS.Scheduling.StoryPoints}*0.3)`.
   - "Referenced parent fields must hold a number (or numeric text); anything else skips the field."
   - **Integer fields advice**: fields such as Priority or Business Value only accept whole numbers — wrap the expression in `Math.round`, `Math.ceil` or `Math.floor`, otherwise Azure DevOps rejects the child and the template is reported as failed.
   - Failure behaviour: the field is skipped, the child is still created, the completion dialog lists `Warnings: <template> (N fields skipped)`, and the reason is in the browser console (F12) prefixed `linked-tasks-automation:`. If the skipped field is required by the work item type (e.g. an expression on Title), Azure DevOps rejects the child and the template is reported as Failed; the console still shows the expression error.
   - Tip: templates are cached for 4 hours; clear `localStorage` keys starting with `linkedTasksAutomation.templateCache.` to pick up template edits immediately.
2. `## What's New ##`: add a bullet **Arithmetic expressions in template fields** linking to the new section; change "15 focused files" to "16 focused files".
3. `## Project Structure ##` table: add the row `expressionEvaluator.ts` — "Allowlisted arithmetic evaluator for `=`-prefixed template values (`{Field}` placeholders, `Math.*` subset)" after the `templateBuilder.ts` row.
4. `## Usage ##`: add step `4. npm test to run the unit tests`; replace the closing line "There is no automated test suite yet; changes are verified manually against a live Azure DevOps org." with a `### Tests ###` subsection: "`npm test` (from `src/`) runs the Jest unit tests in `src/tests/` covering the expression evaluator, placeholder substitution, template building and completion-dialog wording. Behaviour against a live Azure DevOps org is still verified manually."

**R20. `.maister/docs/project/roadmap.md`:** Current State versions → `1.3.0` for both files ("aligned 2026-08-27"); Key Features gains "`=` arithmetic expressions in template field values (allowlisted `Math.*` subset, parent-field placeholders)"; Recent Updates gains a sentence pointing to this task folder; Phase 2 "Feature backlog" gets a checked sub-item for this feature; "Automated tests" becomes `[x]` with the note "Jest + ts-jest added (2026-08-27): evaluator, placeholder substitution, template builder, dialog wording" and a new `[ ]` item "Extend Jest coverage to template filtering (`IsValidTemplateWIT` and friends)"; Technical Debt "No automated tests" is reworded to "Partial test coverage — template filtering, caching and REST transport untested"; Future Considerations gains "Feature ideas: escape syntax for a literal leading `=`; field-type-aware rounding for integer fields; `**`/comparison operators if requested". Also update `.maister/docs/project/tech-stack.md` "Testing" line to "Jest 29 + ts-jest (`npm test`), tests in `src/tests/`" and the "Version Management" paragraph to state both manifests read `1.3.0`. Additionally:
- `.maister/docs/INDEX.md`: update the Roadmap one-liner (`INDEX.md:23`) so the technical-debt parenthetical reads "partial test coverage (Jest), no CI/CD, no CONTRIBUTING.md" and the versions are described as aligned; update the Tech Stack one-liner (`INDEX.md:26`) to mention "Jest 29 + ts-jest unit tests" (the "no CI/CD or linting" wording stays true).
- `roadmap.md` Technical Debt item "Decide `src/scripts/app.js`'s version-control status" (`roadmap.md:30`): mark `[x]` and reword to record that commit `551aa91` committed `src/scripts/app.js` as a tracked legacy artifact (stale compiled output, not edited by this task).

### G. Versioning (final step)

**R21.** After all code, tests and docs are done: set `"version": "1.3.0"` in both `src/vss-extension.json` (currently `1.2.8` at HEAD `551aa91`) and `src/package.json` (currently `1.1.17`), then run `npm install --package-lock-only` from `src/` so that `src/package-lock.json` (root `version` at lines 3 and 9, currently `1.1.17`) also reads `1.3.0`. Nothing else in either manifest changes. This must be the last implementation step.

## Reusable Components

### Existing Code to Leverage
| Component | Path | How it is used |
|---|---|---|
| `logError` / `logInfo` | `src/scripts/logging.ts` | All new logging (R10, R14); no new logging helper |
| `WorkItemFields` | `src/scripts/types.ts:14` | Type of `currentWorkItem` passed to the evaluator and of the patch document; `value: any` already accepts a `number` |
| `IsPropertyValid` | `src/scripts/templateFilters.ts:177-192` | Unchanged gate in front of the `=` branch; keeps `System.Tags`/`@me`/`@currentiteration` out |
| `replaceReferenceToParentField` | `src/scripts/templateFilters.ts:194-205` | Still the path for every non-`=` value; only gains a log call |
| `createWorkItemFromTemplate` loop | `src/scripts/templateBuilder.ts:11-27` | The `=` branch is added inside the existing `else`; the empty-value inheritance branch and defaults block are reused as-is |
| `TemplateOutcome` / `showCompletionDialog` | `src/scripts/progressDialogController.ts:12-17, 58-86` (HEAD `551aa91`) | Extended with `skippedFields` and the `Warnings:` suffix; no new dialog, no new dialog service call |
| `createWorkItem` outcome mapping | `src/scripts/workItemCreation.ts:144-149` | The `created` outcome literal gains `skippedFields`; error path unchanged |
| `keepaliveFetchClient.createWorkItem` | `src/scripts/keepaliveFetchClient.ts` | Unchanged; `JSON.stringify` serialises the numeric value correctly |
| Build pipeline | `src/gruntfile.js`, `src/bundle-scripts.js`, `src/tsconfig.json` | Unchanged; the RequireJS optimizer inlines `expressionEvaluator.ts` because `templateBuilder.ts` imports it |
| SDK typings | `src/node_modules/vss-web-extension-sdk/typings/tfs.d.ts` | Referenced from `tsconfig.test.json` `files` so type-only `TFS/*` imports resolve under Jest |
| `/// <reference path=...>` precedent | `src/scripts/app.ts:1-2` | Fallback pattern for the test files if ts-jest fails to seed the typings |

### New Components Required
| Component | Why existing code cannot be reused |
|---|---|
| `src/scripts/expressionEvaluator.ts` | Nothing in the codebase tokenizes, parses or evaluates anything; `matchField` (`templateFilters.ts:75-109`) is string equality only. An npm parser is impractical: the RequireJS optimizer config (`bundle-scripts.js:32-39`) inlines only `build/scripts/*` and the minimal-dependency convention applies. |
| `BuiltWorkItem` return type (`templateBuilder.ts`) | The builder currently has no way to report "processed this key but pushed nothing"; the caller needs the list to build the outcome (R11). |
| `formatCompletionMessage` (`progressDialogController.ts`) | Message assembly is currently inline in a function that calls the `VSS` global; extracting it is the minimal change that makes the dialog wording testable. It has an immediate caller. |
| `src/jest.config.js`, `src/tsconfig.test.json`, `src/tests/*.test.ts` | No test infrastructure exists; the production `tsconfig.json` emits AMD, which Jest cannot execute. |

## Technical Approach

**Data flow (one template field):**
```
template.fields[key] (string, from ADO template API)
  -> IsPropertyValid(key)                       templateFilters.ts:177   (unchanged)
  -> '' ? inherit parent value                  templateBuilder.ts:14-18 (unchanged)
  -> isExpression(value) ?                      expressionEvaluator.ts   (new)
       yes -> evaluateExpression(value, currentWorkItem)
                ok    -> push { op:"add", path:"/fields/"+key, value:<number> }
                error -> logError(R10); skippedFields.push(key)
       no  -> replaceReferenceToParentField -> push string  (unchanged)
  -> { patchDocument, skippedFields }           templateBuilder.ts (R8)
  -> keepaliveFetch.createWorkItem(patchDocument)             (unchanged)
  -> outcome { templateName, status:"created", skippedFields? } workItemCreation.ts (R11)
  -> formatCompletionMessage -> showCompletionDialog          progressDialogController.ts (R13)
```

**Evaluator internals (guidance, not code):** a hand-rolled tokenizer producing the token kinds in R3 with their index, and a recursive-descent parser with one function per grammar rule in R4 that returns numbers directly (evaluation during parsing, no AST). Placeholder lookup happens in `primary` when a `FIELD` token is consumed. All internal failures raise one module-private typed error carrying the reason string; `evaluateExpression` wraps the parse in a single `try/catch`, maps that error to `{ ok: false, reason }`, maps anything else to `unexpected error: <message>`, and applies the `Number.isFinite` check to the successful value. No state is shared between calls. Target `ES2015`, `strict: true`, camelCase names, named exports, `const`/`let`, explicit return types on exports, JSDoc only on the exported functions explaining why (not what).

**Type widening:** `templateBuilder.ts`'s loop pushes either a `string` or a `number` into `WorkItemFields` (`value: any`), so no type change is needed in `types.ts`.

**Transport:** unchanged. A native JavaScript `number` serialises as a JSON number via `JSON.stringify` in `keepaliveFetchClient.ts`; Azure DevOps accepts it for Double fields and validates Integer fields itself (400 → existing `failed` path).

**Consistency with gap analysis:** matches integration points 1-9 in `analysis/gap-analysis.md`; the only additions are the `BuiltWorkItem` return shape and `formatCompletionMessage`, both required by the Phase 2 scope expansion (`failure-visibility`).

## Implementation Guidance

### Testing Approach
- 2-8 focused tests per implementation step group; the case list in R18 is the source of truth and may be split across groups as the planner sees fit (T1-T7 evaluator, T8 filters, T9 builder, T10 dialog).
- Test verification runs only the new tests (`npm test` from `src/`), never the entire suite as a separate step — there is no other suite.
- Tests assert behaviour (result values, `ok`/`reason`, patch entries, message strings), never tokenizer/parser internals.
- `console.error` is spied with `jest.spyOn(console, "error").mockImplementation(() => {})` and restored after each test; no other mocking is required (the modules under test have no I/O). `templateBuilder.test.ts` passes `{} as any` for `teamSettings` unless testing `@currentiteration`.
- Every test file must compile under `strict: true` via ts-jest; type errors fail the run.

### Standards Compliance
- `standards/global/validation.md` — allowlist grammar and function table (allowlists over blocklists); fail fast on the first invalid token; specific, field-level reasons.
- `standards/global/error-handling.md` — one typed internal error, caught at the module boundary; graceful degradation (skip field, create child); clear user-facing dialog wording with no internals; console messages carry the actionable detail.
- `standards/global/minimal-implementation.md` — no AST, no visitor, no configurable operator tables, no `Math` functions beyond the seven required, no escape syntax, no field-type lookup; every new export has an immediate caller.
- `standards/global/coding-style.md` and `commenting.md` — camelCase, focused single-purpose functions per grammar rule, no dead or commented-out code added, timeless JSDoc on exports only, 4-space indentation.
- `standards/global/conventions.md` — README kept current (R19); `package.json` stays `private`, minimal new devDependencies (three, all test-only).
- `standards/testing/test-writing.md` — behaviour-focused, descriptive names, fast pure unit tests, risk-based depth (parser edge cases get the most cases).
- `standards/build-tooling/packaging.md` — release versions bumped manually (R21); manifest `files`/contribution entries untouched; `package.json` name still matches the manifest id.

## Out of Scope
- `**`, unary `+`, comparison/ternary/logical operators, string literals or concatenation, variables, `Math` functions beyond the seven listed, exponent number literals (`1e3`).
- Escape syntax for a literal field value starting with `=`.
- Field-type lookup (`_apis/wit/fields`) or automatic rounding for integer fields.
- Any change to the output of `replaceReferenceToParentField` for non-`=` values (including the `undefined`/`null` splice and the regex).
- Showing field names or expressions in the completion dialog; any new dialog or UI.
- Changes to `src/scripts/app.js` (tracked legacy artifact, stale compiled output committed in `551aa91` — do not edit), `toolbar.html`, `bundle-scripts.js`, `gruntfile.js`, `tsconfig.json`, `vss-extension.json` (other than the version).
- CI/CD, linting, the `bugsBehavior` bug, the `'init v0.0.1'` log line, deleting `src/scripts/app.js`.
- Tests for template filtering, caching, REST transport, orchestrator (tracked in the roadmap as follow-up).

## Success Criteria
1. `npm test` (from `src/`) passes with all cases in R18 green; `npm run build` succeeds and `build/scripts/app.js` contains the evaluator but no test code.
2. `evaluateExpression("=Math.ceil({Microsoft.VSTS.Scheduling.StoryPoints}*2)", { "Microsoft.VSTS.Scheduling.StoryPoints": 2.5 })` returns `{ ok: true, value: 5 }`; the builder emits `{ op: "add", path: "/fields/Microsoft.VSTS.Scheduling.StoryPoints", value: 5 }` with `typeof value === "number"`.
3. Every failure class in R3-R7 yields `{ ok: false, reason }` with the specified reason text; the module never throws and never calls `eval`/`new Function`: `grep -nE '\beval\s*\(|new\s+Function\b' src/scripts/expressionEvaluator.ts` returns nothing (the exported name `evaluateExpression` does not match this pattern).
4. A template with one failing expression still creates the child; the console shows exactly one `logError` in the R10 format; the completion dialog line ends with `. Warnings: <template> (1 field skipped)`; templates without skipped fields produce a byte-identical dialog line to today.
5. Any non-`=` template value produces the same patch entry as before this change (T8/T9 pin this).
6. `README.md` and `src/overview.md` are byte-identical (`diff` empty) and contain the new section, the Project Structure row, and the `npm test` instructions; `roadmap.md` and `tech-stack.md` reflect the feature, tests and `1.3.0`.
7. `src/vss-extension.json` and `src/package.json` both read `"version": "1.3.0"`, and `src/package-lock.json` reads `"version": "1.3.0"` at both its root and `packages[""]` entries (after `npm install --package-lock-only`).
8. Manual verification in a live org (clear `linkedTasksAutomation.templateCache.*` first): Double field with `=Math.ceil({Microsoft.VSTS.Scheduling.StoryPoints}*2)` → correct value; Integer field with `={Microsoft.VSTS.Common.Priority}/2` on a parent whose Priority is **3** (so the result is the non-integer 1.5) → template `Failed` (400) as expected and documented; expression referencing an unset parent field → child created without that field, console error, dialog warning; a title `Fix for {System.Title}` → unchanged behaviour.

## Known Limitations
- Only the final result is checked for finiteness, so intermediate non-finite values that are absorbed (e.g. `Math.min(1/0, 1)`) evaluate successfully — consistent with JavaScript semantics and not worth extra machinery.
- Numeric-string acceptance uses JavaScript's `Number()`, so `"0x10"` or `"1e3"` stored in a text field convert (16, 1000); `"Infinity"` is rejected by the finite check.
- "The child is still created" holds only when the skipped field is optional for the work item type. If the skipped field is required (e.g. `=expr` on `System.Title`), the builder pushes nothing for it and does not backfill the parent value, so Azure DevOps rejects the child (HTTP 400) and the template is reported as `Failed` (not `Warnings`); the console still shows the R10 expression error. Documented in R19; no field-type lookup is added (Out of Scope).
- `replaceReferenceToParentField` cannot include the template name in its log (its signature has no template), so its message identifies the template value instead; the builder's R10 message covers the `=` case with full context.
