# Gap Analysis: Template Field Arithmetic Expressions

## TL;DR
Nothing in the codebase evaluates anything today: a template field value is a string that passes through `replaceReferenceToParentField` (`src/scripts/templateFilters.ts:194`) and is pushed verbatim into the JSON-Patch document (`src/scripts/templateBuilder.ts:22-24`). The gap is one new pure module (`expressionEvaluator.ts`), a two-line integration in the builder, a missing-field guard in the substitution helper, the project's first Jest setup, and docs. The design is already pinned by Phase 1 (allowlisted evaluator, `=` prefix, log-and-skip, Jest); what remains open is a handful of edge-semantics and scope-boundary decisions, plus one feasibility risk outside the code: whether the Azure DevOps template editor even lets an author save `=Math.ceil(...)` into a numeric field such as Story Points.

## Key Decisions
- `has_reproducible_defect = false` — the `undefined` interpolation is a latent quirk hardened incidentally, not the task's goal; no failing scenario was reported by a user.
- `involves_data_operations = false` — the feature transforms a value inside the existing child-CREATE pipeline; it introduces no entity with its own CRUD lifecycle, so the orphaned-operation module does not apply (a data-flow section is included instead).
- `ui_heavy = false` — the extension has no settings UI; authoring happens in Azure DevOps' own template editor and the only user-visible surface is the existing completion dialog, which is not changed.
- Placeholder resolution should happen inside the evaluator (numeric token substitution), not by textual splicing before parsing — textual splicing is the root of the `undefined`, `null`, `2--3` and string-value failure modes (flagged as an important decision below, since the Phase 1 wording describes substitution-then-evaluation at the user level only).

## Open Questions / Risks
- **Authoring feasibility (unverified, blocking value not code)**: the Azure DevOps template editor renders the real work item form; numeric fields (Story Points, Effort, Remaining Work) may reject non-numeric text and block Save. If so, `=` expressions can only be authored for string fields via the UI, or via the Templates REST API. No live org was available in the previous task either; this must be checked early.
- Integer-typed fields (`Microsoft.VSTS.Common.Priority`, `BusinessValue`) will 400 on a non-integer result, surfacing only as a `failed` template name in the completion dialog.
- Jest + `module: "amd"` do not mix: tests need a second tsconfig (CommonJS) that also pulls in the SDK's `typings/*.d.ts`, because `templateFilters.ts` imports `TFS/WorkItemTracking/Contracts` for types and the main tsconfig has `types: []`. Test files must also live outside `scripts/**` (or be excluded) so `tsc -p tsconfig.json` does not compile them into `build/`.
- Templates are cached in `localStorage` for 4 hours; manual verification must clear `linkedTasksAutomation.templateCache.*` after editing a template.
- The uncommitted in-flight work already bumps `vss-extension.json` to 1.2.8 while `package.json` stays at 1.1.17; any version handling in this task lands on top of that.

## Summary
- **Risk Level**: Medium
- **Estimated Effort**: Medium (evaluator + tests + first test infrastructure; the integration itself is trivial)
- **Detected Characteristics**: modifies_existing_code, creates_new_entities

## Task Characteristics
| Characteristic | Value | Justification |
|---|---|---|
| has_reproducible_defect | no | No user-reported failure; the `undefined` splice in `replaceReferenceToParentField` is a latent quirk hardened as a side effect. |
| modifies_existing_code | yes | `templateBuilder.ts:20-25` gains the evaluation call; `templateFilters.ts:194-205` gains missing-field detection; `package.json` gains test tooling. |
| creates_new_entities | yes | New `src/scripts/expressionEvaluator.ts`, new Jest config + test tsconfig + test files, new docs section. |
| involves_data_operations | no | No new entity or CRUD lifecycle; the feature is a value transform inside the existing child work item CREATE. Backend/UI/access layers all belong to Azure DevOps. |
| ui_heavy | no | The extension has no authoring UI; template values are typed in Azure DevOps' template editor. No change to `toolbar.html` or the dialogs. |

## Current State (verified)

Execution path for one template field, `src/scripts/templateBuilder.ts:11-27`:

```ts
var fieldValue = taskTemplate.fields[key];
fieldValue = replaceReferenceToParentField(fieldValue, currentWorkItem);   // templateFilters.ts:194
workItem.push({ "op": "add", "path": "/fields/" + key, "value": fieldValue })
```

`replaceReferenceToParentField` (`templateFilters.ts:194-205`) behaviour, reproduced with the exact function body in Node:

