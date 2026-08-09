# Research Brief: Speed Up Task Creation, Add Progress Feedback, Fix Popup-Close Reliability

## TL;DR
Investigate how to (1) cut the delay between clicking "create" and the first child work item appearing, via async template preloading/caching and async creation/linking; (2) add non-blocking, visible progress feedback during creation; (3) fix task creation breaking when the parent work item is opened in an Azure DevOps popup panel, so creation survives popup close and only a full page refresh stops it.

## Research Question
How can the Linked Tasks Automation extension be changed to (a) preload/cache templates asynchronously after plugin load and create child tasks + links asynchronously so the user isn't blocked waiting after clicking "create"; (b) surface a visible, non-blocking progress indicator (progress bar or notice) while creation is in flight; and (c) keep creating tasks in the background even if the Azure DevOps popup panel hosting the extension is closed, stopping only on a full page refresh?

## Research Type
Mixed (technical codebase analysis + Azure DevOps/VSS SDK platform capability research + UX/requirements for progress feedback)

## Scope

### Included
- Current template loading and task/link creation flow in `src/scripts/app.js` and related extension scripts
- Azure DevOps Extension SDK (VSS) APIs relevant to async execution, background work, storage, and notifications
- Browser-side storage options (localStorage, IndexedDB, VSS extension data service) for caching templates client-side
- Azure DevOps extension UI patterns for progress indication (toasts, panels, status banners) that don't block the host page
- Popup/panel lifecycle behavior in Azure DevOps (work item opened "on top" of another) and how it affects iframe/extension script execution and lifetime

### Excluded
- Full TypeScript migration (tracked separately in `.maister/tasks/research/2026-08-07-typescript-migration-approach`)
- Server-side/backend changes (extension is stateless, browser-only, per `project/tech-stack.md`)

### Constraints
- Must work within Azure DevOps Extension SDK (VSS) constraints — no custom backend/database available
- Extension currently runs as an AMD/RequireJS, ES6+ JavaScript codebase (pre-TypeScript-migration)
- Any background/async behavior must respect Azure DevOps host iframe sandboxing and lifecycle events

## Success Criteria
- Clear, evidence-based explanation of where the current click-to-first-task delay comes from in the existing code
- Concrete options for asynchronous template preloading/caching, with trade-offs
- Concrete options for asynchronous task + link creation, with trade-offs
- Concrete options for non-blocking progress feedback UI within Azure DevOps extension constraints
- Root-cause explanation of why creation breaks when the work item is opened in a popup, and evidence-based options for making creation resilient to popup close (surviving only until a full page refresh)
- Confidence level assigned to each finding, with source citations
