## TL;DR
Researching the best-practice path to migrate Linked-Tasks-Automation (vanilla JS AMD/RequireJS Azure DevOps extension, Grunt build, VSS SDK, Q promises, no tests) to TypeScript. Output: recommended tooling, migration strategy, and VSS SDK typing approach.

# Research Brief

## Research Question
What is the best approach for migrating the Linked-Tasks-Automation Azure DevOps extension to TypeScript — including tooling choices, incremental vs. big-bang migration strategy, and type definitions for the VSS SDK and Q promise library?

## Research Type
Mixed (technical codebase analysis + literature/best-practices research)

## Scope

### Included
- TypeScript tooling setup (compiler, integration with the existing Grunt build pipeline)
- Migration strategy (incremental vs. big-bang) appropriate for a single ~618-line core module (`src/scripts/app.js`)
- Type definitions / typing strategy for the Azure DevOps VSS Extension SDK (`vss-web-extension-sdk`) and the Q promise library
- Industry best practices for JS-to-TS migrations of small/medium codebases, especially ones with no existing test suite

### Excluded
- Actual code implementation of the migration (this is research, not execution)
- New feature development (Phase 2 of the project roadmap — out of scope here)
- Testing framework selection (tracked separately as roadmap technical debt, may be touched on where it interacts with migration safety)

### Constraints
- Must keep the project buildable/publishable as an Azure DevOps Marketplace extension throughout the migration
- Solo maintainer — prefer low-overhead tooling over heavyweight setups
- No existing automated test suite to catch regressions during migration — migration strategy must account for this risk

## Success Criteria
A clear, evidence-based recommendation covering:
1. Recommended TypeScript tooling and Grunt build integration
2. Recommended migration strategy (incremental vs. big-bang) with rationale
3. Recommended approach for typing the VSS SDK and Q promise usage
4. Key risks specific to migrating without an existing test suite, and mitigations

## Context
This project just completed Maister framework initialization. Its documented roadmap (`.maister/docs/project/roadmap.md`) lists "Ground Refactor to TypeScript" as Phase 1 priority, ahead of new feature development. Known project facts (from prior analysis): AMD module pattern via `define()`/`VSS.require()`, `var`-heavy code style, Q promise `.then()` chaining (no async/await), inconsistent logging (4 wrapper functions, mostly bypassed in favor of raw `console.log`), version mismatch between `package.json` and `vss-extension.json`, no CI/CD, no linting.
