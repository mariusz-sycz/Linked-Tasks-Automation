# Specification Audit: Arithmetic Expressions in Template Field Values

## TL;DR
Verdict: **PASS WITH CONCERNS** (⚠️ Mostly Compliant). All 12 functional requirements and every Phase 1/2/5 decision are covered by a numbered spec requirement, and every line-number/signature claim I checked against the code is accurate. One major implementability defect: `tsconfig.test.json`'s `esModuleInterop: true` (R17) makes `childTypes.ts` and `templates.ts` fail type-checking under CommonJS (`import * as Q from "q"; Q(...)` is TS2349 with that flag) — reproduced with `tsc`; the claim "verified with `tsc -p`" cannot have held for the full program. Counts: 0 critical, 1 major, 9 minor. The spec's "uncommitted working tree" framing is now stale: commit `551aa91` (2026-08-27) committed everything, so working tree == HEAD.

## Key Decisions
- Severity of the `esModuleInterop` finding is **major, not critical** — `npm test` will most likely still pass (ts-jest only reports diagnostics for files it transforms, and no test imports `childTypes.ts`/`templates.ts`), but `tsc -p tsconfig.test.json` fails, the flag is unnecessary (proved by control run), and any future test touching those modules would break.
- "Skipped required field → template Failed, not Warnings" (System.Title case) is classed **minor/documentation** — it is a consequence of the FINAL log-and-skip decision, not a spec contradiction; it only needs a Known Limitation line.
- The stale git-state statements are **informational** — the spec's content targets the status-based `TemplateOutcome`, which is exactly what HEAD now contains, so nothing in the implementation guidance changes.

## Open Questions / Risks
- `src/scripts/app.js` is now **tracked** (committed in `551aa91`), not "untracked" as the spec and roadmap say; still stale (Aug 8) and still out of scope, but the roadmap's "decide app.js version-control status" debt item is now implicitly decided by that commit.
- The manual check "Integer field with `={Microsoft.VSTS.Common.Priority}/2` → Failed (400)" is only true for odd parent Priority values (2/2 = 1 is a valid integer); the checklist should pin the parent value (e.g. Priority 3).
- VS Code will type-check `src/tests/*.ts` against `src/tsconfig.json` (it does not auto-discover `tsconfig.test.json`), so `describe`/`expect` will show as unresolved in the editor even though `npm test` passes. Editor ergonomics only; optional fix noted below.

---

## 1. Scope and Method

Audited `implementation/spec.md` against `analysis/requirements.md` (FR1-12, all Q&A rounds), `gap-analysis.md`, `codebase-analysis.md`, `clarifications.md`, `scope-clarifications.md`, and the actual source at HEAD `551aa91`. Every code reference in the spec was opened and line-checked. The Jest/tsconfig claims were re-verified by compiling the real modules with a scratchpad-only tsconfig (absolute paths, `--noEmit`, no files added to the repo, no packages installed). No source files were modified.

Tooling facts established: TypeScript 5.9.3 (`npx tsc -v`), Node v22.20.0, no jest/ts-jest packages present in `src/node_modules`, `vss-web-extension-sdk/typings/{vss,tfs,rmo}.d.ts` present; `tfs.d.ts:5` references `vss.d.ts`; `TFS/WorkItemTracking/Contracts` declared at `tfs.d.ts:14799`, `TFS/Work/Contracts` at `:17386`.

## 2. Completeness Matrix (requirements → spec)

