# Implementation Plan: Arithmetic Expressions in Template Field Values

## TL;DR
Eight task groups, dispatched in five waves: (1) Jest/ts-jest harness first, proved by three baseline `replaceReferenceToParentField` tests; then (2) the evaluator, (3) substitution-helper logging and (4) outcome type + dialog wording in parallel — none of the three touch each other's files; (5) builder integration plus the `workItemCreation.ts` caller once all three land; then (6) build verification + test gap review and (7) documentation in parallel; (8) the `1.3.0` version alignment last. 27 test blocks (T1-T7 are `test.each` tables carrying the full R18 case list) plus up to 10 gap tests; every R1-R21 / T1-T10 item is mapped in the coverage matrix at the end.

## Key Decisions
- T8's three behaviour-pinning cases are written in Group 1, before any production change — they double as the harness proof (a module importing `TFS/*` types compiles under ts-jest) and as the "non-`=` output is byte-identical" baseline every later group must keep green.
- Evaluator tests (T1-T7) are seven `test.each` blocks, one per spec table, rather than 66 individual `test` calls — keeps the 2-8-tests-per-group rule at the block level while covering every R18 row verbatim.
- `TemplateOutcome.skippedFields` (R12) and `formatCompletionMessage` (R13) are their own group, independent of the evaluator — the `created` outcome literal in `workItemCreation.ts` (R11) needs the widened type to compile under `strict`, so Group 5 depends on Group 4 and is the only group that edits `workItemCreation.ts`.
- `replaceReferenceToParentField` logging (R14) is separated from the builder group — different file, no shared state, and it lets Wave 2 run three groups concurrently.
- Build verification and the test gap review are one group — both are read-mostly checks over the finished code and both must pass before docs claim "`npm test` covers X".
- Documentation (Group 7) depends on Group 5, not on Group 6 — its content is fully specified by R19/R20 and does not need the build check; running it alongside Group 6 shortens the critical path.

## Open Questions / Risks
- Group 1 needs one `npm install` with network access to pull Jest 29 / ts-jest 29 / @types/jest 29; if the registry is unreachable the whole plan stalls at Wave 1.
- `src/package-lock.json` is rewritten twice (Group 1 `npm install`, Group 8 `npm install --package-lock-only`); both groups declare it so the executor serializes them — do not hand-edit the lock file.
- Group 7 writes `1.3.0` into `roadmap.md` / `tech-stack.md` before Group 8 sets it in the manifests; the repo is only consistent once Wave 5 completes, so Group 8 must not be skipped or deferred.
- ts-jest emits hint TS151001 (`esModuleInterop`) as a warning; it must be left as a warning — enabling the flag breaks `childTypes.ts` / `templates.ts` (TS2349, proved in the spec audit). Optional silence: `diagnostics: { ignoreCodes: [151001] }`.
- `grunt package-dev` is broken on Node v22 (`--rev-version`); verification uses `npx grunt build` only. No live Azure DevOps org is available, so success criterion 8 stays a manual checklist.
- Integer-typed target fields (Priority, Business Value) reject non-integer results with HTTP 400 and show as `Failed` — mitigated by documentation (R19) only.

## Overview
Total Steps: 35 implementation steps (plus 8 group-level parent steps) across 8 groups
Task Groups: 8
Expected Tests: 27 test blocks in Groups 1-5 (3 + 7 + 5 + 5 + 7; the seven evaluator blocks are `test.each` tables with 66 rows) + up to 10 additional in Group 6 = 27-37 blocks
Baseline: HEAD `551aa91`; `src/scripts/app.js` is a tracked legacy artifact and is NEVER edited. All commands run from `src/` unless stated.

## Execution Waves (dispatch order)

| Wave | Groups | Why they can run together |
|---|---|---|
| 1 | Group 1 | Everything needs the harness |
| 2 | Group 2, Group 3, Group 4 | Disjoint files: `expressionEvaluator.ts` / `templateFilters.ts` / `progressDialogController.ts` and one test file each |
| 3 | Group 5 | Needs the evaluator (2), the pinned substitution behaviour (3) and the widened `TemplateOutcome` (4) |
| 4 | Group 6, Group 7 | Verification touches only `tests/`; docs touch only markdown |
| 5 | Group 8 | Must be last (R21) |

## Implementation Steps

### Task Group 1: Test Infrastructure (Jest + ts-jest)
**Dependencies:** None
**Files to Modify:** `src/package.json`, `src/package-lock.json`, `src/jest.config.js` (new), `src/tsconfig.test.json` (new), `src/tests/templateFilters.test.ts` (new)
**Requirements:** R15, R16, R17, R18 (location rule), T8 (baseline cases)
**Complexity:** Medium — small files, but the tooling combination (AMD production tsconfig, ambient `TFS/*` typings, no `esModuleInterop`) is the one place the spec audit found a real defect.
**Standards to load:** `.maister/docs/standards/global/conventions.md`, `.maister/docs/standards/global/minimal-implementation.md`, `.maister/docs/standards/testing/test-writing.md`, `.maister/docs/standards/build-tooling/packaging.md`
**Estimated Steps:** 5

