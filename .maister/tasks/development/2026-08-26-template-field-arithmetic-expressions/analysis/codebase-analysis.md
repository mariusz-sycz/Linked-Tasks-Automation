# Codebase Analysis Report

## TL;DR
The feature slots into a single, well-isolated seam: `templateBuilder.ts:22-24` already calls `replaceReferenceToParentField` (`templateFilters.ts:194`) to substitute `{Field}` placeholders and then pushes the string straight into the JSON-Patch document. Add one call to a new synchronous `expressionEvaluator.ts` between those two lines; no build, transport, or manifest changes are needed (patch `value` is typed `any`, the bundler inlines new modules automatically). The decisive design choices are (a) an explicit opt-in marker so titles like `"Fix: 2+2"` stay literal, (b) a hand-rolled allowlisted evaluator instead of `new Function` (CSP in the sandboxed ADO iframe is unverified and the validation standard mandates allowlists), and (c) graceful degradation for unresolved placeholders, which today silently interpolate the literal text `undefined`. The repo has zero tests; this pure module is the natural first unit-test target but requires adding a runner from scratch.

## Key Decisions
- New module `src/scripts/expressionEvaluator.ts`, called from `templateBuilder.ts` right after placeholder substitution — matches the one-concern-per-file pattern; `templateFilters.ts` is already the largest file and is about filtering, not value transformation.
- Hand-rolled allowlisted evaluator (numeric literals, `+ - * / % ( )`, fixed `Math.*` subset) rather than `new Function`/`eval` — avoids the unverified `unsafe-eval` CSP question in the sandboxed extension iframe, satisfies `validation.md` (allowlists over blocklists), and needs no npm dependency (the RequireJS bundler makes third-party parsers impractical).
- Explicit opt-in marker for expression evaluation (e.g. leading `=`) — the existing `@me` / `@currentiteration` sentinels in `IsPropertyValid` are the precedent for special value syntax; auto-detection would corrupt free-text fields.
- Emit a native `number` when evaluation succeeds; fall back to the substituted string (and `logError`) on any failure — never throw out of the template pipeline, consistent with the project's catch/log/degrade error philosophy.
- Fix `replaceReferenceToParentField` to replace all occurrences and detect unresolved fields as part of this work — `{A}+{A}` and missing fields are the two most likely real-world failure modes for arithmetic.

## Open Questions / Risks
- Marker syntax is unspecified by the task (`Math.ceil({...}*2)` with no prefix) — needs a decision: explicit prefix (recommended) vs. heuristic detection.
- Whether the sandboxed Azure DevOps extension iframe permits `new Function` is unverified; only relevant if the allowlist approach is rejected.
- Result typing: `value: 5` vs `value: "5"` — ADO accepts both for numeric fields, but `"NaN"`/`"undefined"` cause a 400 that surfaces only as a `failed` entry in the completion dialog with no reason shown to the user.
- No test infrastructure exists (task state has `skip_test_suite: true`); adding Jest requires a second tsconfig because `module: "amd"` won't run under Jest.
- Templates are cached in `localStorage` for 4 hours (`templateCache.ts`) — manual verification must clear `linkedTasksAutomation.templateCache.*` keys.
- Uncommitted work on `main` (TemplateOutcome refactor, bundler, docs rewrite of `overview.md`) — low collision risk for code, but the new docs section must land in the rewritten structure of both `README.md` and `src/overview.md`.
- Two structural quirks in the substitution regex: it matches text before `}` without requiring `{`, and `String.replace` with a string pattern only replaces the first occurrence.

---

**Date**: 2026-08-26
**Task**: Template field arithmetic expressions
**Description**: Allow template authors to write JavaScript-style arithmetic expressions in template field values, e.g. `Math.ceil({Microsoft.VSTS.Scheduling.StoryPoints}*2)`. Field placeholders in curly braces are substituted with parent work item field values, then the expression is evaluated like standard JavaScript and the result written to the child work item field.
**Analyzer**: codebase-analyzer skill (2 Explore agents: File Discovery + Code Analysis, Context Discovery + Pattern Mining)

---

## Summary