| Requirement (requirements.md §5 / Q&A) | Spec coverage | Status |
|---|---|---|
| FR1 `=` marker after trim | R1, R2 `isExpression` | Covered, testable (T1) |
| FR2 grammar allowlist, precedence | R3, R4, R5 | Covered, testable (T2-T5) |
| FR3 placeholder resolution (number / numeric string / else error) | R6 | Covered, testable (T6) |
| FR4 finite result only | R7 | Covered, testable (T7) |
| FR5 push native number | R9 step 2 | Covered (T9 `typeof number`) |
| FR6 logError with template, field, raw expression, reason | R10 | Covered (T9) |
| FR7 child still created; `TemplateOutcome.skippedFields`; dialog `Warnings:` | R8, R11, R12, R13 | Covered (T10) — see finding M2 for the required-field caveat |
| FR8 non-`=` byte-identical; `replaceReferenceToParentField` log-only | R9 step 3, R14, Out of Scope | Covered (T8, T9) |
| FR9 no eval/new Function/3rd-party; sync; AMD-bundled | R2, Reusable Components (bundle row) | Covered — success criterion 3's grep is mis-specified (m6) |
| FR10 Jest + ts-jest, `npm test`, `jest.config.js`, `tsconfig.test.json`, tests in `src/tests/` | R15-R18 | Covered — R17 has an implementability defect (M1) |
| FR11 README + overview identical, new section, structure row, `npm test`; roadmap | R19, R20 | Covered — INDEX.md not mentioned (m8) |
| FR12 both versions to same new minor, last step | R21 (`1.3.0`) | Covered — package-lock version not addressed (m7) |
| Phase 5 #5 exact dialog wording | R13 examples match verbatim | Covered |
| Phase 5 #6 `=` on any field; reserved values keep handling | R9 paragraph 2 | Covered |
| Decision `harden-substitution` (log only, output unchanged) | R14 | Covered |
| Decision `version-bump` / `roadmap-update` / `test-location` / `readme-test-line` | R21 / R20 / R18 / R19.4 | Covered |

No requirement is missing. Two additions beyond requirements.md (`BuiltWorkItem` return shape, `formatCompletionMessage`) are justified in "New Components Required" and are the minimal way to satisfy the `failure-visibility` expansion; each has an immediate caller (minimal-implementation.md satisfied).

## 3. Implementability — claims verified against code

| Spec claim | Evidence | Result |
|---|---|---|
| `createWorkItemFromTemplate` single caller at `workItemCreation.ts:58` | `src/scripts/workItemCreation.ts:58` `var newWorkItem: WorkItemFields[] = createWorkItemFromTemplate(...)`; `grep` finds no other caller | Accurate |
| `createWorkItem` spans `:54-162`; outcome literal at `:144-149`; error path `:150-161` | Lines 54, 144-149 (`{ templateName, status: parentLinkSucceeded ? "created" : "failed" }`), 150-161 | Accurate |
| `console.log(newWorkItem)` at both success and error paths | `:63` and `:152` | Accurate |
| `TemplateOutcome` at `progressDialogController.ts:12-17`, status-based; `showCompletionDialog` `:58-86` assembles `'Task creation finished:\n\n' + lines.join('\n')` at `:73` | Confirmed; `getDialogService()` (`VSS.getService`) is only invoked inside the dialog functions, so importing the module under Jest does not touch the `VSS` global | Accurate; `formatCompletionMessage` extraction is feasible without stubbing `VSS` |
| Builder loop `templateBuilder.ts:11-27`; empty-value branch `:14-18`; defaults block acts only on `null`/`@currentiteration`/`@me` | `:30-48` — confirmed | Accurate, but see M2 |
| `IsPropertyValid` `templateFilters.ts:177-192`; `replaceReferenceToParentField` `:194-205`; `matchField` `:75-109` | Confirmed | Accurate |
| `WorkItemFields` at `types.ts:14`, `value: any` | Confirmed | Accurate |
| `JSON.stringify` transport | `keepaliveFetchClient.ts:42` | Accurate |
| Bundler inlines new module automatically; `paths` `empty:` at `bundle-scripts.js:32-39` | Confirmed; `build/scripts/*` non-bundle files deleted at `:48-52` | Accurate |
| `/// <reference path>` precedent `app.ts:1-2` | Confirmed | Accurate |
| 15 → 16 focused files | 15 `.ts` files in `src/scripts/` today | Accurate |
| `tsconfig.json` `include: ["scripts/**/*.ts"]`, `types: []` keeps `src/tests/` out of production | Confirmed; `copy:static` copies only named files; `vss-extension.json` `files` lists only `img`, `toolbar.html`, `scripts/app.js`, `lib/VSS.SDK.min.js` | Accurate — no test-leak path into `build/` or the `.vsix` |
| Type-only `TFS/*` namespace imports are elided under CommonJS | Emitted `templateBuilder.js` requires only `./context`, `./templateFilters`; `templateFilters.js` only `./logging`; `progressDialogController.js` only `./logging`; `types.js`/`context.js` require nothing | Accurate |
| `files: [tfs.d.ts]` needed to seed ambient `TFS/*` modules | Control compile **without** the `files` entry also passes: `app.ts:2` already `/// <reference>`s `tfs.d.ts` and `app.ts` is in `include`, so the program gets the typings either way (ts-jest seeds its language service from the same `include` list) | Redundant but harmless; keep as belt-and-braces |
| `esModuleInterop: true` "silences ts-jest's interop warning"; config "verified with `tsc`" | Full-program `tsc --noEmit` with the R17 options **fails**: `childTypes.ts(24,16)/(26,12)/(40,16)/(42,12)` and `templates.ts(16,12)` `TS2349: This expression is not callable. Type 'typeof Q' has no call signatures`. Same config without `esModuleInterop` → exit 0. Production tsconfig → exit 0 | **Defect — see M1** |

