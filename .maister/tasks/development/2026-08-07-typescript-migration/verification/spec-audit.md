# Specification Audit: TypeScript Migration of `src/scripts/app.js`

## TL;DR
**Verdict: PASS-WITH-CONCERNS.** The spec's mechanical claims (line numbers, dead-code inventory, tsconfig/gruntfile wiring, version numbers, standards citations) were independently re-verified against the live codebase and check out — this is a well-grounded spec, not a rubber-stamped one. It also faithfully carries forward the Q1/Q2/Q3 and scope-clarification decision trail without silently re-litigating settled scope. However, direct code inspection surfaced one genuinely new, previously-undetected issue (a duplicate `linkTo` branch pair) that contradicts the spec's own "zero new judgment calls" framing, plus an underspecified fix path for the `bugsBehavior` bug, and a materially wrong call-site estimate for the logging consolidation. None of these block implementation, but all three should be resolved or explicitly acknowledged before the plan is built on top of this spec.

**Issue counts**: 0 Critical, 0 High, 2 Medium, 4 Low.

## Key Decisions
- **Treated the Q1/Q2/Q3 (`clarifications.md`) and six scope items (`scope-clarifications.md`) as settled** — independently confirmed they exist, are correctly cited, and are faithfully restated (not reopened) in `spec.md`. Did not re-litigate these.
- **Classified the duplicate `PreviouslyCreatedTask`/`PreviouslyJustCreatedTask` branch finding as Medium, not High** — it's pre-existing behavior the spec preserves as-is (safe default), not a regression the migration introduces; but it's flagged because none of the four prior analysis passes caught it, undermining the spec's "zero new judgment calls" claim.
- **Classified the `bugsBehavior`/`GetChildTypes` fix-shape ambiguity as Medium** — Core Requirement 10 mandates *that* the bug is fixed but not *how* (independent re-fetch vs. threading the already-fetched `teamSettings` through), and the two options produce different function signatures — a real fork the spec leaves to implementation-time judgment despite otherwise insisting on zero such judgment calls (e.g., the explicit dual-registerTask wiring requirement).

## Open Questions / Risks
- Should `GetChildTypes` (app.js:510-570) be given a `teamSettings` parameter (reusing the value `AddTasks` already fetches at app.js:17-18) instead of independently re-calling `workClient.getTeamSettings(team)` at app.js:526? Spec doesn't say; affects the shape of a function signature change.
- Are `PreviouslyCreatedTask` and `PreviouslyJustCreatedTask` (app.js:123-138) intentionally identical, or is one a latent bug (wrong array/index) that's been shipping unnoticed? Worth a maintainer sign-off before the manual verification checklist is written, since currently the checklist would "verify" two branches that can never produce different output.
- The logging-consolidation effort size (roadmap.md: `[Effort: S]`) was set based on "4 functions," not on knowledge that one of them (`WriteLog`) has zero call sites and the real total is ~6, not ~15+. Worth a quick correction pass so downstream planning doesn't over/under-budget this item.

---

## Scope of This Audit

Independently examined against `spec.md`:
- `src/scripts/app.js` (617 lines, full read + targeted greps)
- `src/gruntfile.js`, `src/package.json`, `src/vss-extension.json`, `src/toolbar.html` (full reads)
- `.maister/docs/standards/build-tooling/packaging.md`, `.maister/docs/project/roadmap.md`, `.maister/docs/project/tech-stack.md` (full reads)
- `analysis/codebase-analysis.md`, `analysis/gap-analysis.md`, `analysis/clarifications.md`, `analysis/scope-clarifications.md`, `analysis/requirements.md`, `analysis/research-context/research-report.md` (full reads, for decision-trail fidelity)
- Confirmed `src/node_modules` and any `.ts`/`.d.ts` files do not yet exist (clean-slate claim holds)

No Azure/GitHub CLI verification was needed — this is a pre-implementation local build-tooling spec with no deployed infrastructure to check.

---

## Verified Claims (spot-checked, all confirmed accurate)