The extension is a backend-less, stateless Azure DevOps browser extension written in TypeScript (AMD, ES2015, strict) with one module per concern under `src/scripts/`. Both agents independently converged on the same two primary files and the same insertion point: placeholder substitution in `templateFilters.ts:194-205` and its single caller in `templateBuilder.ts:20-25`. The feature is small in code footprint (1 new file, 2 edited files, 2 docs) but introduces the first numeric semantics and the first evaluated-input surface in a codebase that currently has only string equality, no validation, no tests, and no CSP knowledge.

---

## Files Identified

Ranking: files named by both agents rank highest; primary = will be edited or directly integrated; related = supporting context.

### Primary Files

**`src/scripts/templateFilters.ts`** (205 lines) — named by both agents
- Contains `replaceReferenceToParentField` (lines 194-205): the `{Field.Ref.Name}` substitution that the expression feature builds on. Also `IsPropertyValid` (177-192), the gatekeeper that decides which template fields are processed and already special-cases `@me`, `@currentiteration`, `System.Tags`.
- Relevant because substitution semantics (first-occurrence-only replace, `undefined` interpolation for missing fields, regex that does not require an opening brace) directly determine what text reaches the evaluator.

**`src/scripts/templateBuilder.ts`** (58 lines) — named by both agents
- `createWorkItemFromTemplate` builds the JSON-Patch array for the child work item. Line 22 is the only call to `replaceReferenceToParentField`; line 24 pushes the resulting string as `value`.
- The exact insertion point for evaluation is between lines 22 and 24.

**`src/scripts/expressionEvaluator.ts`** (new, does not exist yet)
- Proposed home for the evaluator; both agents independently recommended this name and location. Imported by `templateBuilder.ts`, mirrors how `templateClassifier.ts` and `templateCache.ts` were added.

### Related Files

**`src/scripts/workItemCreation.ts`** (198 lines)
- Calls `createWorkItemFromTemplate` (line 58), dispatches the patch, maps errors to `{ status: "failed" }` + `logError` (150-161). Where an expression failure would ultimately surface today.

**`src/scripts/keepaliveFetchClient.ts`** (68 lines)
- The REST transport: `PATCH .../_apis/wit/workitems/$Type?api-version=7.1` with `JSON.stringify(patchDocument)`. Confirms a JS `number` serializes as a JSON number with no change needed.

**`src/scripts/types.ts`** (14 lines)
- `WorkItemFields = { [key: string]: any }` — used for both parent fields and patch entries; `value: any` means numeric results need no type change.

**`src/scripts/logging.ts`** (7 lines)
- `logInfo` / `logError` — the only approved logging surface (`console.*` prefixed with `linked-tasks-automation: `).

**`src/scripts/orchestrator.ts`** (134 lines)
- Fetches the parent work item; `currentWorkItem = response.fields` (lines 93-95) is the source of placeholder values. Numeric fields arrive as native numbers here.

**`src/scripts/progressDialogController.ts`** (86 lines)
- `TemplateOutcome` (`created` / `failed` / `skipped`) and the completion dialog — the only user-facing reporting channel. Mid-refactor in the uncommitted diff.

**`src/scripts/app.ts`** (57 lines), **`src/toolbar.html`** (41 lines)
- Entry point chain; no changes expected.

**`README.md`** (130 lines), **`src/overview.md`** (130 lines)
- Template syntax documentation (near-duplicates; `overview.md` becomes the Marketplace details page). Neither documents `{Field}` placeholders today. Both need a new section.

**`src/bundle-scripts.js`** (59 lines), **`src/gruntfile.js`** (78 lines), **`src/tsconfig.json`** (11 lines), **`src/package.json`** (24 lines), **`src/vss-extension.json`** (83 lines)
- Build pipeline `clean:build -> exec:tsc -> exec:bundle -> copy:static`. `tsconfig` includes `scripts/**/*.ts`; the RequireJS optimizer inlines every module reachable from `scripts/app`. No config change required for a new module. Version bump needed (`vss-extension.json` 1.2.8 vs `package.json` 1.1.17 are already out of sync).