## 4. Findings

### Critical
None.

### Major

**M1. `esModuleInterop: true` in `tsconfig.test.json` breaks type-checking of `childTypes.ts` and `templates.ts`**
- **Spec reference**: R17 — `"esModuleInterop": true (silences ts-jest's interop warning; ...)`; Key Decisions bullet 7 — "verified with `tsc`".
- **Evidence**: `src/scripts/childTypes.ts:4` `import * as Q from "q"` then `Q(cached)` at `:24,26,40,42`; `src/scripts/templates.ts:3`/`:16` same pattern. With `esModuleInterop`, a namespace import is not callable → TS2349 (reproduced: `npx tsc --noEmit -p <scratch tsconfig extending src/tsconfig.json with module=commonjs, esModuleInterop=true, files=[tfs.d.ts]>` exits 2 with the five errors above; identical config minus `esModuleInterop` exits 0).
- **Impact**: `tsc -p tsconfig.test.json` (the verification the spec itself cites, and the natural CI/IDE check) fails. `npm test` probably passes today only because ts-jest reports diagnostics per transformed file and no planned test imports `childTypes.ts`/`templates.ts`; the roadmap follow-up "extend Jest coverage to template filtering" would hit it immediately.
- **Category**: Incorrect. **Severity**: Major — blocks the spec's own verification step and contradicts a claim of verification; trivial to fix.
- **Recommendation**: Remove `esModuleInterop` from R17 (the ts-jest hint TS151001 is a warning, not an error; it can be left, or silenced via `diagnostics: { ignoreCodes: [151001] }` in the ts-jest transform options). Also replace the "verified with `tsc`" wording with the actual command the implementer must run: `npx tsc --noEmit -p tsconfig.test.json` from `src/` must exit 0.

### Minor

**M2. "Child is still created" does not hold when the skipped field is required (e.g. `System.Title`)**
- **Spec reference**: R9 ("The `=` marker is honoured on any field ... including `System.Title`"), user story 2, success criterion 4 ("A template with one failing expression still creates the child").
- **Evidence**: `templateBuilder.ts:30-31` backfills the parent title only when `taskTemplate.fields['System.Title'] == null`. If the template's Title is `=<failing expr>`, the key exists, the loop pushes nothing, the defaults block does not fire, and the PATCH carries no `System.Title` → Azure DevOps 400 → `workItemCreation.ts:150-161` `failed` outcome; `built.skippedFields` is dropped (R11: failed outcomes never carry it).
- **Category**: Ambiguous/Incomplete (spec overstates). **Severity**: Minor — the log at R10 still names the field; an author would not realistically put an expression in Title, and the FINAL decision is log-and-skip.
- **Recommendation**: Add to Known Limitations and to the README failure-behaviour paragraph: "If the skipped field is required by the work item type (e.g. Title), Azure DevOps rejects the child and the template is reported as Failed; the console still shows the expression error." Optionally add a T9 case pinning "Title expression fails → no `System.Title` entry, no backfill".

