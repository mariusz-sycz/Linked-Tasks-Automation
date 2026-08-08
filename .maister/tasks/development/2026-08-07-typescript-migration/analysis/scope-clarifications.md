## TL;DR
Six scope decisions resolved: TDD gate skipped/adapted (manual .vsix checklist substitutes), build wiring must be explicitly dual-verified in gruntfile.js, logging consolidation and version alignment are in scope (roadmap Phase 1 items), the linkImtes→linkItems typo gets fixed, and tsconfig.json goes strict:true from the start.

# Phase 2 Scope Clarifications

## Critical Decisions

### TDD Red/Green gate applicability
**Decision**: Skip/adapt the gate.
**Rationale**: No test framework exists; roadmap.md and tech-stack.md both explicitly place automated-test introduction after this migration (Phase 2). The promise-chain bug fix will be implemented and verified via the manual .vsix checklist that's already the planned safety net for this whole migration, not a standalone TDD cycle. Phases 3 and 9 (TDD Red/Green gates) are skipped for this task.

### Build pipeline wiring verification
**Decision**: Require explicit dual-wiring.
**Rationale**: The spec and implementation plan must explicitly require the new `tsc` compile step be prepended into both `registerTask("package-dev", ...)` and `registerTask("package-release", ...)` in gruntfile.js, with verification that both paths actually invoke it — zero test coverage means an orphaned step would only surface via manual inspection.

## Important Decisions

### Logging consolidation
**Decision**: Include now.
**Rationale**: Roadmap Phase 1 item — consolidate Log/WriteTrace/WriteLog (byte-identical) and WriteError into a single logging utility as part of this port.

### Version alignment
**Decision**: Include if trivial.
**Rationale**: Roadmap Phase 1 item — align `vss-extension.json` (1.1.17) and `package.json` (0.10.1) versions as part of this migration since it's low-risk.

### linkImtes → linkItems typo
**Decision**: Rename now.
**Rationale**: ~8 call sites, purely internal, zero external references — natural to fix while touching every line of the file anyway.

### tsconfig.json strictness
**Decision**: `strict: true` from the start.
**Rationale**: Single-file codebase with a JSDoc/checkJs bootstrap phase to catch issues before the rename — little benefit to a slower progressive strictness rollout.