| Template value | Parent `StoryPoints = 5` | Output today |
|---|---|---|
| `=Math.ceil({Microsoft.VSTS.Scheduling.StoryPoints}*2)` | | `=Math.ceil(5*2)` (string, written verbatim to ADO) |
| `={A}+{A}` (same field twice) | | `=5+5` — both resolve, because the regex returns the name twice and each loop pass replaces the next occurrence |
| `={Microsoft.VSTS.Scheduling.Missing}*2` | field absent | `=undefined*2` — no log, no guard |
| `={Field}*2` with parent value `null` | | `=null*2` |
| `=5} + {A}` | | `=5} + 5` — the regex does not require `{`, but the stray `}` stays in the text |
| `=` / `=abc` | | unchanged |

Downstream: `value` is typed `any` (`types.ts:14`), serialised by `JSON.stringify` in `keepaliveFetchClient.ts:44`, so a native `number` needs no transport change. A 400 from Azure DevOps reaches the user only as a template name under "Failed" in the completion dialog (`workItemCreation.ts:150-161`, `progressDialogController.ts:58-63`) with no reason shown.

Test infrastructure: none. `src/package.json` has no `test` script and no Jest/ts-jest; `tsconfig.json` is `module: "amd"`, `types: []`, `include: ["scripts/**/*.ts"]`. Node v22.20.0 and npm 10.9.3 are installed; `node_modules` is present.

Documentation: `README.md` and `src/overview.md` are byte-identical in the working tree (the uncommitted diff rewrote `overview.md` to match). Neither documents the existing `{Field}` placeholder syntax. The README "Project Structure" table (lines 84-98) lists every module and must gain a row.

Versions: HEAD has `vss-extension.json` and `package.json` both at 1.1.17; the uncommitted diff bumps only `vss-extension.json` to 1.2.8. `.maister/docs/project/roadmap.md` still states both are aligned at 1.1.17.

## Desired State

A template author writes `=Math.ceil({Microsoft.VSTS.Scheduling.StoryPoints}*2)` as a field value. When "Create linked tasks" runs, the extension resolves each `{Field}` from the parent's `fields`, evaluates the arithmetic with an allowlisted grammar (numeric literals, `+ - * / %`, unary minus, parentheses, `Math.ceil|floor|round|abs|min|max|pow`), and writes the numeric result to the child's field. Any missing parent field, unknown identifier, syntax error, or non-finite result logs an error naming the template, field and expression and omits that field; the child is still created with its remaining fields. Values without a leading `=` are byte-for-byte unchanged in behaviour. Unit tests cover the evaluator and placeholder substitution via `npm test`.

## Gaps Identified

### Missing Features
- **Expression evaluator**: no tokenizer/parser/evaluator exists anywhere; the only value logic in the codebase is string equality in `matchField` (`templateFilters.ts:75-109`). Evidence: `grep -ri "eval\|Math\." src/scripts/*.ts` returns nothing relevant.
- **Expression marker detection**: no code inspects a leading `=`. Precedent for sentinel values is `IsPropertyValid` (`templateFilters.ts:184-189`) checking `@me` / `@currentiteration`.
- **Numeric emission**: every interpolated value leaves the builder as `string`; only the empty-value inheritance branch (`templateBuilder.ts:14-18`) preserves native types.
- **Field-skip path**: the builder loop has no way to "process this key but push nothing" for a non-empty template value; it always pushes. A skip branch is required.
- **Test runner**: no Jest, no ts-jest, no test tsconfig, no `test` script.
- **Docs**: no section for `{Field}` placeholders or `=` expressions in `README.md` / `src/overview.md`; no `expressionEvaluator.ts` row in the Project Structure table.

### Incomplete Features
- **`replaceReferenceToParentField`**: substitutes but cannot report that a placeholder was unresolved. For expressions this turns a missing field into `NaN` (or `=undefined*2` written as text if evaluation is bypassed). It needs either an unresolved-field signal for the caller or to be bypassed entirely for expression values (see decision `substitution-strategy`).

### Behavioural Changes Needed
- `templateBuilder.ts` loop: from "substitute, push string" to "if `=`-prefixed: evaluate, push number or skip; else: substitute, push string".
- Missing parent field inside an expression: from silent `undefined` text to `logError(...)` + field omitted.

## Integration Points

