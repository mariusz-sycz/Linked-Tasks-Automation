# Project Vision

## Overview
Linked-Tasks-Automation is an Azure DevOps extension that lets teams create multiple templated child work items (tasks, bugs, test cases, etc.) from a parent work item with a single click, using configurable filtering, field inheritance, and dynamic linking rules.

## Current State
- **Age**: ~2.5 years (first commit Feb 2023)
- **Status**: Stable / maintenance mode — published and in production use, no active feature development in the last year
- **Users**: Azure DevOps teams via the public Marketplace listing
- **Tech Stack**: Vanilla JavaScript (ES6+, AMD/RequireJS), Azure DevOps Extension SDK (VSS), Grunt + tfx-cli for build/publish

## Purpose
Manually creating a consistent set of child work items (e.g., standard task breakdowns under a Feature or Requirement) is repetitive and error-prone. This extension automates that breakdown using JSON-defined templates, conditional rules (`applyWhen`/`notApplyWhen`), field inheritance from the parent, and automatic linking between created items — turning a multi-step manual process into one click.

## Goals (Next 6-12 Months)
1. **Ground-up refactor to TypeScript** — rewrite the existing JavaScript codebase (currently concentrated in `src/scripts/app.js`) in TypeScript to add type safety, catch template-filtering logic errors at compile time, and make the codebase easier to extend safely.
2. **New feature development** — once the TypeScript foundation is in place, resume active feature development on top of a more maintainable, typed base.
3. Address the maintenance gaps surfaced during initialization (version mismatch between `vss-extension.json` and `package.json`, absence of automated tests, inconsistent logging) as part of or immediately following the refactor.

## Evolution
The project has been stable since mid-2024 with no structural changes — it has proven itself in production but has accumulated the technical debt typical of an untyped, test-free extension that grew organically. The next phase of its life is a deliberate modernization step (TypeScript) rather than incremental feature patching, setting up the codebase for renewed feature work afterward.