- [x] 1.0 Stand up the first test runner in the repository
  - [x] 1.1 Write 3 baseline tests in `src/tests/templateFilters.test.ts` for `replaceReferenceToParentField` (T8, pre-existing behaviour only, no `console.error` assertions yet)
    - `"Fix for {System.Title}"` with parent `{ "System.Title": "Bug" }` → `"Fix for Bug"`
    - `"{A}+{A}"` with `{ A: 5 }` → `"5+5"` (both occurrences resolve)
    - `"SP: {Microsoft.VSTS.Scheduling.StoryPoints}"` with numeric parent `5` → `"SP: 5"` (numeric stringification)
    - Import with a relative path: `import { replaceReferenceToParentField } from "../scripts/templateFilters";` — this proves ts-jest compiles a module whose `TFS/*` imports are type-only and elided
    - Do NOT import any `TFS/*` module in value position from a test (it would `require()` an ambient module at runtime)
  - [x] 1.2 Add tooling to `src/package.json` (R15) and install
    - devDependencies: `"jest": "^29.7.0"`, `"ts-jest": "^29.2.5"`, `"@types/jest": "^29.5.14"` — keep alphabetical placement within the existing block
    - scripts: `"test": "jest"` — leave `generate-cert`, `build`, `serve` untouched; do not change `name`, `private`, or `version` (version is Group 8)
    - Run `npm install` from `src/` (needs network); confirm `node_modules/jest`, `node_modules/ts-jest` exist afterwards
  - [x] 1.3 Create `src/jest.config.js` (R16, CommonJS `module.exports`)
    - `preset: "ts-jest"`, `testEnvironment: "node"`, `testMatch: ["<rootDir>/tests/**/*.test.ts"]`
    - `transform: { "^.+\\.ts$": ["ts-jest", { tsconfig: "tsconfig.test.json" }] }`
    - Optional only: `diagnostics: { ignoreCodes: [151001] }` inside the ts-jest options to silence the interop hint
  - [x] 1.4 Create `src/tsconfig.test.json` (R17)
    - `"extends": "./tsconfig.json"`; `compilerOptions`: `"module": "commonjs"`, `"types": ["jest"]`, `"noEmit": true` — nothing else; **never set `esModuleInterop`** (TS2349 in `childTypes.ts:24` / `templates.ts:16`)
    - `"include": ["scripts/**/*.ts", "tests/**/*.ts"]`
    - `"files": ["node_modules/vss-web-extension-sdk/typings/tfs.d.ts"]`
    - Do not touch `tsconfig.json`, `gruntfile.js`, `bundle-scripts.js`, `vss-extension.json`
  - [x] 1.5 Ensure the harness gate passes
    - `npx tsc --noEmit -p tsconfig.test.json` exits 0 with no diagnostics
    - `npm test` → 1 suite, 3 tests passing; ts-jest may print the TS151001 hint (acceptable)
    - `git status` shows no files under `build/`, no change to `tsconfig.json` / `gruntfile.js`; `src/tests/` is outside `scripts/**` so the production tsconfig never sees it
    - Fallback if `Cannot find module 'TFS/WorkItemTracking/Contracts'` appears: add `/// <reference path="../node_modules/vss-web-extension-sdk/typings/tfs.d.ts" />` at the top of the affected test file (precedent `app.ts:1-2`)

**Acceptance Criteria:**
- The 3 tests pass via `npm test`; `npx tsc --noEmit -p tsconfig.test.json` exits 0
- `src/package.json` has exactly the three new devDependencies and the `test` script; `package-lock.json` updated by npm, not by hand
- `tsconfig.test.json` contains no `esModuleInterop`; `noEmit: true` present

---

### Task Group 2: Expression Evaluator Module
**Dependencies:** 1
**Files to Modify:** `src/scripts/expressionEvaluator.ts` (new), `src/tests/expressionEvaluator.test.ts` (new)
**Requirements:** R1, R2, R3, R4, R5, R6, R7; T1, T2, T3, T4, T5, T6, T7
**Complexity:** High — the only non-trivial code in the task; ~66 pinned behaviours with exact reason strings.
**Standards to load:** `.maister/docs/standards/global/validation.md`, `.maister/docs/standards/global/error-handling.md`, `.maister/docs/standards/global/minimal-implementation.md`, `.maister/docs/standards/global/coding-style.md`, `.maister/docs/standards/global/commenting.md`, `.maister/docs/standards/testing/test-writing.md`
**Estimated Steps:** 5