| # | Location | Change | Notes |
|---|---|---|---|
| 1 | `src/scripts/templateBuilder.ts:20-25` | Branch on `=` prefix; call evaluator; push `number` or skip | Sole caller of substitution; sole consumer is `workItemCreation.ts:58`. Loop variable must become `string \| number`. |
| 2 | `src/scripts/expressionEvaluator.ts` (new) | Tokenizer + recursive-descent parser + evaluator + placeholder resolver | Zero imports beyond `./logging`; synchronous; never throws out. |
| 3 | `src/scripts/templateFilters.ts:194-205` | Missing-field detection (`undefined`/`null`) with `logError`; optionally regex tightening | Behaviour for non-expression values is a scope decision (`harden-substitution`). |
| 4 | `src/scripts/logging.ts` | Reuse `logError` | No change. |
| 5 | `src/package.json` | `jest`, `ts-jest`, `@types/jest` devDependencies; `"test": "jest"` script | First test tooling in the repo. |
| 6 | `src/tsconfig.test.json` (new), `src/jest.config.js` (new) | CommonJS compile for tests; include SDK typings so `TFS/*` type imports resolve | Test files must not be picked up by `tsconfig.json`'s `scripts/**/*.ts` include (place under `src/tests/` or add `exclude`). |
| 7 | `README.md`, `src/overview.md` | New "Field placeholders and expressions" section; Project Structure row; replace "no automated test suite" line | Both files must stay identical; `overview.md` is the Marketplace page. |
| 8 | `src/vss-extension.json`, `src/package.json` | Version handling | Decision `version-bump`. |
| 9 | `.maister/docs/project/roadmap.md` | Feature + tests entries | Decision `roadmap-update`. |

Build pipeline (`gruntfile.js` `build` = `clean:build -> exec:tsc -> exec:bundle -> copy:static`; `bundle-scripts.js` inlines every module reachable from `scripts/app`) needs no change for the new module.

## User Journey Impact Assessment

Persona: template author (any team member with template-manage rights). Runtime persona: anyone clicking "Create linked tasks".

| Dimension | Current | After | Assessment |
|---|---|---|---|
| Reachability | Author edits template in ADO "Manage templates" | Same page, same field, types `=...` | No new path; authoring surface unchanged |
| Discoverability | `{Field}` syntax undocumented (score 2/10 — learned from other users/forks) | `=` syntax documented in README and Marketplace page (score 4/10 — docs only, no in-product hint) | +2, docs-bound; the extension has no place to surface hints |
| Flow Integration | Click -> children created -> completion dialog | Identical | No extra steps |
| Failure visibility | ADO 400 -> template listed as "Failed", reason in console only | Expression failure -> child *created*, field silently missing, reason in console only | Regression risk in perceived correctness: a "created" outcome can now hide a skipped field (decision `failure-visibility`) |
| Multi-persona | n/a | n/a | No role-dependent behaviour |

Red flag: the only feedback channel for a wrong expression is the browser console. An author who mistypes `Math.ciel` sees a successfully created child with no Story Points and no indication why.

## Data Flow (in place of CRUD lifecycle)

```
ADO template API  -> template.fields[key]: string        "=Math.ceil({SP}*2)"
orchestrator.ts:93 -> currentWorkItem = response.fields  { "Microsoft.VSTS.Scheduling.StoryPoints": 5 }  (native number; absent when unset)
templateBuilder.ts -> [new] isExpression? -> evaluator: resolve {SP} -> 5 ; parse ; evaluate -> 10
                   -> push { op:"add", path:"/fields/<key>", value: 10 }      (number, via WorkItemFields = any)
keepaliveFetchClient.ts:44 -> JSON.stringify -> PATCH _apis/wit/workitems/$Task
Azure DevOps      -> validates field type; Double accepts 10 / 10.5; Integer rejects 10.5 with 400
```

Every stage exists today except the bracketed one; no schema, transport, manifest or cache change is required. Parent values that are not numbers (`System.Title`, dates, identities, HTML) are the only inputs that cannot survive the pipeline and must be rejected by the evaluator.

## Issues Requiring Decisions

Phase 1 already fixed: evaluator mechanism, `=` marker, log-and-skip failure handling, Jest. The items below are not re-asks of those.

### Critical (Must Decide Before Proceeding)