**M3. `unknown identifier` vs `unsupported function` discriminator is not pinned**
- **Spec reference**: R3 IDENT row, R5, T5 (`=abc` → `unknown identifier 'abc'`; `=math.ceil(1)` → `unsupported function 'math.ceil'`).
- **Evidence**: Two rules satisfy all T5 cases — (a) IDENT followed by `(` → call path → `unsupported function` if not allowlisted, otherwise `unknown identifier`; (b) IDENT containing a `.` → `unsupported function`, else `unknown identifier`. They diverge for `=abc(1)` and `=Math.ceil` (no parens).
- **Category**: Ambiguous. **Severity**: Minor (console text only).
- **Recommendation**: Pin rule (a) in R3/R4: "`primary` on IDENT: if the next token is `(` → `call`; a `call` whose IDENT is not in the R5 table → `unsupported function '<ident>'`; an IDENT not followed by `(` → `unknown identifier '<ident>'`." Add `=Math.ceil` → `unknown identifier 'Math.ceil'` (or whichever is chosen) to T5.

**M4. `FIELD` token error for a nested `{` is unspecified**
- **Spec reference**: R3 FIELD row defines `{}` and missing `}` only.
- **Evidence**: `={A{B}` — the rule "one or more characters that are not `{` or `}`" stops at the inner `{`; whether that is `unexpected character '{' at index 2` or `unterminated field reference at index 0` is an implementer's choice.
- **Category**: Ambiguous. **Severity**: Minor.
- **Recommendation**: One sentence in R3: "a `{` inside a field reference → `unexpected character '{' at index i`".

**M5. R7 reason text can embed an unbounded parent value, contradicting "reasons are short"**
- **Spec reference**: R6 last row `parent field 'n' value '<String(v)>' is not numeric`; R7 "Reasons are short".
- **Evidence**: `{System.Description}` yields the full HTML body; `{System.AssignedTo}` yields `[object Object]`.
- **Category**: Ambiguous/Incorrect (self-contradiction). **Severity**: Minor — console only.
- **Recommendation**: Specify truncation (e.g. first 40 characters + `…`) or drop the value and report `typeof v` instead.

**M6. Success criterion 3's grep is not testable as written**
- **Spec reference**: Success Criteria 3 — "grep of `src/scripts/expressionEvaluator.ts` finds neither [`eval`/`new Function`]".
- **Evidence**: The exported function is named `evaluateExpression`; a grep for `eval` always matches.
- **Category**: Incorrect (acceptance criterion). **Severity**: Minor.
- **Recommendation**: `grep -nE '\beval\s*\(|new\s+Function\b' src/scripts/expressionEvaluator.ts` returns nothing.

**M7. `package-lock.json` root `version` is left at `1.1.17` after R21**
- **Spec reference**: R15 ("`package-lock.json` is updated by `npm install`"), R21 (version bump is the last step; "Nothing else in either manifest changes").
- **Evidence**: `src/package-lock.json:3` and `:9` carry `"version": "1.1.17"`; npm rewrites them only on the next install. With the ordering in the spec (install first, bump last) the lock stays at `1.1.17`.
- **Category**: Incomplete. **Severity**: Minor — no functional effect, but leaves the repo inconsistent right after a "version alignment" task.
- **Recommendation**: Add to R21: "then run `npm install --package-lock-only` from `src/` so `package-lock.json` reads `1.3.0`", and add it to success criterion 7.