| Spec claim | Verification | Result |
|---|---|---|
| `createChildFromTemplate` inner `.then()` callback doesn't return `createWorkItem(...)` | app.js:53-60, line 57 calls `createWorkItem(...)` with no `return` | Confirmed |
| `createWorkItem` never returns its own `witClient.createWorkItem(...).then(...)` chain | app.js:89, no `return` before `witClient.createWorkItem(...)` | Confirmed |
| `app.js:459` implicit global loop var | `for (category of categories)`, no `let`/`const` | Confirmed, exact line |
| `app.js:526` `.bugsBehavior` read off a pending Promise | `bugsBehavior = workClient.getTeamSettings(team).bugsBehavior;` — reads a property off the Promise object itself, not `.then()`-resolved value | Confirmed, exact line |
| `Controls`, `StatusIndicator`, `Dialogs` imports are dead | grep for `Controls.`, `StatusIndicator.`, `Dialogs.` in app.js body: zero matches outside the `define()` header | Confirmed |
| `getWorkItemFormService` dead, `_WorkItemServices` only used inside it | grep confirms `_WorkItemServices` appears only at line 2 (import) and line 574 (inside the dead function) | Confirmed |
| `linkImtes` typo at definition + 8 call sites | app.js:76, 99, 119, 128, 136, 144, 152, 160, 179 — matches exactly | Confirmed |
| `Log`/`WriteTrace`/`WriteLog` byte-identical | app.js:578-588, all three wrap `console.log('linked-tasks-automation: ' + msg)` | Confirmed |
| `package.json` version `0.10.1` vs `vss-extension.json` `1.1.17` | Both files read directly | Confirmed |
| `declare const VSS` needs exactly 4 methods (`getWebContext`, `init`, `require`, `register`) | Grepped all `VSS.*` call sites across app.js + toolbar.html — no 5th method used | Confirmed |
| No `tsconfig.json`, no TS/`@types` devDependencies, no `node_modules` exist yet | Direct reads/globs | Confirmed (clean slate) |
| `gruntfile.js:46-47` has `registerTask("package-dev", ["exec:package_dev"])` / `registerTask("package-release", ["exec:package_release"])` with no compile step, requiring dual wiring | Read directly | Confirmed |
| Packaging standards (kebab-case tasks, override-file pattern, `--rev-version` dev-only, `private: true`, vendored-SDK copy, `addressable: true`) | Cross-checked `.maister/docs/standards/build-tooling/packaging.md` against `gruntfile.js`/`vss-extension.json`/`package.json` | Confirmed, all present today |
| Q1/Q2/Q3 decision citations | `analysis/clarifications.md` has exactly these three headers with matching rationale | Confirmed, correctly attributed |
| Logging consolidation & version alignment are roadmap Phase-1 items not covered by Q1-Q3 | `roadmap.md:15-16` lists both under Phase 1; `clarifications.md` has no corresponding Q | Confirmed, `scope-clarifications.md` correctly fills this gap |
| Test framework explicitly deferred to Phase 2 | `roadmap.md:22`, `tech-stack.md:23` | Confirmed |

---

## Findings

### Finding 1 (Medium) — Duplicate `linkTo` branch logic never surfaced by any prior analysis pass
**Category**: Ambiguous / Missing decision
**Evidence**: app.js:123-130 (`PreviouslyCreatedTask` branch) and app.js:131-138 (`PreviouslyJustCreatedTask` branch) are byte-for-byte identical: both guard on `justCreatedTasks.length > 1` and index `justCreatedTasks[justCreatedTasks.length - 2]`. Confirmed by direct read — this is not a paraphrase, the two `else if` blocks contain the same condition, same index expression, same log strings' shape (differing only in literal branch name).