1. **`authoring-feasibility` — Verify that the ADO template editor accepts `=...` text in numeric fields before investing in the feature**
   The template editor renders the work item form; numeric fields may refuse non-numeric text and block Save, which would make the headline use case (`Story Points`) unauthorable through the UI. Nothing in this repo can settle it, and the previous task had no live org.
   - Options: (A) Spike in a live org first (5 minutes: try saving `=1+1` into Story Points on a template), then proceed. (B) Proceed with implementation now; verify during manual verification and document the Templates REST API as an authoring fallback if the editor blocks it. (C) Defer the task until verified.
   - Recommendation: **B** — the code is identical either way and the pure module is worth having; but the docs must state the verified authoring path, and if the editor blocks it the README must show the REST-API alternative.

### Important (Should Decide)

1. **`substitution-strategy` — Where placeholders are resolved for expressions**
   - Options: (A) Evaluator resolves `{Field}` itself: tokenizer treats `{...}` as a placeholder token, looks the value up in `currentWorkItem`, requires `typeof value === "number"` (or a numeric string), and fails cleanly on `undefined`/`null`/non-numeric. `replaceReferenceToParentField` is not called for `=` values. (B) Keep textual `replaceReferenceToParentField` then parse the result; add an unresolved-field return signal to the helper.
   - Default: **A**. Textual splicing is the origin of `=undefined*2`, `=null*2`, `2-{X}` -> `2--3`, and silently injecting a title string into arithmetic. Option A keeps the helper untouched for non-expression values, keeps the evaluator testable with a plain `{ [field]: any }` input, and yields precise error messages ("parent field X is missing" vs "X is not numeric").

2. **`non-numeric-references` — Behaviour when `{Field}` inside an expression refers to a non-numeric parent field**
   - Options: (A) Numeric only: `undefined`, `null`, strings that are not numeric, objects -> error + skip. (B) Also accept numeric strings (e.g. a custom text field holding `"3"`). (C) Support string concatenation (`="Fix " + {System.Title}`) — a different feature.
   - Default: **B** (accept numbers and strings that parse as a finite number via `Number(value)`; reject everything else). C is out of scope: the placeholder syntax already covers string composition without `=`.

3. **`malformed-expressions` — `=` alone, `=abc`, `= 1+1`, `=1+1 ` (whitespace), `==1`**
   - Options: (A) Anything starting with `=` is an expression; parse failure -> log + skip (a lone `=` is a parse error). (B) Treat `=` followed by nothing or by text that fails to parse as literal text and write it unchanged.
   - Default: **A**, with leading/trailing whitespace trimmed after the marker. Consistent, no heuristics, and a literal field value of exactly `=` is not a realistic authoring intent. Document the escape: to write a literal leading `=`, this task provides none (minimal implementation) — call out in docs.

4. **`result-typing` — Non-integer result for an integer-typed field (e.g. `=Priority/2` -> 1.5 for `Microsoft.VSTS.Common.Priority`)**
   - Options: (A) Write the raw number; let ADO reject with 400 -> template "Failed" as today for any bad value. (B) Auto-round when the target field is integer (requires a field-type lookup via `_apis/wit/fields`, a new REST call and cache entry). (C) Always `Math.round` results.
   - Default: **A**. The author controls rounding with `Math.round`/`ceil`/`floor`; B adds a network call and cache for an edge case; C silently changes Story Points `1.5` -> `2`. Docs should state that integer fields need explicit rounding. Non-finite results (`NaN`, `Infinity`, division by zero) are always errors -> skip.

5. **`harden-substitution` — Whether to change `replaceReferenceToParentField` for non-expression values**
   - Options: (A) Leave its output unchanged; only add `logError` when a placeholder resolves to `undefined`/`null` (observability only). (B) Also stop splicing the text `undefined`/`null` (substitute empty string). (C) Leave the function entirely untouched.
   - Default: **A**. Replace-all is not actually broken (verified: `{A}+{A}` resolves both occurrences), so the only real defect is silent `undefined` text. Changing the emitted text (B) alters existing users' output (e.g. titles) and is outside the task; C forgoes a one-line observability win. Unit-test the helper's current behaviour either way.

6. **`failure-visibility` — Whether a skipped expression field should be visible outside the console**
   - Options: (A) Console `logError` only (as decided in Phase 1 Q3); completion dialog unchanged. (B) Extend `TemplateOutcome` with a `warnings: string[]` and list "created with N fields skipped" in the completion dialog.
   - Default: **A** for this task — `progressDialogController.ts`/`TemplateOutcome` are mid-refactor in the uncommitted diff and B widens scope into a UI change. Record B as a follow-up in the roadmap.