- [x] 2.0 Deliver the pure, allowlisted evaluator
  - [x] 2.1 Write 7 `test.each` blocks in `src/tests/expressionEvaluator.test.ts`, one per spec table (R18 rows are the parameter tables, verbatim)
    - T1 `isExpression`: 8 rows (`"=1"`, `" =1"`, `"= 1"`, `"="` true; `"x=1"`, `"Fix: 2+2"`, `""`, `"{A}"` false)
    - T2 literals/precedence: 9 rows (`=2`, `=0.5`, `=.5`, `=1+2*3`→7, `=(1+2)*3`→9, `=10-4-3`→3, `=7%3`→1, `=8/2/2`→2, `= 2 * 3 `→6)
    - T3 unary minus: 6 rows (`=-2`, `=2*-3`→-6, `=--3`→3, `=2 - -3`→5, `=-(1+2)`→-3, `=+2`→`unexpected token '+' at index 0`)
    - T4 Math functions: 8 rows (ceil/floor/round/abs/min/max/pow + nested `=Math.max(Math.ceil(1.1), 1)`→2)
    - T5 allowlist/arity/syntax errors: 15 rows with exact reasons (`unsupported function 'Math.sqrt'`, `unknown identifier 'abc'`, `unknown identifier 'Math.ceil'`, `unsupported function 'abc'`, `Math.pow expects 2 arguments, got 1`, `Math.ceil expects 1 argument, got 2`, `Math.min expects at least 1 argument, got 0`, `=2**3` parse error, `=1 2` → `unexpected token`, `=(1` / `=1+` → `unexpected end of expression`, `=` → `expression is empty`, `=1 ^ 2` → `unexpected character '^' at index 2`)
    - T6 placeholders: 15 rows (`{SP: 5}` → `=Math.ceil({SP}*2)`→10, `={SP}+{SP}`→10, `"3"`→3, `" 2.5 "`→2.5, missing → `parent field 'X' is missing`, `null`/`""` → `is empty`, `"abc"`/`true` → `value '...' is not numeric`, 60-char string → first 40 chars + `…` and NOT the full string, `{}` → `empty field reference`, `={SP` → `unterminated field reference`, `={A{B}` → `unexpected character '{' at index 2`, `{Custom.My Field}` resolves verbatim)
    - T7 non-finite: 5 rows (`=1/0`, `=0/0`, `=5%0`, `=Math.pow(10,400)` → `result is not a finite number`; `=Math.min(1/0, 1)`→1)
    - Assert on `result` shape: `toEqual({ ok: true, value: n })` / `toEqual({ ok: false, reason: "..." })`; where the spec says "parse error"/"unexpected token" without a full string, assert `ok === false` and `reason` `toMatch(/^unexpected token/)` etc.
  - [x] 2.2 Create `src/scripts/expressionEvaluator.ts` — public surface and tokenizer (R1, R2, R3)
    - Exports exactly: `isExpression(fieldValue: string): boolean`, `evaluateExpression(fieldValue: string, currentWorkItem: WorkItemFields): EvaluationResult`, `type EvaluationResult = { ok: true; value: number } | { ok: false; reason: string }`
    - Only import: `import { WorkItemFields } from "./types";` (type-only). No `./logging` import — the module never logs, never throws to callers
    - One module-private error class carrying the reason string (e.g. `class ExpressionError extends Error`) — the single typed exception per `error-handling.md`
    - Tokenizer over the trimmed body with 0-based `index` on every token: whitespace skipped; `NUMBER` (`digits[.digits]` or `.digits`, no exponent, no sign, `1.` rejected); `FIELD` (`{` … `}` with `empty field reference at index i`, `unterminated field reference at index i`, inner `{` → `unexpected character '{' at index i` where i is the inner brace); `IDENT` `[A-Za-z_][A-Za-z0-9_.]*`; `OP` `+ - * / %`; `LPAREN` `RPAREN` `COMMA`; `END`; anything else → `unexpected character 'c' at index i`
  - [x] 2.3 Recursive-descent parser evaluating during parse (R4, R5)
    - One function per EBNF rule: `parseExpression` (additive then expect `END` else `unexpected token 'x' at index i`), `parseAdditive`, `parseMultiplicative`, `parseUnary` (right-assoc minus), `parsePrimary`, `parseCall`
    - `parsePrimary` on `IDENT`: next token `(` → call path; check the name against the seven-entry allowlist BEFORE parsing arguments → `unsupported function '<ident>'`; not followed by `(` → `unknown identifier '<ident>'`
    - Allowlist dispatch is explicit (`switch`/object literal of the seven names → `Math.ceil`, … ); arity errors exactly per R5 table (`expects 1 argument, got N`, `expects 2 arguments, got N`, `expects at least 1 argument, got 0`); names case-sensitive
    - Premature `END` anywhere a token is required → `unexpected end of expression`
  - [x] 2.4 Placeholder resolution and the boundary (R6, R7)
    - In `parsePrimary` on `FIELD`: `v = currentWorkItem[name]`; finite `number` → v; string with non-empty trim and finite `Number(v)` → `Number(v)`; `undefined` → `parent field 'n' is missing`; `null`, `""`, whitespace-only → `parent field 'n' is empty`; anything else → `parent field 'n' value '<shown>' is not numeric` with `<shown>` = `String(v)` cut to 40 chars + `…` (U+2026) when longer
    - `evaluateExpression`: if `!isExpression` → `{ ok: false, reason: "value is not an expression" }`; empty body → `expression is empty`; single `try/catch` maps `ExpressionError` → `{ ok: false, reason }`, any other throw → `unexpected error: <message>`; success value must pass `Number.isFinite` else `result is not a finite number`
    - No shared mutable state between calls; `const`/`let`; explicit return types on exports; JSDoc on the two exported functions only (why, not what); 4-space indent
  - [x] 2.5 Ensure the evaluator tests pass
    - `npx jest tests/expressionEvaluator.test.ts` → 7 blocks / 66 rows green
    - `grep -nE '\beval\s*\(|new\s+Function\b' scripts/expressionEvaluator.ts` → no output
    - `grep -n "logging\|console\." scripts/expressionEvaluator.ts` → no output
    - `npx tsc --noEmit -p tsconfig.test.json` exits 0

**Acceptance Criteria:**
- All 7 `test.each` blocks (66 rows) pass; the R18 tables are reproduced row-for-row in the test file
- `evaluateExpression("=Math.ceil({Microsoft.VSTS.Scheduling.StoryPoints}*2)", { "Microsoft.VSTS.Scheduling.StoryPoints": 2.5 })` → `{ ok: true, value: 5 }` (success criterion 2)
- Module has three exports only, one import (`./types`), no `eval`/`new Function`, no logging, no AST types

---