**M8. `.maister/docs/INDEX.md` summaries will be stale after R20**
- **Spec reference**: R20 updates `roadmap.md` and `tech-stack.md` but not `INDEX.md`.
- **Evidence**: `INDEX.md:23` describes the roadmap as "tracked technical debt (no tests, ...)"; `INDEX.md` "Keep Updated" rule requires INDEX changes when docs change significantly. The tech-stack summary ("no CI/CD or linting currently configured") stays true; the roadmap line and the tech-stack "Testing" wording do not.
- **Category**: Incomplete (docs). **Severity**: Minor.
- **Recommendation**: Add one bullet to R20: update the roadmap and tech-stack one-liners in `INDEX.md` ("partial test coverage (Jest)" / "Jest 29 + ts-jest").

**M9. R14 logging edge cases: per-occurrence count and stray-`}` false positives**
- **Spec reference**: R14; T8 ("`console.error` called with a message containing ...").
- **Evidence**: (a) `{A}+{A}` with `A` missing → the loop at `templateFilters.ts:197-202` visits the name twice → two logs; T8 does not say whether `toHaveBeenCalledTimes(1)` or `(2)` is expected. (b) The regex `/[^{\}]+(?=})/g` at `:195` matches text before a `}` without a preceding `{` (e.g. `"abc}"` → `abc`), so R14 would log "Parent field 'abc' ... is missing; substituting the literal text 'undefined'" while `replace('{abc}', ...)` substitutes nothing — a misleading message.
- **Category**: Ambiguous. **Severity**: Minor — pre-existing regex quirk; output is unchanged by decision.
- **Recommendation**: State "one `logError` per placeholder occurrence (per regex match)" and, optionally, only log when `fieldValue.indexOf('{' + parentField + '}') >= 0` (logging-only change, output still untouched).

**M10. Stale git-state statements (informational)**
- **Spec reference**: Open Questions bullet 2 ("carry uncommitted modifications ... specified against the working tree, not `git HEAD`"), Out of Scope ("`src/scripts/app.js` (stale untracked artifact)"), Key Decisions bullet 8 ("in-flight `1.2.8` bump").
- **Evidence**: `git log` shows `551aa91 2026-08-27 "Commit changes from last release"` containing `progressDialogController.ts`, `workItemCreation.ts`, `orchestrator.ts`, `app.ts`, `gruntfile.js`, `bundle-scripts.js`, `vss-extension.json` (1.2.8), `overview.md`, **and `src/scripts/app.js`**; `git status` shows only `.maister/` changes; `git diff HEAD -- src/` is empty.
- **Category**: Ambiguous (outdated context). **Severity**: Minor — the spec's technical content already matches HEAD.
- **Recommendation**: Reword to "specified against HEAD `551aa91` (status-based `TemplateOutcome`)"; change "untracked" to "tracked legacy artifact, do not edit". The roadmap's "Decide `src/scripts/app.js` version-control status" item could be ticked or reworded in R20 since the commit decided it.

## 5. Ambiguity Review (items checked and found unambiguous)

- Tokenizer index base (0-based into the trimmed body) — explicit; consistent with T3 `=+2` → index 0.
- NUMBER (`1.` rejected, `.5` accepted, no exponent), `**` as two `*` tokens rejected by the parser, unary `+` rejected — all explicit and mutually consistent with T2/T3/T5.
- Precedence/associativity — EBNF and the worked examples agree with JavaScript for the supported set (`10-4-3` = 3, `8/2/2` = 2, `2*-3` = -6, `--3` = 3).
- Arity messages — exact strings per function class, including the `at least 1` wording for `min`/`max`.
- Placeholder table (R6) — exhaustive over `number`/numeric string/`undefined`/`null`/blank/other; `Number("Infinity")` correctly lands in "not numeric" (row 7), booleans are explicitly rejected despite `Number(true) === 1`.
- Return shapes — `EvaluationResult` union and `BuiltWorkItem` interface fully typed; `skippedFields` optional and only on `created`.
- Dialog — separator strings, ordering (`Failed:` before `Warnings:`), pluralisation rule, and the "unchanged when nothing skipped" guarantee are explicit; `formatCompletionMessage` returns the full message (header included), so T10 assertions should use `toContain`/line splitting — implied but workable.
- Log format (R10) — exact template with example output.

## 6. Standards Compliance

