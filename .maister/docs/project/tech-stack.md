# Technology Stack

## Overview
This document describes the technology choices and rationale for Linked-Tasks-Automation, an Azure DevOps extension for automated, template-driven creation of linked child work items.

## Languages

### JavaScript (ES6+)
- **Usage**: ~100% of current codebase
- **Rationale**: Original implementation choice; Azure DevOps extensions run as browser-loaded scripts, and JS required no build step at the time
- **Key Features Used**: `const`/`let`, arrow functions, AMD module pattern via `define()`
- **Planned change**: ground-up migration to **TypeScript** is the top roadmap priority (see [roadmap.md](roadmap.md)) — motivated by the lack of type safety around template/work-item data structures and the desire for compile-time error catching before resuming feature work

## Frameworks

### Frontend
- **Azure DevOps Extension SDK (VSS)** `v1.104.0` — provides `VSS.getWebContext()`, work item form contribution hooks, and REST client access; this is a platform SDK requirement, not a general-purpose UI framework (there is no React/Vue/Angular in this project)

### Backend
None — this is a frontend-only browser extension with no server-side component. All logic runs client-side against Azure DevOps REST APIs.

### Testing
None currently. Adding a test framework (Jest recommended) is on the roadmap, to follow the TypeScript migration.

## Database
None — the extension is stateless; all data is read from and written to Azure DevOps Work Item Tracking via REST APIs at runtime.

## Build Tools & Package Management
- **npm** — package management (`package.json`, `package-lock.json`)
- **Grunt** `1.0.4+` — build task orchestration (`copy`, `clean`, `exec` tasks; default task is `package-dev`)
- **tfx-cli** `0.8.1` — Azure DevOps extension packaging (`.vsix`) and Marketplace publishing
- **RequireJS** `2.2.0` — AMD module loader bundled with the extension for runtime module resolution

## Infrastructure

### Containerization
Not used — not applicable to a browser extension.

### CI/CD
None currently. Build and publish (`grunt package-dev` / `grunt package-release`, `tfx extension publish`) are run manually. A GitHub Actions workflow is a suggested (not yet planned) improvement.

### Hosting
Distributed via the **Azure DevOps Extension Marketplace** (publisher: SyczMariusz); no separate hosting infrastructure — the packaged `.vsix` is loaded by Azure DevOps itself.

## Development Tools

### Linting & Formatting
None currently configured (no ESLint/Prettier).

### Type Checking
None currently — planned as part of the TypeScript migration (Phase 1 of the roadmap).

## Key Dependencies
- `vss-web-extension-sdk` — Azure DevOps VSS SDK
- `grunt`, `grunt-cli`, `grunt-contrib-clean`, `grunt-contrib-copy`, `grunt-exec` — build pipeline
- `requirejs` — AMD module loading
- `tfx-cli` — extension packaging/publishing
- `Q` — promise library for async Azure DevOps REST API calls

## Version Management
Two manifest files currently track version independently and have drifted: `vss-extension.json` (`1.1.17`, the Marketplace-facing version) and `package.json` (`0.10.1`, the npm-facing version). Aligning these is on the roadmap as part of Phase 1.

## Migration Path
**JavaScript → TypeScript** is the planned migration:
1. Add TypeScript tooling and a compile step to the Grunt build pipeline
2. Port `src/scripts/app.js` incrementally, adding types for templates, work items, and filter rules
3. Type the VSS SDK / REST client integration points
4. Resume feature development once the typed base is stable

---
*Last Updated*: 2026-08-08
*Auto-detected*: Languages, frameworks, build tools, dependencies, and infrastructure were auto-detected from `package.json`, `vss-extension.json`, `gruntfile.js`, and source inspection. Migration plan and future direction were user-provided.