### Task Group 3: Substitution Helper Observability
**Dependencies:** 1
**Files to Modify:** `src/scripts/templateFilters.ts`, `src/tests/templateFilters.test.ts`
**Requirements:** R14; T8 (logging cases)
**Complexity:** Low — a guarded `logError` call; the returned string must stay byte-identical (Group 1's three baseline tests pin it).
**Standards to load:** `.maister/docs/standards/global/error-handling.md`, `.maister/docs/standards/global/coding-style.md`, `.maister/docs/standards/global/commenting.md`, `.maister/docs/standards/testing/test-writing.md`
**Estimated Steps:** 3

- [x] 3.0 Make unresolved `{Field}` placeholders visible in the console without changing output
  - [x] 3.1 Add 5 logging tests to `src/tests/templateFilters.test.ts` (T8 remaining cases)
    - Spy: `jest.spyOn(console, "error").mockImplementation(() => {})` in `beforeEach`, `mockRestore()` in `afterEach`
    - `"SP: {X}"` with `X` absent → returns `"SP: undefined"` AND `console.error` called once with a message containing `'X'` and `missing`
    - `"{A}+{A}"` with `A` absent → `"undefined+undefined"` AND `console.error` called exactly twice
    - `"{X}"` with `X: null` → `"null"` AND message contains `null`
    - `"abc}"` (stray `}`) → returned unchanged AND `console.error` not called
    - `"plain text"` (no placeholders) → returned unchanged AND `console.error` not called
  - [x] 3.2 Modify `replaceReferenceToParentField` (`templateFilters.ts:194-205`) per R14
    - `logError` is already imported at `templateFilters.ts:2` — no new import
    - Inside the existing loop, before the unchanged `replace` call: `if ((parentValue === undefined || parentValue === null) && fieldValue.indexOf('{' + parentField + '}') >= 0)` → `logError("Parent field '" + parentField + "' referenced in template value '" + originalValue + "' is " + (parentValue === undefined ? "missing" : "null") + "; substituting the literal text '" + String(parentValue) + "'")` where `originalValue` is captured from the parameter before the loop mutates `fieldValue`
    - Do not change the regex, the first-occurrence `replace`, the signature, or numeric stringification; one log per regex match
  - [x] 3.3 Ensure the substitution tests pass
    - `npx jest tests/templateFilters.test.ts` → 8 tests green (3 baseline + 5 logging)
    - `npx tsc --noEmit -p tsconfig.test.json` exits 0

**Acceptance Criteria:**
- 8 tests pass; the 3 baseline outputs are unchanged
- Exactly one `logError` per placeholder occurrence whose parent value is `undefined`/`null` and whose `{name}` literally occurs in the value; stray-`}` matches log nothing

---

### Task Group 4: Outcome Type and Completion Dialog Wording
**Dependencies:** 1
**Files to Modify:** `src/scripts/progressDialogController.ts`, `src/tests/progressDialogController.test.ts` (new)
**Requirements:** R12, R13; T10
**Complexity:** Low — extract-and-extend of an existing 12-line message assembly.
**Standards to load:** `.maister/docs/standards/global/coding-style.md`, `.maister/docs/standards/global/commenting.md`, `.maister/docs/standards/global/error-handling.md`, `.maister/docs/standards/testing/test-writing.md`
**Estimated Steps:** 4

- [x] 4.0 Surface skipped fields as dialog warnings
  - [x] 4.1 Write 5 tests in `src/tests/progressDialogController.test.ts` for `formatCompletionMessage` (T10)
    - Import `{ formatCompletionMessage, TemplateOutcome }` from `../scripts/progressDialogController` — the `VSS` global is only touched inside the dialog functions, so the import is safe under Jest
    - No warnings/failures: `[{ workItemId: 123, outcomes: [created, created, created] }]` → message ends with `Work item #123: 3 tasks of 3 templates created` (byte-identical to today's line)
    - One created outcome with `skippedFields: ["F"]` → line ends with `. Warnings: Task A (1 field skipped)`
    - Two outcomes with 1 and 2 skipped → `. Warnings: Task A (1 field skipped), Task B (2 fields skipped)`
    - Failed + warnings → `Work item #123: 2 tasks of 3 templates created. Failed: Task C. Warnings: Task A (1 field skipped)` (Failed before Warnings)
    - Two work items → two lines joined by `\n`, header `Task creation finished:\n\n` present once
  - [x] 4.2 Extend `TemplateOutcome` (R12)
    - Add `skippedFields?: string[];` and extend the type's JSDoc with: field reference names whose `=` expression failed to evaluate; present only on `created` outcomes and only when non-empty. `TemplateOutcomeStatus` unchanged
  - [x] 4.3 Extract and extend the message assembly (R13)
    - New `export function formatCompletionMessage(perWorkItemOutcomes: { workItemId: number, outcomes: TemplateOutcome[] }[]): string` containing the current `lines` mapping + `'Task creation finished:\n\n' + lines.join('\n')`
    - After the `Failed:` suffix, append `. Warnings: ` + created outcomes with non-empty `skippedFields`, in outcome order, each as `<name> (<n> field skipped)` for n = 1 else `<name> (<n> fields skipped)`, joined by `, `
    - `showCompletionDialog` becomes: `var message = formatCompletionMessage(perWorkItemOutcomes); logInfo(message);` + the existing dialog call; update its JSDoc so "plus failed template names" also mentions warnings for skipped fields
  - [x] 4.4 Ensure the dialog tests pass
    - `npx jest tests/progressDialogController.test.ts` → 5 green
    - `npx tsc --noEmit -p tsconfig.test.json` exits 0

**Acceptance Criteria:**
- 5 tests pass; the no-warning line is unchanged from today
- `formatCompletionMessage` is exported and is the sole message builder; `showCompletionDialog` calls it and nothing else about the dialog changes

---

### Task Group 5: Builder Integration and Caller Update
**Dependencies:** 2, 3, 4
**Files to Modify:** `src/scripts/templateBuilder.ts`, `src/scripts/workItemCreation.ts`, `src/tests/templateBuilder.test.ts` (new)
**Requirements:** R8, R9, R10, R11; T9
**Complexity:** Medium — small diff, but it changes a return type consumed by the REST path and must keep the `''`-inheritance and defaults blocks byte-identical.
**Standards to load:** `.maister/docs/standards/global/error-handling.md`, `.maister/docs/standards/global/minimal-implementation.md`, `.maister/docs/standards/global/coding-style.md`, `.maister/docs/standards/global/commenting.md`, `.maister/docs/standards/testing/test-writing.md`
**Estimated Steps:** 4

- [x] 5.0 Wire the evaluator into the template pipeline
  - [x] 5.1 Write 7 tests in `src/tests/templateBuilder.test.ts` for `createWorkItemFromTemplate` (T9)
    - Build templates as `{ name: "Task A", fields: {...}, description: "" } as any`; pass `{} as any` for `teamSettings` unless testing `@currentiteration`; spy `console.error` as in Group 3
    - Mixed template `{ "Microsoft.VSTS.Scheduling.StoryPoints": "=Math.ceil({Microsoft.VSTS.Scheduling.StoryPoints}*2)", "System.Title": "Fix for {System.Title}" }` with parent `{ "Microsoft.VSTS.Scheduling.StoryPoints": 2.5, "System.Title": "Bug" }` → `patchDocument` contains `{ op: "add", path: "/fields/Microsoft.VSTS.Scheduling.StoryPoints", value: 5 }` with `typeof value === "number"`, and `value: "Fix for Bug"`; `skippedFields` is `[]`
    - Failing expression (`=Math.ciel(1)`) → no entry with that path, `skippedFields` equals `[key]`, `console.error` called once with a message containing the template name, the field name, the raw value and `unsupported function 'Math.ciel'`
    - Two failing fields → `skippedFields` lists both in template iteration order
    - `"System.Title": "=1+1"` → patch entry `value: 2` (number) — the any-field rule
    - `"System.Title": "={Missing}"` → no `/fields/System.Title` entry at all (no parent-title backfill) and `skippedFields` is `["System.Title"]`
    - Non-`=` values and `""` inheritance: `{ "System.Title": "Plain", "Custom.Field": "" }` with parent `{ "Custom.Field": 7 }` → entries `"Plain"` and `7` exactly as before; also `System.AreaPath` / `System.IterationPath` backfilled from the parent
    - `@me` / `@currentiteration` bypass: `setCtx({ user: { uniqueName: "me@x" } } as any)`; template `{ "System.AssignedTo": "@me", "System.IterationPath": "@currentiteration" }` with `teamSettings` `{ backlogIteration: { name: "Team" }, defaultIteration: { path: "\\Sprint 1" } } as any` → `AssignedTo` = `"me@x"`, `IterationPath` = `"Team\\Sprint 1"`, no `=` evaluation attempted
  - [x] 5.2 Modify `src/scripts/templateBuilder.ts` (R8, R9, R10)
    - `export interface BuiltWorkItem { patchDocument: WorkItemFields[]; skippedFields: string[]; }`; signature becomes `: BuiltWorkItem`; the existing `workItem` array is returned as `patchDocument`
    - New imports: `import { isExpression, evaluateExpression } from "./expressionEvaluator";` and `import { logError } from "./logging";`
    - Inside the existing `else` branch (`templateBuilder.ts:19-25`): `var fieldValue = taskTemplate.fields[key]; if (isExpression(fieldValue)) { var result = evaluateExpression(fieldValue, currentWorkItem); if (result.ok) push `{ op: "add", path: "/fields/" + key, value: result.value }` else { logError("Template '" + taskTemplate.name + "' field '" + key + "': expression '" + fieldValue + "' skipped - " + result.reason); skippedFields.push(key); } } else { existing replaceReferenceToParentField + push }`
    - `IsPropertyValid`, the `''` inheritance branch (lines 14-18) and the defaults block (lines 30-48) are untouched; keep the commented-out block as-is (not part of this task)
  - [x] 5.3 Update the caller in `src/scripts/workItemCreation.ts` (R11)
    - `var built = createWorkItemFromTemplate(currentWorkItem, taskTemplate, teamSettings);` replacing `var newWorkItem: WorkItemFields[] = ...` at line 58
    - `keepaliveFetch.createWorkItem(built.patchDocument, ...)`; both `console.log(newWorkItem)` calls (lines 63 and 152) → `console.log(built.patchDocument)`
    - Created-outcome literal (line 148): when `parentLinkSucceeded && built.skippedFields.length > 0` return `{ templateName, status: "created", skippedFields: built.skippedFields }`, otherwise the existing literal; the `failed` outcomes (line 148 false branch, line 160) never carry `skippedFields`
    - `WorkItemFields` stays imported (still used by the `currentWorkItem` parameters and `linkItems`' `document` at line 172); import `BuiltWorkItem` only if an explicit annotation is wanted — inference on `var built` is sufficient
  - [x] 5.4 Ensure the builder tests and the whole-program type check pass
    - `npx jest tests/templateBuilder.test.ts` → 7 green
    - `npx tsc --noEmit -p tsconfig.test.json` exits 0 — this is the only check that compiles `workItemCreation.ts`
    - `npm test` → 27 blocks green across 4 suites (regression check on Groups 1-4)

**Acceptance Criteria:**
- 7 tests pass; `typeof` of the StoryPoints patch value is `number`
- `createWorkItemFromTemplate` is the only producer of `skippedFields`; `workItemCreation.ts` is its only caller and attaches `skippedFields` only to `created` outcomes with a non-empty list
- Console message matches R10: `Template '<name>' field '<ref>': expression '<raw>' skipped - <reason>`

---

### Task Group 6: Build Verification and Test Gap Review
**Dependencies:** 5
**Files to Modify:** `src/tests/*.test.ts` (additions only, max 10 tests); `build/` is regenerated by `grunt build` but is not a source artifact
**Requirements:** R18 (`npm run build` clause), Success Criteria 1, 3, 5
**Complexity:** Low — read-mostly checks plus a few targeted tests.
**Standards to load:** `.maister/docs/standards/testing/test-writing.md`, `.maister/docs/standards/global/minimal-implementation.md`, `.maister/docs/standards/build-tooling/packaging.md`
**Estimated Steps:** 4

- [x] 6.0 Prove the feature ships and close test gaps
  - [x] 6.1 Review the 27 existing blocks against R1-R14 and write up to 10 additional strategic tests, only where a behaviour is otherwise unpinned. Candidates:
    - `evaluateExpression("x=1", {})` → `{ ok: false, reason: "value is not an expression" }` (R2 precondition)
    - `"=  "` → `expression is empty` (R1 whitespace-only body)
    - `=1.` → error (NUMBER rule rejects trailing dot); `=1e3` → error (no exponent)
    - Tabs/newlines as whitespace: `"=\t1 +\n2"` → 3
    - `=Math.min(3)` (arity ≥ 1 accepts one) → 3; `=Math.pow(2,3,4)` → `expects 2 arguments, got 3`
    - `={SP}` with `SP: "0x10"` → 16 (documented `Number()` semantics, known limitation)
    - `formatCompletionMessage` with a `skipped` outcome carrying no `skippedFields` alongside a warning → skipped templates never appear in Warnings
    - Builder: template with only non-`=` fields → `skippedFields` is `[]` and `console.error` not called
  - [x] 6.2 Run the full unit gate
    - `npm test` → all suites green (expect 27-37 blocks)
    - `npx tsc --noEmit -p tsconfig.test.json` exits 0
  - [x] 6.3 Run the production build and inspect the bundle
    - `npx grunt build` from `src/` succeeds (do not use `grunt package-dev` — broken on Node v22)
    - `ls ../build/scripts` → only `app.js`; no `tests/` under `../build`
    - `grep -c "expressionEvaluator" ../build/scripts/app.js` ≥ 1 (module inlined by the RequireJS optimizer)
    - `grep -nE "describe\(|test\.each|jest" ../build/scripts/app.js` → no output (no test code in the bundle)
  - [x] 6.4 Static guards
    - `grep -nE '\beval\s*\(|new\s+Function\b' scripts/expressionEvaluator.ts` → no output (success criterion 3)
    - `git status --short` shows no change to `src/scripts/app.js`, `src/tsconfig.json`, `src/gruntfile.js`, `src/bundle-scripts.js`, `src/toolbar.html`
    - `git diff HEAD --stat -- src/scripts` lists exactly: `expressionEvaluator.ts` (new), `templateBuilder.ts`, `templateFilters.ts`, `workItemCreation.ts`, `progressDialogController.ts`

**Acceptance Criteria:**
- `npm test` green; no more than 10 tests added in this group
- `npx grunt build` succeeds; bundle contains the evaluator and no test code
- eval/new Function grep is empty; legacy `src/scripts/app.js` untouched

---

### Task Group 7: Documentation
**Dependencies:** 5
**Files to Modify:** `README.md`, `src/overview.md`, `.maister/docs/project/roadmap.md`, `.maister/docs/project/tech-stack.md`, `.maister/docs/INDEX.md`
**Requirements:** R19, R20; Success Criterion 6
**Complexity:** Medium — volume and the byte-identical README/overview constraint; no code.
**Standards to load:** `.maister/docs/standards/global/conventions.md`, `.maister/docs/standards/global/commenting.md`
**Estimated Steps:** 7

- [x] 7.0 Document the feature, the tests and the new version
  - [x] 7.1 `README.md`: insert `## Field values: placeholders and expressions ##` between `## What's New ##` (ends line 18) and `## Filtering templates ##` (line 20) — R19.1
    - Special-value table: empty (inherit parent value), `@me`, `@currentiteration`, `{Field.Reference.Name}` text substitution, `=` expression
    - `### Expressions ###`: the `=` rule (leading/trailing whitespace tolerated; no escape for a literal leading `=`); grammar in prose (numbers incl. decimals, `+ - * / %`, unary minus, parentheses, `{Field}` references, `Math.ceil/floor/round/abs/min/max/pow`, standard precedence); examples table with `=Math.ceil({Microsoft.VSTS.Scheduling.StoryPoints}*2)`, `={Microsoft.VSTS.Scheduling.Effort}/2`, `=Math.max({Microsoft.VSTS.Scheduling.StoryPoints}-1, 1)`, `=Math.round({Microsoft.VSTS.Scheduling.StoryPoints}*0.3)`
    - Sentence: referenced parent fields must hold a number (or numeric text); anything else skips the field
    - Integer-field advice (Priority / Business Value need `Math.round`/`ceil`/`floor`, otherwise Azure DevOps rejects the child and the template is reported as failed)
    - Failure behaviour paragraph: field skipped, child still created, dialog shows `Warnings: <template> (N fields skipped)`, reason in the browser console (F12) prefixed `linked-tasks-automation:`; required-field caveat (e.g. Title → template reported as Failed, console still shows the error)
    - Tip: templates cached 4 h — clear `localStorage` keys starting with `linkedTasksAutomation.templateCache.`
  - [x] 7.2 `README.md` remaining edits — R19.2-R19.4
    - `## What's New ##`: `15 focused files` → `16 focused files`; new bullet **Arithmetic expressions in template fields** linking to `#field-values-placeholders-and-expressions`
    - `## Project Structure ##`: after the `templateBuilder.ts` row add `| \`expressionEvaluator.ts\` | Allowlisted arithmetic evaluator for \`=\`-prefixed template values (\`{Field}\` placeholders, \`Math.*\` subset) |`
    - `## Usage ##`: add `4. \`npm test\` to run the unit tests`; replace line 129 ("There is no automated test suite yet…") with `### Tests ###` + "`npm test` (from `src/`) runs the Jest unit tests in `src/tests/` covering the expression evaluator, placeholder substitution, template building and completion-dialog wording. Behaviour against a live Azure DevOps org is still verified manually."
  - [x] 7.3 Copy `README.md` over `src/overview.md` so both are byte-identical (`cp README.md src/overview.md` from repo root); `diff README.md src/overview.md` → empty
  - [x] 7.4 `.maister/docs/project/roadmap.md` — R20
    - Current State: both versions `1.3.0` ("aligned 2026-08-27"); Key Features + "`=` arithmetic expressions in template field values (allowlisted `Math.*` subset, parent-field placeholders)"; Recent Updates sentence pointing to `.maister/tasks/development/2026-08-26-template-field-arithmetic-expressions/`
    - Phase 2: Feature backlog gets a `[x]` sub-item for this feature; Automated tests → `[x]` with "Jest + ts-jest added (2026-08-27): evaluator, placeholder substitution, template builder, dialog wording"; new `[ ]` "Extend Jest coverage to template filtering (`IsValidTemplateWIT` and friends)"
    - Technical Debt: "No automated tests" → "Partial test coverage — template filtering, caching and REST transport untested"; `app.js` item (line 30) → `[x]`, reworded: commit `551aa91` committed `src/scripts/app.js` as a tracked legacy artifact (stale compiled output, not edited by this task)
    - Future Considerations: "Feature ideas: escape syntax for a literal leading `=`; field-type-aware rounding for integer fields; `**`/comparison operators if requested"
  - [x] 7.5 `.maister/docs/project/tech-stack.md` — R20
    - Testing: "Jest 29 + ts-jest (`npm test`), tests in `src/tests/`"; Version Management: both manifests read `1.3.0`
  - [x] 7.6 `.maister/docs/INDEX.md` — R20
    - Roadmap one-liner (line 23): technical-debt parenthetical → "partial test coverage (Jest), no CI/CD, no CONTRIBUTING.md"; versions described as aligned
    - Tech Stack one-liner (line 26): mention "Jest 29 + ts-jest unit tests" (keep "no CI/CD or linting")
  - [x] 7.7 Verify documentation
    - `diff README.md src/overview.md` → empty
    - `grep -c "Field values: placeholders and expressions" README.md` ≥ 2 (heading + What's New link); `grep -n "expressionEvaluator.ts" README.md`; `grep -n "npm test" README.md`; `grep -n "16 focused files" README.md`
    - `grep -n "1.3.0" .maister/docs/project/roadmap.md .maister/docs/project/tech-stack.md`; `grep -n "Jest" .maister/docs/INDEX.md`

**Acceptance Criteria:**
- README and overview byte-identical and containing the new section, the Project Structure row, `16 focused files`, the `npm test` step and the `### Tests ###` subsection
- roadmap, tech-stack and INDEX reflect the feature, Jest, and `1.3.0`

---

### Task Group 8: Version Alignment (final)
**Dependencies:** 6, 7
**Files to Modify:** `src/vss-extension.json`, `src/package.json`, `src/package-lock.json`
**Requirements:** R21; Success Criterion 7
**Complexity:** Low
**Standards to load:** `.maister/docs/standards/build-tooling/packaging.md`, `.maister/docs/standards/global/conventions.md`
**Estimated Steps:** 3

- [x] 8.0 Set both manifests to 1.3.0 as the last change
  - [x] 8.1 Edit `"version"` only: `src/vss-extension.json` line 4 `1.2.8` → `1.3.0`; `src/package.json` `1.1.17` → `1.3.0` — nothing else in either file
  - [x] 8.2 `npm install --package-lock-only` from `src/` so `package-lock.json` root `version` (lines 3 and 9) reads `1.3.0`
  - [x] 8.3 Verify
    - `grep -n '"version"' vss-extension.json package.json | grep 1.3.0` → 2 lines; `sed -n '3p;9p' package-lock.json` both `1.3.0`
    - `git diff --stat -- src/vss-extension.json src/package.json` shows one changed line each beyond Group 1's devDependencies/script lines
    - `npm test` still green (sanity)

**Acceptance Criteria:**
- Both manifests and the lock file read `1.3.0`; no other manifest key changed

---

## Execution Order

1. Group 1: Test Infrastructure (5 steps) — Wave 1
2. Group 2: Expression Evaluator (5 steps, depends on 1) — Wave 2
3. Group 3: Substitution Helper Observability (3 steps, depends on 1) — Wave 2
4. Group 4: Outcome Type and Dialog Wording (4 steps, depends on 1) — Wave 2
5. Group 5: Builder Integration and Caller (4 steps, depends on 2, 3, 4) — Wave 3
6. Group 6: Build Verification and Test Gap Review (4 steps, depends on 5) — Wave 4
7. Group 7: Documentation (7 steps, depends on 5) — Wave 4
8. Group 8: Version Alignment (3 steps, depends on 6, 7) — Wave 5

## Requirements Coverage

| Spec item | Covered by |
|---|---|
| R1 expression marker | 2.2 (`isExpression`), tests 2.1 T1 |
| R2 public API / never throws / no eval | 2.2, 2.4; guards 2.5, 6.4 |
| R3 tokenizer | 2.2; tests 2.1 T2, T3, T5, T6 |
| R4 grammar & precedence | 2.3; tests 2.1 T2, T3, T5 |
| R5 function allowlist & arity | 2.3; tests 2.1 T4, T5 |
| R6 placeholder resolution | 2.4; tests 2.1 T6 |
| R7 result / error taxonomy | 2.4; tests 2.1 T5, T7 |
| R8 `BuiltWorkItem` return shape | 5.2; tests 5.1 |
| R9 the `=` branch | 5.2; tests 5.1 |
| R10 builder log format | 5.2; tests 5.1 (message assertion) |
| R11 caller update | 5.3; type-checked in 5.4 |
| R12 `TemplateOutcome.skippedFields` | 4.2; consumed in 5.3 |
| R13 dialog wording | 4.3; tests 4.1 T10 |
| R14 substitution helper logging | 3.2; tests 1.1 + 3.1 T8 |
| R15 tooling (`package.json`) | 1.2 |
| R16 `jest.config.js` | 1.3 |
| R17 `tsconfig.test.json` + tsc gate | 1.4, 1.5; re-run 2.5, 3.3, 4.4, 5.4, 6.2 |
| R18 test files / build clean | 1.1, 2.1, 3.1, 4.1, 5.1, 6.1; build check 6.3 |
| R19 README / overview | 7.1, 7.2, 7.3, 7.7 |
| R20 roadmap / tech-stack / INDEX | 7.4, 7.5, 7.6, 7.7 |
| R21 version 1.3.0 + lock | 8.1, 8.2, 8.3 |
| T1 `isExpression` | 2.1 block 1 |
| T2 literals & precedence | 2.1 block 2 |
| T3 unary minus | 2.1 block 3 |
| T4 Math functions | 2.1 block 4 |
| T5 allowlist / arity / syntax errors | 2.1 block 5 |
| T6 placeholder resolution | 2.1 block 6 |
| T7 non-finite results | 2.1 block 7 |
| T8 `replaceReferenceToParentField` | 1.1 (3 baseline) + 3.1 (5 logging) |
| T9 `createWorkItemFromTemplate` | 5.1 (7 tests) |
| T10 `formatCompletionMessage` | 4.1 (5 tests) |
| Success criterion 1 (`npm test`, build, no test code) | 6.2, 6.3 |
| Success criterion 2 (StoryPoints 2.5 → 5, number) | 2.1 T6 / 5.1 first test |
| Success criterion 3 (reasons, no eval) | 2.1 T5-T7, 2.5, 6.4 |
| Success criterion 4 (child created, one log, dialog suffix) | 5.1, 4.1 |
| Success criterion 5 (non-`=` unchanged) | 1.1, 5.1 |
| Success criterion 6 (docs) | 7.7 |
| Success criterion 7 (versions) | 8.3 |
| Success criterion 8 (manual live org) | Manual checklist below — not automatable |

## Verification Commands (all from `src/` unless noted)

| Purpose | Command | Expected |
|---|---|---|
| Whole-program type check (incl. tests) | `npx tsc --noEmit -p tsconfig.test.json` | exit 0, no output |
| Unit tests | `npm test` | all suites green |
| Single suite during a group | `npx jest tests/<name>.test.ts` | green |
| Production build | `npx grunt build` | succeeds; `../build/scripts/app.js` only |
| Evaluator bundled | `grep -c "expressionEvaluator" ../build/scripts/app.js` | ≥ 1 |
| No test code shipped | `grep -nE "describe\(\|test\.each\|jest" ../build/scripts/app.js` | no output |
| No dynamic evaluation | `grep -nE '\beval\s*\(\|new\s+Function\b' scripts/expressionEvaluator.ts` | no output |
| Docs identical | `diff README.md src/overview.md` (repo root) | no output |
| Versions | `grep -n '"version"' vss-extension.json package.json; sed -n '3p;9p' package-lock.json` | all `1.3.0` |
| Legacy artifact untouched | `git status --short src/scripts/app.js` | no output |

### Manual live-org checklist (spec Success Criterion 8 — after Group 8, before release)
Clear `localStorage` keys starting with `linkedTasksAutomation.templateCache.` after every template edit, then:
1. Double field (Story Points) with `=Math.ceil({Microsoft.VSTS.Scheduling.StoryPoints}*2)` on a parent with 2.5 → child has 5.
2. Integer field with `={Microsoft.VSTS.Common.Priority}/2` on a parent whose Priority is **3** → template `Failed` (HTTP 400), as documented.
3. Expression referencing an unset parent field → child created without that field; console shows the R10 error; dialog shows `Warnings: <template> (1 field skipped)`.
4. Title `Fix for {System.Title}` → unchanged behaviour.

## Standards Compliance

Follow standards from `.maister/docs/standards/` (loaded per group as listed above):
- `global/validation.md` — allowlisted grammar and function table; fail fast on the first invalid token; specific per-field reasons
- `global/error-handling.md` — one private typed error, caught at the module boundary; graceful degradation (skip field, still create child); user-facing dialog carries counts only, console carries detail
- `global/minimal-implementation.md` — no AST, no operator tables, seven `Math` functions only, no escape syntax, no field-type lookup; every new export has an immediate caller
- `global/coding-style.md`, `global/commenting.md` — camelCase, one function per grammar rule, JSDoc (why) on exports only, no changelog comments, 4-space indent, no dead imports
- `global/conventions.md` — README/overview kept current and identical; three test-only devDependencies; `package.json` stays `private`
- `testing/test-writing.md` — behaviour-focused tests, descriptive names, only `console.error` spied, parser edge cases get the most rows
- `build-tooling/packaging.md` — manual release bump, manifest `files`/contributions untouched, `package.json` `name` equals manifest `id`

## Notes

- Test-Driven: every code group writes its tests first (x.1), then implements, then runs only its own suite; the whole-program `tsc` gate runs at the end of every code group because it is the only check that compiles `workItemCreation.ts`
- Run Incrementally: `npx jest tests/<suite>` per group; `npm test` in 5.4, 6.2 and 8.3 only
- Mark Progress: check off steps here and flip `todo`→`done` markers in `implementation-plan.html`
- Reuse First: `logError`/`logInfo` (`logging.ts`), `WorkItemFields` (`types.ts`), `IsPropertyValid` and the untouched inheritance/defaults blocks, existing dialog service call; no new helpers beyond the three components the spec names
- Never edit: `src/scripts/app.js`, `src/tsconfig.json`, `src/gruntfile.js`, `src/bundle-scripts.js`, `src/toolbar.html`