**`src/scripts/templateCache.ts`** (69 lines), `templates.ts` (68), `templateClassifier.ts` (45), `childTypes.ts` (109), `context.ts` (9), `authTokenProvider.ts` (14)
- Supporting layers, unaffected. Note the 4-hour `localStorage` template cache.

**`src/scripts/app.js`** (539 lines) — untracked, legacy
- Pre-migration monolith; not in git, not compiled, not copied. Do not edit; candidate for deletion. The shipped artifact is the generated `build/scripts/app.js` bundle.

**`.maister/docs/project/roadmap.md`**, **`.maister/docs/project/vision.md`**
- Roadmap "Key Features" lists `{fieldName}` substitution; extend and add the feature under Phase 2.

---

## Current Functionality

### Execution flow

```
toolbar.html -> app.create(context)                          app.ts:17
  -> orchestrator.AddTasks(workItemId)                       orchestrator.ts:59
       parent fields: witClient.getWorkItem(id).fields       orchestrator.ts:93-95
       templates (localStorage-cached 4h) -> classify -> dispatch
  -> workItemCreation.createChildFromTemplate                workItemCreation.ts:20
       IsValidTemplateWIT / IsValidTemplateTitle  (skip if no match)
  -> workItemCreation.createWorkItem                         workItemCreation.ts:54
       -> templateBuilder.createWorkItemFromTemplate         templateBuilder.ts:7
            for each template field passing IsPropertyValid:
              '' -> copy parent value verbatim (type preserved)
              else -> replaceReferenceToParentField          templateFilters.ts:194
                      [NEW: evaluateFieldExpression here]
                   -> push { op:"add", path:"/fields/"+key, value }
       -> keepaliveFetch.createWorkItem(patchDoc)            keepaliveFetchClient.ts:59
       -> linkItems / linkTo rules
  -> showCompletionDialog(outcomes)                          progressDialogController.ts:58
```

### Key Components/Functions

- **`replaceReferenceToParentField(fieldValue, currentWorkItem): string`** (`templateFilters.ts:194`): regex `/[^{\}]+(?=})/g` extracts placeholder names; each is replaced via `String.replace('{'+name+'}', parentValue)`. Behavioural facts that matter for this feature:
  - Missing/unknown field: `undefined` is stringified into the text (no log, no validation). For an expression this yields `Math.ceil(undefined*2)` -> `NaN`.
  - `replace` with a string pattern replaces only the first occurrence; `{A}+{A}` leaves the second unresolved.
  - Regex does not require a preceding `{`; `"5} + {A}"` produces a bogus first match. For `"Math.ceil({SP}*2)"` it correctly yields `["SP"]`, so no regex change is strictly required.
  - Always returns `string`; numeric parent values are stringified.
- **`IsPropertyValid(taskTemplate, key)`** (`templateFilters.ts:177`): rejects non-own keys, `System.Tags`, `@me`, `@currentiteration`. Calls `.toLowerCase()` on the value, so template values are assumed to be strings (they are: ADO `WorkItemTemplate.fields` is `{ [ref]: string }`).
- **`createWorkItemFromTemplate`** (`templateBuilder.ts:7`): loop above plus defaults for Title/AreaPath/IterationPath and `@currentiteration` / `@me` handling.
- **`checkRules` / `matchField`** (`templateFilters.ts:5-21`, `75-109`): the `applywhen` / `notapplywhen` engine — pure case-insensitive string equality, arrays as OR, no operators, no numeric coercion. This feature introduces the first numeric semantics in the codebase. `matchField` swallows errors silently (`catch { return false }`) — do not copy that.
- **`sendPatch`** (`keepaliveFetchClient.ts:29`): `fetch` PATCH with `application/json-patch+json`; non-2xx -> `logError` + throw.
- **`logInfo` / `logError`** (`logging.ts`).

### Data Flow

Parent `fields` (native types, from REST) -> template `fields` (all strings, from ADO template API) -> substitution (string) -> [evaluation] -> JSON-Patch `value: any` -> `JSON.stringify` -> Azure DevOps. Only the empty-value inheritance branch currently preserves native types; every interpolated value leaves as a string. ADO accepts `"5"` or `5` for `Microsoft.VSTS.Scheduling.StoryPoints`; `"NaN"` / `"undefined"` produce a 400 validation error visible only as a `failed` template name in the completion dialog.