7. **`version-bump` — Version handling given HEAD is 1.1.17/1.1.17 and the uncommitted in-flight diff already moved `vss-extension.json` to 1.2.8**
   - Options: (A) Do not touch versions in this task; the in-flight work owns the 1.2.x bump and the release process re-syncs. (B) At the end of this task set both `vss-extension.json` and `package.json` to the same new minor version (e.g. 1.3.0, new feature) and update the roadmap's "Current State". (C) Only align `package.json` to whatever `vss-extension.json` says.
   - Default: **B**, executed as the last step so it sits on top of the in-flight bump — `packaging.md` requires manual bumps for release builds and the roadmap tracks alignment as a completed goal that has silently regressed.

### Minor

1. **`roadmap-update` — Update `.maister/docs/project/roadmap.md` in this task**
   - Options: (A) Yes: add the feature under "Key Features", tick/partially tick "Automated tests" in Phase 2, fix the version line, add `failure-visibility` follow-up. (B) No, docs-only follow-up.
   - Default: **A**; it is a 5-line edit and the roadmap explicitly asks features to be tracked there once scoped.

2. **`test-location` — Where test files live**
   - Options: (A) `src/tests/*.test.ts` (outside the main tsconfig's `scripts/**` include). (B) `src/scripts/*.test.ts` with an `exclude` added to `tsconfig.json`.
   - Default: **A**; zero change to the production tsconfig and no risk of `tsc` emitting test files into `build/` for the bundler to delete.

3. **`readme-test-line` — README line 129 "There is no automated test suite yet"**
   - Default: replace with `npm test` instructions in both `README.md` and `src/overview.md` (they must stay identical).

## Recommendations
- Implement the evaluator as a small recursive-descent parser over a token stream (number, placeholder, identifier, operator, paren, comma) with a fixed `Math` function table `{ ceil, floor, round, abs, min, max, pow }`; arity-check `min`/`max` (>= 1 arg) and `pow` (2). Reject any identifier not in the table, `}` without `{`, and trailing tokens.
- Return a discriminated result (`{ ok: true, value: number } | { ok: false, reason: string }`) so `templateBuilder.ts` owns the `logError(template, field, expression, reason)` call and the skip; the evaluator stays pure and trivially testable.
- Keep the `=` check and the trim in one exported helper used by the builder; do not touch `IsPropertyValid`.
- Test tsconfig: `module: "commonjs"`, `target: ES2015`, `strict: true`, and either `files`/`include` covering `node_modules/vss-web-extension-sdk/typings/vss.d.ts` + `tfs.d.ts` (needed for `templateFilters.ts`'s `TFS/WorkItemTracking/Contracts` type import) or a `moduleNameMapper` stub. Verify `ts-jest` elides the type-only namespace import; if not, map it to an empty module.
- Test matrix (behaviour-focused, per `test-writing.md`): literals incl. decimals and unary minus; precedence (`1+2*3`, `(1+2)*3`, `2*-3`, `-2**` rejected); each `Math` function; division by zero -> error; unknown identifier -> error; `Math.random()` -> error; missing placeholder -> error naming the field; non-numeric parent value -> error; `=` / `=abc` -> error; non-`=` values -> untouched; existing substitution behaviour (multi-occurrence, `undefined` splice) documented by tests so the hardening decision is enforced.
- Docs section must document the pre-existing `{Field}` syntax first, then `=` expressions, the allowlisted grammar, the numeric-only rule, the integer-field rounding note, and where failures are reported (browser console).
- Manual verification checklist: clear `linkedTasksAutomation.templateCache.*` in `localStorage`; test Double field, Integer field with non-integer result (expect 400 -> Failed), missing parent field (expect created without field + console error), a title with `{System.Title}` (unchanged behaviour).

## Risk Assessment
- **Complexity Risk**: Medium — a hand-rolled parser is the only non-trivial code; bounded grammar and unit tests keep it contained.
- **Integration Risk**: Low — one call site, one caller, `value: any` transport; non-`=` values are untouched by construction. The uncommitted in-flight diff does not touch `templateBuilder.ts` or `templateFilters.ts`.
- **Regression Risk**: Low for existing templates (marker-gated). Medium for tooling: adding Jest/ts-jest and a second tsconfig is the first test infrastructure in the repo and must not leak into `grunt build` (`tsc -p tsconfig.json` include scope, bundler cleanup of `build/scripts/*`).
- **Product Risk**: Medium-High until `authoring-feasibility` is verified — if the ADO template editor rejects `=` text in numeric fields, the feature is only usable via the REST API or on string fields.
