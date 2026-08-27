window.MAISTER_DATA = {
  generated: "2026-08-27T05:01:56Z",
  task: {
    title: "Arithmetic expressions in template field values",
    type: "development",
    status: "in_progress",
    description: "Allow template field values to contain JavaScript-style arithmetic expressions over parent field placeholders, e.g. Math.ceil({Microsoft.VSTS.Scheduling.StoryPoints}*2), evaluated at child creation time.",
    path: ".maister/tasks/development/2026-08-26-template-field-arithmetic-expressions",
    current_activity: "Analyzing gaps & clarifying scope"
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
    { id: "phase-2", name: "Analyze gaps & clarify scope", icon_hint: "analysis", status: "in_progress", started: "2026-08-27T04:56:29Z", completed: null, skip_reason: null,
      summary: "No evaluation exists today; gap is a new allowlisted evaluator module, a marker-gated branch in templateBuilder.ts, missing-field detection, first Jest setup, and docs. Remaining decisions are edge semantics, scope boundaries, versioning, and one unverified product risk (ADO template editor accepting '=' text in numeric fields).",
      decisions: [
        {decision: "has_reproducible_defect = false", rationale: "the undefined interpolation is a latent quirk hardened incidentally, not the task's goal; no failing scenario was reported by a user"},
        {decision: "involves_data_operations = false", rationale: "the feature transforms a value inside the existing child-CREATE pipeline; it introduces no entity with its own CRUD lifecycle"},
        {decision: "ui_heavy = false", rationale: "the extension has no settings UI; authoring happens in Azure DevOps' own template editor and the only user-visible surface is the existing completion dialog, which is not changed"},
        {decision: "Placeholder resolution should happen inside the evaluator (numeric token substitution), not by textual splicing before parsing", rationale: "textual splicing is the root of the undefined, null, 2--3 and string-value failure modes (flagged as an important decision)"}
      ],
      risks: [
        "Authoring feasibility (unverified, blocking value not code): the Azure DevOps template editor renders the real work item form; numeric fields (Story Points, Effort, Remaining Work) may reject non-numeric text and block Save. If so, = expressions can only be authored for string fields via the UI, or via the Templates REST API.",
        "Integer-typed fields (Microsoft.VSTS.Common.Priority, BusinessValue) will 400 on a non-integer result, surfacing only as a failed template name in the completion dialog.",
        "Jest + module: amd do not mix: tests need a second tsconfig (CommonJS) that also pulls in the SDK's typings/*.d.ts; test files must live outside scripts/** (or be excluded) so tsc does not compile them into build/.",
        "Templates are cached in localStorage for 4 hours; manual verification must clear linkedTasksAutomation.templateCache.* after editing a template.",
        "The uncommitted in-flight work already bumps vss-extension.json to 1.2.8 while package.json stays at 1.1.17; any version handling in this task lands on top of that."
      ],
      artifacts: [ {path: "analysis/gap-analysis.md", label: "Gap analysis", html: null} ],
      gate: null },
    { id: "phase-3", name: "Write failing test (TDD Red)", icon_hint: "verify", status: "pending", started: null, completed: null, skip_reason: null, summary: null, decisions: [], risks: [], artifacts: [], gate: null },
    { id: "phase-4", name: "Generate UI mockups", icon_hint: "spec", status: "pending", started: null, completed: null, skip_reason: null, summary: null, decisions: [], risks: [], artifacts: [], gate: null },
    { id: "phase-5", name: "Gather requirements & create specification", icon_hint: "spec", status: "pending", started: null, completed: null, skip_reason: null, summary: null, decisions: [], risks: [], artifacts: [], gate: null },
    { id: "phase-6", name: "Audit specification", icon_hint: "verify", status: "pending", started: null, completed: null, skip_reason: null, summary: null, decisions: [], risks: [], artifacts: [], gate: null },
    { id: "phase-7", name: "Plan implementation", icon_hint: "plan", status: "pending", started: null, completed: null, skip_reason: null, summary: null, decisions: [], risks: [], artifacts: [], gate: null },
    { id: "phase-8", name: "Execute implementation", icon_hint: "code", status: "pending", started: null, completed: null, skip_reason: null, summary: null, decisions: [], risks: [], artifacts: [], gate: null },
    { id: "phase-9", name: "Verify test passes (TDD Green)", icon_hint: "verify", status: "pending", started: null, completed: null, skip_reason: null, summary: null, decisions: [], risks: [], artifacts: [], gate: null },
    { id: "phase-10", name: "Prompt verification options", icon_hint: "verify", status: "pending", started: null, completed: null, skip_reason: null, summary: null, decisions: [], risks: [], artifacts: [], gate: null },
    { id: "phase-11", name: "Verify implementation & resolve issues", icon_hint: "verify", status: "pending", started: null, completed: null, skip_reason: null, summary: null, decisions: [], risks: [], artifacts: [], gate: null },
    { id: "phase-12", name: "Run E2E tests", icon_hint: "verify", status: "pending", started: null, completed: null, skip_reason: null, summary: null, decisions: [], risks: [], artifacts: [], gate: null },
    { id: "phase-13", name: "Generate user documentation", icon_hint: "docs", status: "pending", started: null, completed: null, skip_reason: null, summary: null, decisions: [], risks: [], artifacts: [], gate: null },
    { id: "phase-14", name: "Finalize workflow", icon_hint: "done", status: "pending", started: null, completed: null, skip_reason: null, summary: null, decisions: [], risks: [], artifacts: [], gate: null }
  ],
  verification: { status: null, issues: [], fixes: [], reverify_count: 0 }
};