| Standard | Assessment |
|---|---|
| `validation.md` (allowlists, fail fast, specific errors) | Compliant: grammar and function table are allowlists; first failing token wins; reasons name the token/field. |
| `error-handling.md` (typed exceptions, boundary handling, graceful degradation, clear user messages) | Compliant: one private error class caught at `evaluateExpression`; nothing throws out of the pipeline; dialog shows counts only, console carries detail. |
| `minimal-implementation.md` | Compliant: no AST, no operator tables, seven functions only, every new export has a caller (`isExpression`, `evaluateExpression` → builder; `formatCompletionMessage` → `showCompletionDialog`; `BuiltWorkItem` → return type). |
| `coding-style.md` / `commenting.md` | Compliant as specified: camelCase, focused per-rule functions, JSDoc on exports only, no changelog comments. Note: the existing `showCompletionDialog` JSDoc (`progressDialogController.ts:49-57`) says "plus failed template names" — R13 should extend it to mention warnings so the comment stays truthful. |
| `conventions.md` (README current, minimal deps) | Compliant: three test-only devDependencies; README/overview updated; INDEX.md gap noted (M8). |
| `testing/test-writing.md` | Compliant: behaviour-focused, no internals asserted, only `console.error` spied. |
| `build-tooling/packaging.md` | Compliant: manual release bump, manifest `files`/contributions untouched, `name` still equals manifest `id`, `private` retained. |

## 7. Risk Review

- **Existing non-`=` values**: safe by construction — the `=` branch is gated on `isExpression`; R9 step 3 is literally today's code; R14 adds a log only. The only behaviour change for existing templates is a value that already starts with `=` (accepted, FINAL decision; no escape).
- **Test files leaking into `build/` or the bundle**: no path found — `tsconfig.json` include is `scripts/**/*.ts`; `bundle-scripts.js` deletes every non-bundle file in `build/scripts/`; `copy:static` and the manifest `files` array are explicit allowlists; `.gitignore` has no pattern matching `src/tests/`.
- **Accidental emit from the test tsconfig**: `tsconfig.test.json` inherits `outDir: ../build/scripts` from `tsconfig.json`; a manual `tsc -p tsconfig.test.json` would write CommonJS files into `build/scripts/` (harmless for `grunt build`, which cleans first, but confusing). Recommend adding `"noEmit": true` to R17 — ts-jest overrides `noEmit` internally, so tests are unaffected.
- **Editor type-checking of tests**: VS Code resolves `src/tests/*.ts` to `src/tsconfig.json` (`types: []`) → Jest globals flagged in the editor. Optional: add `src/tests/tsconfig.json` = `{ "extends": "../tsconfig.test.json" }` (not required for `npm test`).
- **Manual verification determinism**: the Integer-field check depends on parent Priority parity (see Open Questions).

## 8. Recommended Spec Changes (ordered)

1. R17: remove `esModuleInterop`; add `"noEmit": true`; replace "verified with tsc" with the concrete gate `npx tsc --noEmit -p tsconfig.test.json` exits 0 (M1).
2. Known Limitations + R19 failure paragraph: required-field skip (Title) → template Failed (M2).
3. R3/R4: pin the `unknown identifier` vs `unsupported function` rule and the nested-`{` error (M3, M4).
4. R6/R7: bound the `<String(v)>` fragment (M5).
5. Success criterion 3: word-boundary grep (M6).
6. R21 + success criterion 7: `npm install --package-lock-only` after the bump (M7).
7. R20: INDEX.md one-liners (M8); optionally tick/reword the `app.js` debt item (M10).
8. R14/T8: per-occurrence logging statement (M9).
9. Open Questions / Out of Scope: replace "uncommitted"/"untracked" wording with HEAD `551aa91` (M10).
10. Success criterion 8: fix the parent Priority value for the Integer-field check.

## 9. Compliance Status

⚠️ **Mostly Compliant** — proceed to planning after applying change 1 (five-minute fix); changes 2-10 can be folded into the plan as notes.