### Template format (for reference)

Templates are Azure DevOps team work item templates (no template files in this repo). `template.fields` values follow these conventions:

| Value | Meaning | Handled at |
|---|---|---|
| `""` | inherit parent value verbatim | `templateBuilder.ts:14-18` |
| `@me` | current user | `templateBuilder.ts:45-48` |
| `@currentiteration` | team default iteration | `templateBuilder.ts:41-42` |
| `Fix for {System.Title}` | placeholder substitution | `templateFilters.ts:194` |
| *(new)* `Math.ceil({Microsoft.VSTS.Scheduling.StoryPoints}*2)` | substitute then evaluate | to be added |

`template.description` carries a JSON blob with `applywhen` / `notapplywhen` / `linkTo`, parsed by `extractJSON` (`templateFilters.ts:137`).

---

## Dependencies

### Imports (What the integration point depends on)

- `templateBuilder.ts` imports: `TFS/WorkItemTracking/Contracts`, `TFS/Work/Contracts` (SDK typings, `empty:` in bundler), `./types`, `./context`, `./templateFilters`. The new `./expressionEvaluator` import will be the 6th.
- The evaluator itself should have zero imports beyond `./logging`.

### Consumers (What depends on this)

- **`workItemCreation.ts:58`**: sole caller of `createWorkItemFromTemplate`.
- **`templateBuilder.ts:22`**: sole caller of `replaceReferenceToParentField`.
- No other consumers; `IsValidTemplateTitle` uses the same `{...}` regex on template *descriptions*, which does not collide with field values.

**Consumer Count**: 1 direct file (`workItemCreation.ts`), 1 indirect (`orchestrator.ts`)
**Impact Scope**: Low - the change is confined to the value-transformation step of one function with one caller; every template field passing `IsPropertyValid` flows through it, so a regression would affect all templates, but the fallback-to-string design keeps existing behaviour intact for non-expression values.

---

## Test Coverage

### Test Files

- None. No `*.test.ts` / `*.spec.ts`, no jest/vitest/mocha/karma config, no `test` script in `src/package.json`. README line 129: "There is no automated test suite yet". Roadmap tracks this as debt (Jest recommended, starting with template filtering). Task state already sets `skip_test_suite: true`.

### Coverage Assessment

- **Test count**: 0 tests
- **Gaps**: everything. The evaluator is pure and synchronous — the best candidate in the repo for the first unit tests — but introducing them means adding a runner, a `test` script, and a second tsconfig (the `module: "amd"` output will not run under Jest/Node without an ESM/CommonJS build).

---

## Coding Patterns

### Naming Conventions

- **Files**: `camelCase.ts` in `src/scripts/`, one responsibility per file; README lines 84-98 hold a Project Structure table that must list any new file.
- **Functions**: ported legacy code uses PascalCase (`IsPropertyValid`, `IsValidTemplateWIT`); new code uses camelCase (`createWorkItemFromTemplate`, `classifyTemplates`). New code -> camelCase.
- **Constants**: SCREAMING_SNAKE.
- **Exports**: named exports only, no default exports, relative imports without extension.

### Architecture Patterns

- **Style**: functional modules, TypeScript ES modules compiled to AMD (`target ES2015`, `strict: true`, `types: []`), inlined into a single `build/scripts/app.js` by the RequireJS optimizer.
- **State Management**: none beyond `ctxState` global `WebContext` and `localStorage` caching.
- **Async**: `.then(onSuccess, onError)` two-arg form; `Promise` and `Q` mixed; `Promise.allSettled` avoided for ES2015. The evaluator should be synchronous — the builder path is sync.
- **Logging**: `logInfo` / `logError` from `./logging`; raw `console.log` (~25 legacy calls) is not to be added to.
- **Error handling**: catch -> `logError` -> safe fallback; per-template failures become `{ status: "failed" }`; auxiliary failures never abort the run.
- **Comments**: `/** */` JSDoc on newer exported functions explaining why; `commenting.md` forbids changelog-style comments.
- **Dependencies**: minimal-dependency standard; the bundler config (`bundle-scripts.js:32-39` `paths ... "empty:"`) makes adding an npm expression parser impractical.
- **Formatting**: 4-space indent; `var` in ported code, `const`/`let` in new code; explicit return types on exported functions.