**Gap description**: Neither `codebase-analysis.md`, `research-report.md`, `gap-analysis.md`, nor `clarifications.md`/`scope-clarifications.md` mentions this duplication anywhere, despite each doing a full function-by-function or line-cited pass over exactly this block (`createWorkItem`'s `linkTo` directive switch, app.js:109-162). The spec's Implementation Guidance (line 86) instructs the manual verification checklist to exercise "all six [sic — actually seven] `linkTo` directive branches" as if `PreviouslyCreatedTask` and `PreviouslyJustCreatedTask` are behaviorally distinct, when as coded they can never produce a different result.

**Category**: Ambiguous — is this intentional (e.g., a placeholder for a future distinct behavior) or a latent bug (one branch should reference a different index, e.g. `length - 3` or a different source array)? The spec's TL;DR claims "zero new judgment calls" for this migration; this is a new judgment call the decision trail missed.

**Severity**: Medium — no functional harm results from preserving it as-is (the spec's Out-of-Scope section correctly excludes new-behavior additions), but shipping a manual verification checklist item that tests two "branches" with provably identical logic wastes verification effort and risks masking that one of them may be wrong. Should be surfaced to the spec owner for an explicit "preserve as duplicate" vs. "flag as suspected bug, leave `// TODO`" decision before planning, consistent with how Q1-Q3 handled the other pre-existing defects.

**Recommendation**: Add a Key Decision (or amend Core Requirement 15/Compatibility) explicitly stating whether `PreviouslyCreatedTask`/`PreviouslyJustCreatedTask` are knowingly preserved as duplicates, the same way Q1-Q3 explicitly dispositioned the other three pre-existing bugs.

---

### Finding 2 (Medium) — `bugsBehavior`/`GetChildTypes` fix direction underspecified
**Category**: Ambiguous
**Evidence**: Core Requirement 10 says: *"Fix `app.js:526`'s `.bugsBehavior`-read-off-a-pending-Promise bug in `GetChildTypes`: resolve `workClient.getTeamSettings(team)` before reading `.bugsBehavior`."* `GetChildTypes` is called at app.js:27 as `GetChildTypes(witClient, workItemType)` — it does not receive `teamSettings`, even though `AddTasks` already fetches and holds `teamSettings` one closure level up (app.js:17-18, `workClient.getTeamSettings(team).then(function (teamSettings) {...`).

**Gap description**: Two materially different fixes both satisfy the literal wording of Core Requirement 10:
  (a) Add a local `.then()` around a second, redundant `workClient.getTeamSettings(team)` call inside `GetChildTypes` itself (preserves today's — arguably accidental — double-fetch shape, minimal diff).
  (b) Thread the already-fetched `teamSettings` value from `AddTasks` into `GetChildTypes` as a new parameter, eliminating the redundant network call (changes the function's public shape and its one call site).
The spec doesn't indicate which is required, unlike every other build-shape decision in this spec (e.g., Core Requirement 4's explicit "both packaging paths, not left to implementation-time judgment").

**Severity**: Medium — doesn't block implementation (either fix compiles and satisfies "restore `AsTasks`/`AsRequirements` branching"), but the two options have different runtime/network-call-count implications, which is exactly the class of decision this spec elsewhere treats as requiring explicit sign-off rather than implementer discretion.

**Recommendation**: State explicitly in Core Requirement 10 (or a new Key Decision) whether `GetChildTypes` should gain a `teamSettings` parameter (option b) or independently re-resolve it (option a).

---

### Finding 3 (Low) — Logging-consolidation call-site count overstated ~2.5x
**Category**: Incorrect (factual)
**Evidence**: Core Requirement 12 states: *"All ~15+ call sites across the file update to the consolidated utility."* Direct grep of actual call sites for the four named functions: `Log(` → 1 (app.js:598), `WriteTrace(` → 3 (app.js:267, 278, 301), `WriteError(` → 2 (app.js:358, 410), `WriteLog(` → 0 (defined at app.js:586, never called anywhere else in the file). Total: **6** call sites, not "~15+".

**Gap description**: `WriteLog` is not merely "byte-identical" to `Log`/`WriteTrace` as the spec states (app.js:578-588 comment) — it is entirely dead code with zero invocations, a stronger claim the spec doesn't make. The file does contain 49 raw `console.log`/`console.error` calls outside these four wrapper functions, which may be the source of the "~15+" estimate if the spec's author conflated total logging statements in the file with call sites of the four functions being consolidated — but Core Requirement 12 and the Success Criteria only require eliminating "the 4 separate logging functions," not touching the 49 raw calls, so the larger number (if that's its source) doesn't match what's actually in scope either.

**Severity**: Low — doesn't change the required action (still: merge 4 functions into 1 utility, update their call sites), but the size estimate is wrong by a material margin and could mis-size the manual-checklist/implementation-plan step for this item.

**Recommendation**: Correct the call-site count to ~6, and note that `WriteLog` has zero live call sites (pure deletion candidate, not a migration target).

---

### Finding 4 (Low) — "Six" vs. seven `linkTo` directive branches (internal inconsistency)
**Category**: Incorrect (factual)
**Evidence**: Implementation Guidance (spec.md line 86) says the checklist must cover *"all six `linkTo` directive branches"* then lists seven names: `ToAllOtherChilds`, `ToAllJustCreatedTasks`, `PreviouslyCreatedTask`, `PreviouslyJustCreatedTask`, `SecondPreviouslyJustCreatedTask`, `FirstJustCreatedTask`, `SecondJustCreatedTask`. Direct read of app.js:109-162 confirms 7 distinct `if`/`else if` branches, matching the list, not the count.

**Severity**: Low — the enumerated list is complete and correct, so an implementer following the names (not the count) would still cover all branches; but the internal contradiction is a proofreading-level defect worth fixing before this becomes the literal text of a QA checklist.

**Recommendation**: Change "all six" to "all seven" (or drop the number and rely on the enumerated list).

---

### Finding 5 (Low) — `tsconfig.json` `target` left as a range, inconsistent with the spec's otherwise-fully-pinned config
**Category**: Ambiguous (minor)
**Evidence**: Core Requirement 2 pins every other tsconfig value exactly (`"module": "amd"`, `"strict": true`, `"types": ["vss-web-extension-sdk"]`, no `outDir`/`rootDir`, `"include"` scoped to `scripts/**/*.ts`), but specifies target only as *"Target ES level should match syntax already running unmodified in production today ... ES2015+"* — a range, not a value.

**Severity**: Low — any ES2015-or-later target satisfies the stated intent (the code uses no syntax newer than ES2015: `let`/`const`, arrow functions, template literals, `Array.prototype.find`), so this doesn't functionally block implementation. But it's the one dial in an otherwise fully-specified config left open, which cuts against the spec's own "zero new judgment calls" framing.

**Recommendation**: Pin a specific value (e.g., `"ES2015"` or `"ES2017"`) for consistency with the rest of Core Requirement 2, or explicitly note this one is an intentional implementer choice.

---

### Finding 6 (Low) — Core Requirement 16 (packaging-standards preservation) has no mirrored Success Criteria entry
**Category**: Incomplete
**Evidence**: Every other Core Requirement (1-15) has a directly corresponding, checkable line in the Success Criteria section. Core Requirement 16 ("Preserve every documented convention in `.maister/docs/standards/build-tooling/packaging.md`... zero exceptions") has no equivalent Success Criteria bullet.

**Severity**: Low — the requirement itself is unambiguous and independently verifiable against the standards doc, so this doesn't block implementation; it's a documentation-completeness gap that makes final acceptance slightly less mechanically checklist-driven than the rest of the spec.

**Recommendation**: Add a Success Criteria bullet (e.g., "`gruntfile.js`'s task names, override-file pattern, `--rev-version` placement, and `vss-extension.json`'s `addressable: true` entries are byte-identical to pre-migration, except the new `exec.tsc` target").

---

## Decision-Trail Fidelity Check

Verified the spec does **not** re-litigate already-settled scope:
- Q1 (promise-chain fix), Q2 (dead-code deletion), Q3 (implicit-global fixes) from `clarifications.md` are restated as decisions, not reopened as questions. Confirmed.
- The 6 items in `scope-clarifications.md` (TDD-gate skip, dual build-wiring, logging consolidation, version alignment, `linkImtes` rename, `strict: true`) are all present in `spec.md` as settled requirements, not re-debated. Confirmed.
- The one genuinely *new* decision `spec.md` introduces beyond the upstream trail — adding `TFS/WorkItemTracking/Services` to the delete list — is explicitly flagged as new ("Flagged here rather than silently folded in") rather than silently presented as pre-decided. This is the correct pattern the two Medium findings above (duplicate `linkTo` branches, `bugsBehavior` fix shape) should have also received, but didn't.

---

## Compliance Status

**⚠️ Mostly Compliant** — no Critical or High-severity issues. The spec is implementable as written for every Core Requirement except the two Medium-severity ambiguities (Findings 1 and 2), which should be resolved with a one-line addition each before the implementation plan is generated, to avoid the plan silently encoding an unreviewed behavioral choice.
