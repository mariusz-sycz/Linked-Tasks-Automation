# Documentation Index

**IMPORTANT**: Read this file at the beginning of any development task to understand available documentation and standards.

## Quick Reference

### Project Documentation
Project-level documentation covering vision, goals, roadmap, and technology choices for Linked-Tasks-Automation, an Azure DevOps extension for template-driven child work item creation. Architecture doc not generated (not applicable — see note below).

### Technical Standards
Coding standards, conventions, and best practices organized by domain. Initialized for: global, frontend, testing, build-tooling. Not yet initialized for: backend.

---

## Project Documentation

Located in `.maister/docs/project/`

### Vision (`project/vision.md`)
Project overview, current state (stable/maintenance mode, ~2.5 years old, published on the Azure DevOps Marketplace), purpose (automating creation of consistent child work items via JSON-defined templates, conditional rules, field inheritance, and linking), and 6-12 month goals centered on a ground-up TypeScript refactor followed by renewed feature development.

### Roadmap (`project/roadmap.md`)
Current manifest/package version state (with a known version mismatch), key existing features, Phase 1 (TypeScript tooling, porting `src/scripts/app.js`, typing the VSS SDK/REST client boundary, consolidating logging, aligning versions), Phase 2 (feature backlog and automated tests once TypeScript lands), and tracked technical debt (no tests, no CI/CD, no CONTRIBUTING.md).

### Tech Stack (`project/tech-stack.md`)
Technology choices and rationale: JavaScript (ES6+, AMD/RequireJS) as the current language with a planned migration to TypeScript, the Azure DevOps Extension SDK (VSS) as the only frontend framework (no backend/database — stateless browser extension against Azure DevOps REST APIs), Grunt + tfx-cli + npm build tooling, no CI/CD or linting currently configured, and the planned JavaScript-to-TypeScript migration path.

### Architecture (`project/architecture.md`)
*Not generated for this project.* Add it later using the docs-manager skill if a dedicated architecture document becomes useful (e.g., once the TypeScript refactor introduces more structure to describe).

---

## Technical Standards

### Global Standards

Located in `.maister/docs/standards/global/`

#### Coding Style (`standards/global/coding-style.md`)
Naming consistency, automatic formatting, descriptive names, focused (single-purpose) functions, uniform indentation, no dead code, avoiding unnecessary backward-compatibility paths, and DRY (don't repeat yourself).

#### Commenting (`standards/global/commenting.md`)
Letting code speak for itself through structure and naming, commenting sparingly only when logic isn't self-evident, and avoiding changelog-style "what changed" comments.

#### Development Conventions (`standards/global/conventions.md`)
Predictable file/directory structure, up-to-date README documentation, clean version control (commit messages, feature branches, PR descriptions), environment variables for config/secrets, minimal dependencies, consistent code review process, defined test coverage requirements, feature flags over long-lived branches, changelog maintenance, and building only what's needed.

#### Error Handling (`standards/global/error-handling.md`)
Clear, non-sensitive user-facing error messages, failing fast on invalid input, typed/specific exceptions, centralized error handling at boundaries, graceful degradation for non-critical failures, retry with exponential backoff for transient failures, and reliable resource cleanup.

#### Minimal Implementation (`standards/global/minimal-implementation.md`)
Building only methods/classes/functions that are actually called, avoiding future stubs and speculative abstractions (factories, strategies, adapters without immediate need), removing exploration artifacts, and reviewing for unused code before commit.

#### Validation (`standards/global/validation.md`)
Server-side validation as the source of truth, client-side validation for UX feedback, validating early, specific field-level error messages, allowlists over blocklists, systematic type/format checks, input sanitization against injection attacks, business-rule validation, and consistent enforcement across all entry points.

### Frontend Standards

Located in `.maister/docs/standards/frontend/`

#### Accessibility (`standards/frontend/accessibility.md`)
Semantic HTML, full keyboard navigation with visible focus indicators, 4.5:1 color contrast, alt text and form labels, screen reader testing, ARIA attributes for complex components, correct heading hierarchy, and focus management in dynamic content/modals/SPAs.

#### Components (`standards/frontend/components.md`)
Single-responsibility components, reusability via configurable props, composability over monolithic components, clear/documented prop interfaces, encapsulation of implementation details, consistent naming, keeping state local, minimizing prop count, and documenting usage/examples.

#### CSS (`standards/frontend/css.md`)
Sticking to a single consistent CSS methodology (Tailwind, BEM, CSS modules, etc.), working with the framework rather than overriding it, documented design tokens for colors/spacing/typography, minimizing custom CSS, and production CSS purging/tree-shaking.

#### Responsive Design (`standards/frontend/responsive.md`)
Mobile-first layout, standard breakpoints, fluid percentage-based layouts, relative units (rem/em) over fixed pixels, cross-device testing, touch-friendly tap targets (min 44x44px), mobile asset/performance optimization, readable typography at all breakpoints, and content priority on small screens.

### Testing Standards

Located in `.maister/docs/standards/testing/`

#### Test Writing (`standards/testing/test-writing.md`)
Testing behavior rather than implementation, clear/descriptive test names, mocking external dependencies for isolation, keeping unit tests fast, risk-based test prioritization, balancing coverage against velocity, focusing on critical user paths, and matching edge-case depth to risk profile.

### Build & Packaging Standards

Located in `.maister/docs/standards/build-tooling/`. Custom category (not part of the baseline global/frontend/backend/testing set) — discovered via automated standards-discover config analysis of `src/gruntfile.js`, `src/package.json`, `src/vss-extension.json`, and `src/configs/*.json`.

#### Packaging (`standards/build-tooling/packaging.md`)
Kebab-case Grunt task naming, environment-specific packaging via override files (dev vs release), dev builds auto-incrementing version via `--rev-version` while release builds don't, `package.json` name matching the `vss-extension.json` id, `package.json` marked private (distributed only as a `.vsix`), vendored SDK assets copied via a Grunt copy task, extension manifest file entries marked `addressable`, and contribution IDs using kebab-case matching their purpose.

### Backend Standards

*Not initialized for this project. If you need backend standards, you can:*
- *Add them manually using the docs-manager skill*
- *Run `/maister:standards-discover --scope=backend` to auto-discover*

---

## How to Use This Documentation

1. **Start Here**: Always read this INDEX.md first to understand what documentation exists
2. **Project Context**: Read relevant project documentation before starting work
3. **Standards**: This index only points to the standards — open and follow the specific standard files relevant to your task; don't rely on the index alone
4. **Keep Updated**: Update documentation when making significant changes
5. **Customize**: Adapt all documentation to your project's specific needs

## Updating Documentation

- Project documentation should be updated when goals, tech stack, or architecture changes
- Technical standards should be updated when team conventions evolve
- Always update INDEX.md when adding, removing, or significantly changing documentation