### Anti-patterns present (do not replicate)

- `extractJSON` reads an uninitialized variable and `logError`s on every failed `JSON.parse` candidate during normal scanning; callers index `[0]` on a possibly-null result.
- Silent `catch { return false }` in `matchField` — expression failures must log the offending text and reason.
- First-occurrence-only `String.replace` and no null-guard in `replaceReferenceToParentField`.
- Commented-out dead code (`templateBuilder.ts:50-54`), duplicated `linkTo` branches, untracked compiled output (`src/scripts/app.js`).

---

## Complexity Assessment

| Factor | Value | Level |
|--------|-------|-------|
| File Size | 205 + 58 lines edited, ~80-150 lines new | Low |
| Dependencies | 5 imports at integration point, 0-1 for the new module | Medium / Low |
| Consumers | 1 direct caller | Low |
| Test Coverage | 0 tests | High (risk) |

### Overall: Moderate

The code change is small and localised (one new module, a one-line integration, a fix to the substitution helper), but three factors raise it above Simple: writing a correct tokenizer/evaluator with sensible error handling is non-trivial; the feature introduces the first evaluated-input surface in a publicly listed Marketplace extension; and there is no safety net of tests.

---

## Key Findings

### Strengths
- Single, obvious integration point with one caller; both agents converged on it independently.
- Patch `value` is already `any` and the transport is plain `JSON.stringify` — numeric results need no plumbing changes.
- Build pipeline auto-includes new `.ts` modules; no manifest or bundler edits.
- Existing precedent for special value syntax (`@me`, `@currentiteration`) and an established catch/log/degrade error philosophy to follow.
- Low collision risk with the in-flight uncommitted work (which touches orchestration, dialog, and build files, not the builder/filters).

