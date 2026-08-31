window.MAISTER_DATA = {
  generated: "2026-08-30T10:44:32Z",
  task: {
    title: "Arithmetic expressions in template field values",
    type: "development",
    status: "completed",
    description: "Allow template field values to contain JavaScript-style arithmetic expressions over parent field placeholders, e.g. Math.ceil({Microsoft.VSTS.Scheduling.StoryPoints}*2), evaluated at child creation time.",
    path: ".maister/tasks/development/2026-08-26-template-field-arithmetic-expressions",
    current_activity: null
  },
  characteristics: { has_reproducible_defect: false, modifies_existing_code: true, creates_new_entities: true, involves_data_operations: false, ui_heavy: false },
  phases: [
    { id: "phase-1", name: "Analyze codebase & clarify requirements", icon_hint: "analysis", status: "completed", started: "2026-08-26T17:29:48Z", completed: "2026-08-27T04:56:29Z", skip_reason: null,
      summary: "Feature integrates at a single seam (templateBuilder.ts after placeholder substitution) via a new synchronous expressionEvaluator.ts; no build/transport changes required. Clarified: safe arithmetic subset, leading = marker, skip field on failure, add Jest.",
      decisions: [
        {decision: "New module src/scripts/expressionEvaluator.ts, called from templateBuilder.ts right after placeholder substitution", rationale: "matches the one-concern-per-file pattern; templateFilters.ts is already the largest file and is about filtering, not value transformation"},
        {decision: "Hand-rolled allowlisted evaluator (numeric literals, + - * / % ( ), fixed Math.* subset) rather than new Function/eval", rationale: "avoids the unverified unsafe-eval CSP question in the sandboxed extension iframe, satisfies validation.md (allowlists over blocklists), and needs no npm dependency"},
        {decision: "Explicit opt-in marker for expression evaluation: leading =", rationale: "the existing @me / @currentiteration sentinels in IsPropertyValid are the precedent for special value syntax; auto-detection would corrupt free-text fields"},
        {decision: "On missing parent field or evaluation failure: log and skip the field; create the child with its remaining fields", rationale: "consistent with the project's catch/log/degrade philosophy"},
        {decision: "Add Jest + ts-jest with a test-only CommonJS tsconfig and npm test script", rationale: "the evaluator is pure logic and the roadmap already plans Jest"},
        {decision: "Fix replaceReferenceToParentField to replace all occurrences and detect unresolved fields as part of this work", rationale: "{A}+{A} and missing fields are the two most likely real-world failure modes for arithmetic"}
      ],
      risks: [
        "resolved: Marker syntax is unspecified by the task - decided: leading = prefix.",
        "resolved: Evaluation mechanism - decided: safe arithmetic subset, no new Function.",
        "Result typing: value: 5 vs value: \"5\" - ADO accepts both for numeric fields, but \"NaN\"/\"undefined\" cause a 400 that surfaces only as a failed entry in the completion dialog with no reason shown to the user.",
        "No test infrastructure exists; adding Jest requires a second tsconfig because module: amd won't run under Jest.",
        "Templates are cached in localStorage for 4 hours (templateCache.ts) - manual verification must clear linkedTasksAutomation.templateCache.* keys.",
        "Uncommitted work on main (TemplateOutcome refactor, bundler, docs rewrite of overview.md) - low collision risk for code, but the new docs section must land in the rewritten structure of both README.md and src/overview.md.",
        "Two structural quirks in the substitution regex: it matches text before } without requiring {, and String.replace with a string pattern only replaces the first occurrence."
      ],
      artifacts: [ {path: "analysis/codebase-analysis.md", label: "Codebase analysis", html: null}, {path: "analysis/clarifications.md", label: "Clarifications", html: null} ],
      gate: {question: "Phase 1 clarifying questions (evaluator, marker, failure handling, tests)", answer: "Safe arithmetic subset; leading = prefix; skip field on failure; add Jest"} },
    { id: "phase-2", name: "Analyze gaps & clarify scope", icon_hint: "analysis", status: "completed", started: "2026-08-27T04:56:29Z", completed: "2026-08-27T05:58:57Z", skip_reason: null,
      summary: "No evaluation exists today; gap is a new allowlisted evaluator module, a marker-gated branch in templateBuilder.ts, missing-field detection, first Jest setup, and docs. Remaining decisions are edge semantics, scope boundaries, versioning, and one unverified product risk (ADO template editor accepting '=' text in numeric fields).",
      decisions: [
        {decision: "Authoring feasibility resolved - ADO accepts a template field value beginning with =", rationale: "verified by the user in a live org"},
        {decision: "Evaluator resolves {Field} placeholders itself", rationale: "textual splicing causes undefined/null/2--3/string-injection failures; in-evaluator lookup gives precise errors and a pure, testable module"},
        {decision: "{Field} values inside expressions: JS numbers and numeric strings; anything else -> error + skip", rationale: "custom text fields sometimes hold numeric strings; identities/dates/HTML can never survive arithmetic"},
        {decision: "Every value starting with = is an expression; trim; parse/evaluation failure -> log + skip the field", rationale: "consistent and heuristic-free; no escape for a literal leading = (documented limitation)"},
        {decision: "Write the raw numeric result; NaN/Infinity/division-by-zero are always errors -> skip", rationale: "docs instruct authors to wrap with Math.round/ceil/floor for integer fields"},
        {decision: "replaceReferenceToParentField: add logError on undefined/null placeholder; output unchanged", rationale: "replace-all verified working; existing users' output must stay byte-for-byte identical"},
        {decision: "SCOPE EXPANSION: extend TemplateOutcome with warnings and show 'created with N field(s) skipped' in the completion dialog", rationale: "user wants skipped fields visible outside the browser console"},
        {decision: "Align vss-extension.json and package.json to the same new minor version as the last step; fix roadmap Current State", rationale: "packaging standard requires manual bumps; roadmap claims an alignment that regressed"},
        {decision: "Minor defaults: tests in src/tests/*.test.ts; update roadmap.md; replace README/overview 'no test suite' line", rationale: "recommended defaults from gap analysis"},
        {decision: "has_reproducible_defect = false", rationale: "the undefined interpolation is a latent quirk hardened incidentally, not the task's goal; no failing scenario was reported by a user"},
        {decision: "involves_data_operations = false", rationale: "the feature transforms a value inside the existing child-CREATE pipeline; it introduces no entity with its own CRUD lifecycle"},
        {decision: "ui_heavy = false", rationale: "the extension has no settings UI; authoring happens in Azure DevOps' own template editor and the only user-visible surface is the existing completion dialog, which is not changed"},
        {decision: "Placeholder resolution should happen inside the evaluator (numeric token substitution), not by textual splicing before parsing", rationale: "textual splicing is the root of the undefined, null, 2--3 and string-value failure modes (flagged as an important decision)"}
      ],
      risks: [
        "resolved: Authoring feasibility - user verified ADO accepts =-prefixed template values. Original risk: the Azure DevOps template editor renders the real work item form; numeric fields (Story Points, Effort, Remaining Work) may reject non-numeric text and block Save. If so, = expressions can only be authored for string fields via the UI, or via the Templates REST API.",
        "Integer-typed fields (Microsoft.VSTS.Common.Priority, BusinessValue) will 400 on a non-integer result, surfacing only as a failed template name in the completion dialog.",
        "Jest + module: amd do not mix: tests need a second tsconfig (CommonJS) that also pulls in the SDK's typings/*.d.ts; test files must live outside scripts/** (or be excluded) so tsc does not compile them into build/.",
        "Templates are cached in localStorage for 4 hours; manual verification must clear linkedTasksAutomation.templateCache.* after editing a template.",
        "The uncommitted in-flight work already bumps vss-extension.json to 1.2.8 while package.json stays at 1.1.17; any version handling in this task lands on top of that."
      ],
      artifacts: [ {path: "analysis/gap-analysis.md", label: "Gap analysis", html: null}, {path: "analysis/scope-clarifications.md", label: "Scope clarifications", html: null} ],
      gate: {question: "Decision gate (1 critical + 7 important) then: Continue to Phase 5?", answer: "Decisions recorded in scope-clarifications.md; Continue to Phase 5"} },
    { id: "phase-3", name: "Write failing test (TDD Red)", icon_hint: "verify", status: "skipped", started: null, completed: "2026-08-27T05:58:57Z", skip_reason: "has_reproducible_defect is false", summary: null, decisions: [], risks: [], artifacts: [], gate: null },
    { id: "phase-4", name: "Generate UI mockups", icon_hint: "spec", status: "skipped", started: null, completed: "2026-08-27T05:58:57Z", skip_reason: "ui_heavy is false", summary: null, decisions: [], risks: [], artifacts: [], gate: null },
    { id: "phase-5", name: "Gather requirements & create specification", icon_hint: "spec", status: "completed", started: "2026-08-27T05:58:57Z", completed: "2026-08-27T07:02:18Z", skip_reason: null,
      summary: "Spec (21 requirements) pins the allowlisted =-prefixed evaluator (grammar, API, placeholder rules, error taxonomy), templateBuilder integration returning skippedFields, TemplateOutcome/dialog warnings via a testable formatCompletionMessage, Jest 29 + ts-jest setup with 10 test groups, docs and 1.3.0 version alignment.",
      decisions: [
        {decision: "createWorkItemFromTemplate returns { patchDocument, skippedFields } (BuiltWorkItem) instead of an out-parameter", rationale: "single caller at workItemCreation.ts:58; explicit, unit-testable, no mutable argument threading"},
        {decision: "skippedFields attached only to created outcomes", rationale: "failed templates are already flagged by name; the warning means 'created but incomplete'"},
        {decision: "Evaluator resolves {Field} placeholders itself; replaceReferenceToParentField not called for = values", rationale: "avoids undefined/null/2--3/string-injection failure modes; helper output stays byte-identical for non-= values"},
        {decision: "One private typed error caught at the evaluateExpression boundary; module never throws or logs", rationale: "error-handling.md typed exceptions + centralized handling; caller owns the log so it can name template and field"},
        {decision: "Evaluate during parsing, no AST", rationale: "tiny grammar with no second consumer; AST would be a speculative abstraction (minimal-implementation.md)"},
        {decision: "Extract formatCompletionMessage from showCompletionDialog", rationale: "only way to unit-test exact dialog wording without stubbing the VSS global; has an immediate caller"},
        {decision: "tsconfig.test.json extends tsconfig.json with module commonjs, types [jest], and files: [tfs.d.ts]; no moduleNameMapper", rationale: "verified with tsc that type-only TFS/* namespace imports are elided under CommonJS"},
        {decision: "Version 1.3.0 for both manifests, applied as the last step", rationale: "new feature on top of the in-flight 1.2.8 bump; new minor per the version-bump decision; packaging.md requires manual release bumps"}
      ],
      risks: [
        "Integer-typed ADO fields reject non-integer results with 400 -> template shows as Failed; mitigated by documentation only",
        "progressDialogController.ts / workItemCreation.ts / orchestrator.ts / app.ts have uncommitted modifications; spec targets the working tree, not git HEAD",
        "Templates cached in localStorage for 4h; manual verification must clear linkedTasksAutomation.templateCache.* keys",
        "If ts-jest does not seed SDK typings from tsconfig files, a triple-slash reference in the affected test file is the fallback",
        "No live Azure DevOps org for automated runtime verification; covered by the manual checklist in Success Criteria"
      ],
      artifacts: [ {path: "analysis/requirements.md", label: "Requirements", html: null}, {path: "implementation/spec.md", label: "Specification", html: "implementation/spec.html"} ],
      gate: {question: "Continue to the specification audit?", answer: "Continue to spec audit"} },
    { id: "phase-6", name: "Audit specification", icon_hint: "verify", status: "completed", started: "2026-08-27T07:02:18Z", completed: "2026-08-27T15:02:50Z", skip_reason: null,
      summary: "Verdict pass_with_concerns: 0 critical, 1 major, 9 minor. All requirements/decisions covered and line-number claims accurate. Major: R17 esModuleInterop:true breaks tsc under CommonJS (Q(...) not callable in childTypes.ts/templates.ts) - drop the flag, add noEmit. Also: skipping a required field (e.g. =expr on System.Title) yields a Failed template, needs a Known Limitation; the 'uncommitted working tree' framing is stale (commit 551aa91 committed it all, app.js now tracked).",
      decisions: [ {decision: "Apply all 10 recommended spec changes before planning", rationale: "user choice at the Phase 6 gate; the major finding would fail the spec's own tsc verification step"} ],
      risks: [
        "resolved: R17 esModuleInterop major finding - flag removed, noEmit added, concrete tsc gate stated.",
        "tsconfig.test.json inherits outDir ../build/scripts; a manual tsc -p tsconfig.test.json would emit CommonJS into build/ - mitigated by noEmit:true",
        "VS Code type-checks src/tests/*.ts against src/tsconfig.json (types: []), so Jest globals show as errors in the editor even though npm test passes; optional src/tests/tsconfig.json",
        "Existing template values that already start with '=' change behaviour (accepted FINAL decision, no escape)",
        "R14 relies on the pre-existing regex that matches text before '}' without a '{', so a stray '}' will log a misleading 'missing field' message (output unchanged)"
      ],
      artifacts: [ {path: "verification/spec-audit.md", label: "Spec audit", html: null} ],
      gate: {question: "Spec audit: pass with concerns (1 major, 9 minor). How to proceed?", answer: "Apply all 10 audit fixes, then plan"} },
    { id: "phase-7", name: "Plan implementation", icon_hint: "plan", status: "completed", started: "2026-08-27T15:02:50Z", completed: "2026-08-28T04:33:51Z", skip_reason: null,
      summary: "8 task groups / 35 steps in 5 waves: (1) Jest harness, (2|3|4) evaluator module, substitution logging, outcome/dialog wording in parallel, (5) builder integration, (6|7) build verification + docs, (8) version 1.3.0 last. Every R1-R21 and T1-T10 mapped in the coverage matrix.",
      decisions: [
        {decision: "T8's three behaviour-pinning cases are written in Group 1 before any production change", rationale: "They double as the ts-jest harness proof (a module with type-only TFS/* imports compiles) and as the byte-identical baseline for non-= values"},
        {decision: "Evaluator tests are seven test.each blocks, one per spec table", rationale: "Keeps the 2-8 tests-per-group rule at block level while covering all 66 R18 rows verbatim"},
        {decision: "TemplateOutcome.skippedFields + formatCompletionMessage form their own group (4), independent of the evaluator", rationale: "workItemCreation.ts needs the widened type to compile under strict; Group 5 becomes the single editor of that file"},
        {decision: "replaceReferenceToParentField logging (R14) is a separate group (3)", rationale: "Different file, no shared state, enables three-way parallelism in Wave 2"},
        {decision: "Build verification and test gap review are merged into Group 6", rationale: "Both are read-mostly checks over finished code; both must pass before docs claim npm test coverage"},
        {decision: "Docs (Group 7) depend on Group 5, not Group 6", rationale: "Content is fully specified by R19/R20; running alongside verification shortens the critical path"}
      ],
      risks: [
        "Group 1 requires network access for npm install of Jest/ts-jest/@types/jest; registry unavailability stalls Wave 1",
        "package-lock.json is rewritten by Group 1 and Group 8; declared in both so the executor serializes them; never hand-edit",
        "Group 7 writes 1.3.0 into roadmap/tech-stack before Group 8 sets it in the manifests; repo is consistent only after Wave 5",
        "ts-jest hint TS151001 must stay a warning; enabling esModuleInterop breaks childTypes.ts/templates.ts (TS2349)",
        "grunt package-dev is broken on Node v22; verification uses npx grunt build only; no live org, so success criterion 8 is manual",
        "TaskCreate/TaskUpdate unavailable in this session; no task-system items were created"
      ],
      artifacts: [ {path: "implementation/implementation-plan.md", label: "Implementation plan", html: "implementation/implementation-plan.html"} ],
      gate: {question: "Continue to Phase 8: Implementation?", answer: "Continue to implementation (parallel waves)"} },
    { id: "phase-8", name: "Execute implementation", icon_hint: "code", status: "completed", started: "2026-08-28T04:33:51Z", completed: "2026-08-30T09:58:02Z", skip_reason: null,
      summary: "All 8 task groups (43 steps) executed in 5 waves via task-group-implementer; 95 Jest tests green across 4 suites, whole-program tsc clean, grunt build succeeds with the evaluator inlined and no test code; both manifests + lock at 1.3.0; README/overview/roadmap/tech-stack/INDEX updated. Only the manual live-org checklist remains.",
      decisions: [
        {decision: "Parent-link callback in workItemCreation.ts uses three explicit returns (failed / created+skippedFields / created) instead of ternary + conditional property", rationale: "same outcomes as R11, more readable (Group 5)"},
        {decision: "'1.' -> unexpected character '.' at index 1; '=1e3' -> unexpected token 'e3' at index 1", rationale: "spec R3/R4 have no exponent/trailing-dot rule; both now pinned by tests (Groups 2, 6)"},
        {decision: "Allowlist implemented as own-property-guarded object literal checked before argument parsing", rationale: "prevents prototype-chain names leaking in; =Math.sqrt({missing}) reports unsupported function, not a field error (Group 2)"},
        {decision: "Warnings filter on status === 'created' explicitly", rationale: "defensive R12 invariant at zero cost (Group 4)"},
        {decision: "9 gap tests added (cap 10); builder no-= candidate skipped as already covered", rationale: "risk-based per test-writing.md (Group 6)"},
        {decision: "tech-stack.md stale 'JavaScript / planned TypeScript migration' wording left untouched", rationale: "beyond R20 scope; recommended as a follow-up docs refresh (Group 7)"}
      ],
      risks: [
        "Manual live-org verification (spec Success Criterion 8) is still open: clear linkedTasksAutomation.templateCache.* localStorage keys, then check Story Points 2.5 -> 5, Priority 3 -> /2 = Failed (400), unset parent field -> Warnings line, plain {System.Title} unchanged.",
        "npm audit reports 23 pre-existing vulnerabilities in transitive devDependencies (out of scope; unchanged by this task).",
        "Git autocrlf warnings on package.json/package-lock.json/vss-extension.json (files were LF in the working tree; endings not altered).",
        "'=1e3' reason wording ('unexpected token e3') is spec-conformant but could be friendlier - possible follow-up."
      ],
      artifacts: [ {path: "implementation/work-log.md", label: "Work log", html: null}, {path: "implementation/implementation-plan.md", label: "Implementation plan (all steps checked)", html: "implementation/implementation-plan.html"} ],
      gate: {question: "Implementation complete. Continue to verification?", answer: "Continue to verification"} },
    { id: "phase-9", name: "Verify test passes (TDD Green)", icon_hint: "verify", status: "skipped", started: null, completed: "2026-08-28T04:59:11Z", skip_reason: "Phase 3 (TDD Red) was not executed", summary: null, decisions: [], risks: [], artifacts: [], gate: null },
    { id: "phase-10", name: "Prompt verification options", icon_hint: "verify", status: "completed", started: "2026-08-30T09:58:02Z", completed: "2026-08-30T09:58:37Z", skip_reason: null, summary: "Verification plan confirmed: completeness (always), test suite skipped (passed in Phase 8), code review, pragmatic review, reality check, production readiness all enabled; E2E disabled (no live org); user docs enabled.", decisions: [], risks: [], artifacts: [], gate: {question: "Which verifications to run? / Generate user docs?", answer: "All four recommended checks; user docs: Yes"} },
    { id: "phase-11", name: "Verify implementation & resolve issues", icon_hint: "verify", status: "completed", started: "2026-08-30T09:58:37Z", completed: "2026-08-30T10:28:24Z", skip_reason: null,
      summary: "Verdict: Passed with Issues. Completeness (100%), code review (clean, 5 info), pragmatic review (appropriate, 2 low), and reality assessment (Ready/GO) all pass outright; production readiness returns GO WITH MITIGATIONS (88%, 0 blockers, 3 concerns — all pre-disclosed process items, not code defects, and not fixable in this environment).",
      decisions: [
        { decision: "No AST / evaluate-during-parse", rationale: "grammar has one consumer and no second use case is planned; matches minimal-implementation.md" },
        { decision: "Allowlist via own-property-guarded object literal rather than dynamic Math[name] lookup", rationale: "closes a prototype-pollution/arbitrary-Math-member class of bug at negligible cost" }
      ],
      risks: [
        "Live-org manual verification (Success Criterion 8) not performed — no Azure DevOps org available in this environment; mitigated by the project's private grunt publish-dev channel before public release.",
        "No error-tracking/telemetry service exists anywhere in this codebase — pre-existing, project-wide condition, not introduced by this feature.",
        "localStorage template cache (4h TTL) can mask verification results if not cleared before manual testing — already documented as a tip in README/overview."
      ],
      artifacts: [
        {path: "verification/implementation-verification.md", label: "Implementation verification", html: "verification/implementation-verification.html"},
        {path: "verification/completeness-check.md", label: "Completeness check", html: null},
        {path: "verification/code-review-report.md", label: "Code review", html: null},
        {path: "verification/pragmatic-review.md", label: "Pragmatic review", html: null},
        {path: "verification/production-readiness-report.md", label: "Production readiness", html: null},
        {path: "verification/reality-check.md", label: "Reality check", html: null}
      ],
      gate: {question: "Which issues should I fix?", answer: "Proceed as-is (Recommended) — no critical issues; warnings are non-code-fixable process concerns; info items are optional"} },
    { id: "phase-12", name: "Run E2E tests", icon_hint: "verify", status: "skipped", started: null, completed: "2026-08-30T10:28:24Z", skip_reason: "options.e2e_enabled is false — no browser-testable UI; requires a live Azure DevOps org", summary: null, decisions: [], risks: [], artifacts: [], gate: null },
    { id: "phase-13", name: "Generate user documentation", icon_hint: "docs", status: "in_progress", started: "2026-08-30T10:28:24Z", completed: "2026-08-30T10:32:11Z", skip_reason: null,
      summary: "User guide written for template authors: how to write '=' formulas, worked examples pulled from spec R19, operator/Math.* reference tables, placeholder syntax, and the exact skipped-field warning wording. Used the extension's existing genuine product screenshots (template editor, menu, created tasks) since the formula field and completion dialog only render inside a live Azure DevOps iframe, which Playwright cannot reach here.",
      decisions: [
        { decision: "Reused existing genuine product screenshots instead of fabricating captures", rationale: "the feature's UI only renders inside a live ADO iframe via VSS.init(), unreachable by Playwright in this environment (same constraint that skipped Phase 12)" }
      ],
      risks: [],
      artifacts: [ {path: "documentation/user-guide.md", label: "User guide", html: null} ],
      gate: {question: "Continue to Phase 14 (finalization)?", answer: "Continue to Phase 14 (Recommended)"} },
    { id: "phase-14", name: "Finalize workflow", icon_hint: "done", status: "completed", started: "2026-08-30T10:43:59Z", completed: "2026-08-30T10:44:32Z", skip_reason: null,
      summary: "Workflow complete. Feature shipped: allowlisted '=' expression evaluator, skipped-field dialog warnings, Jest test infra (95 tests), docs, version 1.3.0. Verification: Passed with Issues (0 critical; 3 non-fixable process warnings; 10 optional info items). Open: manual live-org checklist before public release.",
      decisions: [], risks: [], artifacts: [], gate: null }
  ],
  verification: {
    status: "passed_with_issues",
    issues: [
      { severity: "warning", category: "production_readiness", description: "Live-org manual verification (Success Criterion 8) not performed — no Azure DevOps org available in this environment", fixable: false, fixed: false },
      { severity: "warning", category: "production_readiness", description: "No error-tracking/telemetry service exists anywhere in this codebase (pre-existing, project-wide)", fixable: false, fixed: false },
      { severity: "warning", category: "production_readiness", description: "localStorage template cache (4h TTL) could mask manual-verification results if not cleared first", fixable: false, fixed: false },
      { severity: "info", category: "code_review", description: "5 informational polish items (micro-perf, typing, test-literal escape nit, untested NaN edge case, unbounded parser recursion)", fixable: true, fixed: false },
      { severity: "info", category: "pragmatic_review", description: "2 low-severity optional notes (single-file organization, mixed test-matcher pattern)", fixable: true, fixed: false },
      { severity: "info", category: "production_readiness", description: "3 nice-to-have items (friendlier =1e3 error message, devDependency audit refresh, stale tech-stack.md wording)", fixable: true, fixed: false }
    ],
    fixes: [],
    reverify_count: 0
  }
};