### Concerns
- `replaceReferenceToParentField` interpolates the literal text `undefined` for missing fields and replaces only the first occurrence — both silently produce wrong arithmetic.
- No opt-in marker exists in the task description; evaluating every field value would corrupt free-text titles/descriptions containing `+`, `-`, `*`.
- `new Function` / `eval` behaviour inside the sandboxed ADO extension iframe is unverified (no CSP meta tag, but the host's iframe sandbox is independent of that).
- Security: templates are editable by any team member and evaluated in the user's session with `vso.work_write` scope. Arbitrary-JS evaluation would be a Marketplace review concern and violates `validation.md` (allowlists over blocklists).
- Failure visibility: a 400 from ADO reaches the user only as a template name under "Failed" with no reason.
- No tests, no CI, no linting.

### Opportunities
- The evaluator is the ideal first unit-tested module; even a minimal Jest setup with a CommonJS tsconfig would pay off immediately.
- Fixing the substitution helper (replace-all, unresolved-field detection with `logError`) improves the existing feature too.
- Documenting `{Field}` placeholders (currently undocumented in both README and overview) alongside the new expression syntax.

---

## Impact Assessment

- **Primary changes**: `src/scripts/expressionEvaluator.ts` (new); `src/scripts/templateBuilder.ts` (import + one call, lines 20-25); `src/scripts/templateFilters.ts` (harden `replaceReferenceToParentField`: replace-all, unresolved-field detection/logging).
- **Related changes**: `README.md` and `src/overview.md` (new "placeholders and expressions" section, Project Structure table entry); `src/vss-extension.json` + `src/package.json` version bump (and re-sync); `.maister/docs/project/roadmap.md` / `vision.md` feature mentions.
- **Test updates**: none exist; optionally introduce Jest with a CommonJS tsconfig targeting `expressionEvaluator.ts` and `replaceReferenceToParentField`. Manual verification must clear the 4-hour `localStorage` template cache.

### Risk Level: Medium

Small blast radius and a clean fallback path keep it out of Medium-High, but the combination of evaluated input in a public extension, an unresolved CSP question if `new Function` were used, silent `undefined` interpolation in the helper being built on, and zero automated tests warrants Medium.

---

## Recommendations

This is a **new capability layered on existing code**; recommendations cover architecture, integration, and compatibility.

### Architecture
1. **Create `src/scripts/expressionEvaluator.ts`** exporting a synchronous `evaluateFieldExpression(fieldValue: string): string | number` (plus an internal `isExpression` check). Zero dependencies apart from `./logging`.
2. **Hand-rolled allowlisted evaluator**: tokenizer + recursive-descent (or shunting-yard) parser supporting numeric literals (including decimals), `+ - * / %`, unary minus, parentheses, and a fixed `Math.*` allowlist (`ceil`, `floor`, `round`, `abs`, `min`, `max`, `pow`; optionally `trunc`). Reject anything else. This satisfies the task's "JavaScript-style" semantics for arithmetic while sidestepping CSP, security review, and dependency constraints. If the operator insists on `new Function`, gate it behind an allowlist regex and verify `unsafe-eval` in a live org first.
3. **Explicit opt-in marker** (decision needed): recommend a leading `=` (spreadsheet convention) or `${...}` wrapper, checked after substitution. Precedent: `IsPropertyValid` sentinels. Document that the task's example would be written `=Math.ceil({Microsoft.VSTS.Scheduling.StoryPoints}*2)`. If the operator prefers no marker, evaluate only when the *entire* substituted value parses as a valid expression under the allowlist grammar and contains at least one operator or `Math.` call; still fall back to the string on any parse failure.

### Integration
4. **Insert at `templateBuilder.ts:22-24`**: `fieldValue = replaceReferenceToParentField(...)`; then `const value = evaluateFieldExpression(fieldValue)`; push `value`. Widen the local's type to `string | number` (the patch entry is `WorkItemFields`, so `value: any` already accommodates it).
5. **Harden `replaceReferenceToParentField`**: use a global regex replace (or loop until no change) so `{A}+{A}` resolves both; when `currentWorkItem[name]` is `undefined`/`null`, `logError` naming the field and leave the placeholder in place (or return a sentinel) so the evaluator can detect an unresolved reference and skip evaluation rather than compute `NaN`. Prefer keeping the return type `string`; numeric coercion belongs in the evaluator.
6. **Error handling**: on tokenizer/parser failure, non-finite result (`NaN`, `Infinity`), or unresolved placeholder, `logError` with template name, field key, and expression text, then return the substituted string unchanged so the existing `failed`/400 path (or a successful literal write) behaves as today. Never throw.
7. **Result type**: return a native `number` on success. Consider a rounding guard for floating-point artefacts only if a concrete case demands it (minimal-implementation standard).

### Compatibility and delivery
8. Non-expression values must be byte-for-byte unchanged in behaviour; with an explicit marker this is guaranteed.
9. Docs: add a "Field value placeholders and expressions" section to both `README.md` and `src/overview.md` (documenting the pre-existing `{Field}` syntax too), add `expressionEvaluator.ts` to the README Project Structure table, and update roadmap/vision feature lists.
10. Bump and re-sync `vss-extension.json` and `package.json` versions.
11. Do not touch `src/scripts/app.js` (legacy, untracked); consider deleting it in a separate cleanup.
12. Testing: if the operator opts in, add Jest + a `tsconfig.test.json` (`module: commonjs`) and cover: literals, precedence, parentheses, each `Math.*` function, unary minus, division by zero, unknown identifier rejection, unresolved placeholder, non-expression passthrough, and replace-all substitution. Otherwise document a manual verification checklist that includes clearing `linkedTasksAutomation.templateCache.*`.

### Standards to load during implementation
`global/coding-style.md`, `global/error-handling.md`, `global/minimal-implementation.md`, `global/validation.md`, `global/commenting.md`, `build-tooling/packaging.md` (version handling).

---

## Next Steps

Invoke the gap-analyzer with this report. Inputs it should resolve: (1) the opt-in marker syntax, (2) allowlisted evaluator vs `new Function`, (3) whether to add the first Jest setup or keep `skip_test_suite`, (4) desired user-visible behaviour when an expression fails (silent literal write vs `failed` outcome).
