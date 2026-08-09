# High-Level Design: No-New-Surface Speed-Up, Keepalive Popup-Close Fix, TTL Cache, Modal Progress

## TL;DR
Keep the extension's single existing `ms.vss-web.action` contribution — no Hub, no observer, no form-page tab, overriding solution-exploration.md's top Hybrid-architecture recommendation per explicit user convergence. Fix popup-close fragility by switching create/link REST calls from the wrapped SDK client to raw `fetch(url, { keepalive: true })`, which survives iframe teardown but cannot chain on a response after the popup closes — so templates whose `linkTo` rules depend on `justCreatedTasks` (and any template's own link-to-parent step) remain exposed if the popup closes mid-chain. Templates and parallelizable REST reads get `localStorage`-backed caching with a 4-hour TTL (no event-driven invalidation exists — verified infeasible). Progress feedback uses two `IHostDialogService.openMessageDialog` calls (start/end); design-time inspection of the SDK typings found this API has **no programmatic close handle**, so the "auto-dismiss after 5s" ask from convergence is not achievable as literally stated — flagged below, not silently built.

## Key Decisions
- No new contribution surface; Hub/Hybrid explicitly rejected for this iteration — ADR-001.
- Creates/links move to `fetch(..., { keepalive: true })` with a bearer token from `VSS.getAccessToken()`; ordering-dependent templates and every template's link-to-parent step remain vulnerable to popup close before their request is dispatched — accepted, documented limitation — ADR-002.
- Template caching: `localStorage`, lazy population, 4-hour TTL (configurable); event-driven invalidation confirmed infeasible against Microsoft's Extensibility Points reference — ADR-003.
- Progress feedback: two `openMessageDialog` calls (start, completion), single pre-focused button each; true timer-driven auto-close is not implementable against the confirmed API (no `IExternalDialog` handle) — ADR-004.
- `getTeamSettings`/`getWorkItem` parallelized; per-template creates split into a concurrent "independent" group and a sequential "ordered" (`justCreatedTasks`-dependent) group — ADR-005.

## Open Questions / Risks
- `openMessageDialog` returns only `IPromise<IMessageDialogResult>` (resolved on button click), not an `IExternalDialog` — there is no *confirmed* way to close either dialog programmatically after a delay via a returned handle. Resolution: ship one-click-dismiss dialogs for v1 (proven against the typings); separately spike, as a non-blocking follow-up, whether `openMessageDialog`'s `message: string | JQuery` overload can carry self-closing content across the extension's sandboxed XDM boundary (plausible from the typings — jQuery/HTML content is supported — but unconfirmed, since live DOM objects generally aren't structured-cloneable across that cross-origin messaging boundary). If it works, swap it in later without touching ADR-001 (ADR-004).
- Popup-close survival is **not** guaranteed for: (1) any ordered-group template's create call not yet dispatched when the popup closes, and (2) any template's link-to-parent (or `ToAllOtherChilds` related-item link) call if the popup closes between that template's create/read response and the dependent link request being dispatched. This should be communicated to stakeholders as the actual behavior, not "fully survives popup close."
- Exact REST endpoint paths/`api-version` for the new fetch-based create/link calls should be confirmed at implementation time against what the pinned `vss-web-extension-sdk@1.104.0` wrapped client actually issues (e.g., via browser devtools network capture), not guessed — the SDK's internal `api-version` isn't exposed in typings.
- 4-hour TTL and the `localStorage` cache-key scheme (must be scoped by `project.id` + `team.id` + work item type, matching `witClient.getTemplates`' parameters) are sensible defaults per the stated design preferences, not hard requirements — tune during implementation if needed.
- Whether the SDK's `localStorage` shim or the native path is active in the real deployment target is unconfirmed (synthesis.md Gaps) — a narrow write-timing nuance, not decision-relevant to this design.

---

## Design Overview

**Business context**: Linked Tasks Automation is a stable, in-production Azure DevOps extension (vision.md) that creates templated child work items from a parent with one click. Users currently get zero feedback during creation, and closing the work-item dialog immediately after clicking silently kills any in-flight task creation — a correctness and trust problem for an established user base.

**Chosen approach**: This design keeps the extension's **single existing contribution** (`ms.vss-web.action` → `toolbar.html`/`app.ts`) unchanged — no Hub, no observer, no form-page tab — reversing solution-exploration.md's top-recommended Hybrid architecture per explicit user convergence favoring simplicity. Within that constraint, popup-close survival is addressed by switching the **create and link** REST calls from the SDK's wrapped client to raw **`fetch` with `keepalive: true`**, which lets the network request outlive the iframe that started it (though not any code that reads its response). Template data is cached in **`localStorage` with a time-based TTL**, since no event exists to signal a template edit. Progress is surfaced via two calls to the one API confirmed to reach the host frame, **`IHostDialogService.openMessageDialog`** — necessarily modal, and (a design-time finding) without a programmatic close handle.

**Key decisions:**
- No new contribution surface — protects today's trigger UX and ships with zero manifest change (ADR-001).
- `fetch(keepalive:true)` replaces the wrapped client for creates/links only; reads stay on the existing `witClient`/`workClient` (ADR-002).
- `localStorage` + 4h TTL for template caching; event-driven invalidation ruled out as infeasible, not deprioritized (ADR-003).
- Two `openMessageDialog` calls for start/completion feedback, single default button each, no programmatic auto-close (ADR-004).
- `getTeamSettings`/`getWorkItem` run concurrently; template creates split into a parallel "independent" group and a sequential "ordered" (`justCreatedTasks`-dependent) group (ADR-005).

---

## Architecture

### System Context (C4 Level 1)

```
                          ┌─────────────────────────────┐
   Azure DevOps User      │  clicks "Create linked       │
   (work item editor)  ───┤  tasks" toolbar/context-menu │
                          │  action                       │
                          └──────────────┬────────────────┘
                                          │
                                          ▼
                          ┌─────────────────────────────────────┐
                          │  Linked Tasks Automation Extension     │
                          │  (single ms.vss-web.action             │
                          │   contribution — toolbar.html/app.ts)  │
                          └───────┬───────────────┬───────────────┘
                    reads (wrapped│               │writes: fetch +
                    witClient/    │               │keepalive:true,
                    workClient)   │               │Bearer token via
                                  ▼               ▼VSS.getAccessToken()
                          ┌─────────────────────────────────────┐
                          │  Azure DevOps Work Item Tracking       │
                          │  REST API (vso.work / vso.work_write)  │
                          └─────────────────────────────────────┘

                          ┌─────────────────────────────────────┐
                          │  Browser localStorage                   │
                          │  (origin-scoped; survives toolbar        │
                          │   iframe teardown; template cache, TTL)  │
                          └─────────────────────────────────────┘
                                          ▲
                                          │ read/write
                          [Linked Tasks Automation Extension, above]

                          ┌─────────────────────────────────────┐
   Azure DevOps User  ◀───┤  Azure DevOps Host Frame                │
   (sees modal dialogs)   │  (renders IHostDialogService dialogs;    │
                          │   outlives the toolbar iframe)           │
                          └─────────────────────────────────────┘
```

The extension has exactly one external actor (the user, via the work-item toolbar/context menu) and three integration surfaces: the Work Item Tracking REST API (reads unchanged, writes now `fetch`-based), `localStorage` (new: template cache), and the host frame's dialog service (new: progress feedback). No new contribution, no backend, no other system.

### Container Overview (C4 Level 2)

```
                         ┌────────────────────────┐
                         │   toolbar.html            │
                         │   VSS.init(); registers    │
                         │   create-linked-tasks-      │
                         │   button-test                │
                         └───────────┬─────────────┘
                                     │ VSS.require(["scripts/app"]) → app.create(context)
                                     ▼
        ┌───────────────────────────────────────────────────────────────┐
        │                    app.ts — App Orchestrator                    │
        │     create() → AddTasks() → per-template dispatch/tracking      │
        └──────┬────────────┬─────────────┬──────────────┬────────────────┘
               │            │             │              │
               ▼            ▼             ▼              ▼
      ┌─────────────┐ ┌────────────┐ ┌───────────┐ ┌────────────────────┐
      │ Template      │ │ Template    │ │ Auth       │ │ Progress Dialog       │
      │ Cache          │ │ Classifier  │ │ Token      │ │ Controller             │
      │ (localStorage, │ │ (linkTo     │ │ Provider   │ │ (openMessageDialog     │
      │  4h TTL)        │ │  rule scan) │ │            │ │  start/completion)      │
      └──────┬────────┘ └────────────┘ └─────┬──────┘ └──────────┬─────────────┘
             │                                 │                   │
             ▼                                 ▼                   ▼
   ┌───────────────────┐            ┌────────────────────┐  ┌─────────────────────┐
   │ Browser              │            │ Keepalive Fetch      │  │ Azure DevOps Host      │
   │ localStorage          │            │ Client                │  │ Frame                   │
   │ (origin-scoped)        │            │ (create + link,       │  │ (modal dialogs;          │
   └───────────────────┘            │  keepalive:true)      │  │  outlives the iframe)    │
                                       └──────────┬─────────┘  └─────────────────────┘
                                                    │
         ┌────────────────────────┐                │
         │ Existing Wrapped         │                │
         │ REST Client                │                │
         │ (witClient/workClient,     │                │
         │  reads only)                 │                │
         └──────────┬─────────────┘                │
                     │                                    │
                     ▼                                    ▼
              ┌───────────────────────────────────────────────┐
              │  Azure DevOps Work Item Tracking REST API        │
              │  (vso.work / vso.work_write)                       │
              └───────────────────────────────────────────────┘
```

All containers except the host frame and the REST API live inside the same iframe/JS bundle (`toolbar.html` + compiled `scripts/app.js`) — this is a single-container extension with no server tier, consistent with tech-stack.md's "no backend/database" constraint. `localStorage` and the host frame are the only pieces of state/UI that live outside that iframe's lifecycle, which is exactly why they're the vehicles used for caching and progress display, respectively.

---

## Key Components

| Component | Purpose | Responsibilities | Key Interfaces | Dependencies |
|---|---|---|---|---|
| **App Orchestrator** (`app.ts`: `create`, `AddTasks`) | Entry point and coordinator for one "create linked tasks" invocation | Reads work item context; kicks off parallel reads; triggers cache check; classifies templates; opens start dialog; dispatches independent/ordered create groups; tracks completion; triggers completion dialog | Called by `toolbar.html`'s `createTasks`/`execute`; calls all other components | VSS SDK (`VSS.getWebContext`), all components below |
| **Existing Wrapped REST Client** (`witClient`/`workClient`) | Perform all **read-only** REST calls exactly as today | `getTeamSettings`, `getWorkItem`, `getWorkItemTypeCategories`, `getTemplates`, `getTemplate` — unchanged from current implementation | SDK-generated REST client (`TFS/WorkItemTracking/RestClient`, `TFS/Work/RestClient`) | Azure DevOps Work Item Tracking REST API |
| **Template Cache** | Avoid re-fetching template lists/bodies on every invocation | Check `localStorage` for a fresh (within-TTL) entry keyed by project/team/work-item-type before calling `getTemplates`/`getTemplate`; write fetched results back with a timestamp; treat entries older than the TTL as a miss | Called by App Orchestrator in place of direct `getTemplates`/`getTemplate` calls; falls through to Existing Wrapped REST Client on miss | `localStorage` (native or SDK-shimmed) |
| **Template Classifier** | Determine which templates can create concurrently without changing existing linking behavior | Parse each template's `linkTo` rules (same JSON extracted by `IsValidTemplateWIT`/`createWorkItem`); flag a template "ordered" if any rule references a `justCreatedTasks`-derived helper (`ToAllJustCreatedTasks`, `PreviouslyCreatedTask`, `PreviouslyJustCreatedTask`, `SecondPreviouslyJustCreatedTask`, `FirstJustCreatedTask`, `SecondJustCreatedTask`); everything else (including `ToAllOtherChilds` and no-`linkTo` templates) is "independent" | Called once per invocation after templates are resolved (cache hit or fetch); feeds the App Orchestrator's dispatch split | Template Cache's resolved template bodies |
| **Auth Token Provider** | Supply a bearer token for raw `fetch` calls | Call `VSS.getAccessToken()` once per invocation (or per batch); attach the resulting token to every Keepalive Fetch Client request's `Authorization` header | Wraps `VSS.getAccessToken(): IPromise<ISessionToken>` | VSS SDK |
| **Keepalive Fetch Client** | Perform all **create and link** REST calls so they survive popup close | Build the same JSON-Patch bodies the current `createWorkItemFromTemplate`/`linkItems` build; issue `fetch(url, { method, headers: { Authorization, 'Content-Type': 'application/json-patch+json' }, body, keepalive: true })`; used for: template creates, parent links, and every `linkTo`-rule link (including `ToAllOtherChilds`'s related-item links) | Called by App Orchestrator per template (independent and ordered paths) and by the `ToAllOtherChilds` related-items path | Auth Token Provider (token), Azure DevOps Work Item Tracking REST API |
| **Progress Dialog Controller** | Give the user visible acknowledgment at start and completion | Call `IHostDialogService.openMessageDialog("Creating N tasks...", ...)` immediately after template count is known, without awaiting its result; separately call `openMessageDialog("N of M tasks created" / failure summary, ...)` once the trackable promises (see Data Flow) settle — only reachable if the popup is still open | `VSS.getService(VSS.ServiceIds.Dialog): IHostDialogService` | Azure DevOps Host Frame (via XDM) |

---

## Data Flow

1. User clicks the toolbar/context-menu action → `toolbar.html` (`src/toolbar.html:21-24`) → `VSS.require(["scripts/app"])` → `app.create(context)` (`app.ts:611`).
2. `create()` resolves `ctx = VSS.getWebContext()` and calls `AddTasks(workItemId)` per work item (`app.ts:611-628`, unchanged).
3. `AddTasks` fires `workClient.getTeamSettings(team)` and `witClient.getWorkItem(workItemId)` **concurrently** via `Promise.all` (was nested/sequential, `app.ts:38-48` — ADR-005).
4. `GetChildTypes` runs as today (`app.ts:541-601`, already internally parallel via `Q.all`/`Promise.all`).
5. **Template Cache** checks `localStorage` for a fresh entry keyed by `(project.id, team.id, childTypes)`. On hit: skip straight to step 6 with cached template references + bodies. On miss: call `getTemplates`/`getTemplate` via the Existing Wrapped REST Client as today, then write the result to `localStorage` with a timestamp (TTL default 4h).
6. **Progress Dialog Controller** opens the start dialog ("Creating N tasks...") — fired but not awaited; execution proceeds immediately.
7. **Template Classifier** splits the sorted template list into an **independent group** and an **ordered group** (ADR-005).
8. Independent group: each template's create+link sequence runs as its own promise, all started together via `Promise.all`. Per template: `getTemplate` (cache-aware) → build JSON-Patch body → **Keepalive Fetch Client** POST create (`keepalive:true`) → on response, POST link-to-parent (`keepalive:true`) → evaluate `linkTo` rules (only `ToAllOtherChilds` is possible here, since `justCreatedTasks`-referencing rules are excluded by definition) → for `ToAllOtherChilds`, read existing relations via the Existing Wrapped REST Client, then link each via the Keepalive Fetch Client.
9. Ordered group: runs sequentially in the existing alphabetical order (`SortTemplates`, `app.ts:501-508`), one create fully resolving (including push to `justCreatedTasks`) before the next template's create is dispatched — mirroring today's `chain.then(...)` structure (`app.ts:61-64`) but using native `Promise`s and the Keepalive Fetch Client for the create/link network calls themselves.
10. Both groups' per-template promises are tracked in a single `Promise.allSettled([...])`. When (and only when — see Open Questions) it resolves, the **Progress Dialog Controller** opens the completion dialog with a "N of M created" / partial-failure summary.
11. Data reaches the user via: (a) the two host-frame dialogs, and (b) the created/linked work items themselves, visible on refresh/navigation in Azure DevOps regardless of whether step 10 ever ran.

```
click → [cache check] → [start dialog] → split templates
                                            │
                     ┌──────────────────────┴───────────────────────┐
                     ▼                                                ▼
        independent group (parallel)                    ordered group (sequential)
        create(keepalive) → link-to-parent(keepalive)     create(keepalive) → push to
        → ToAllOtherChilds links(keepalive)                  justCreatedTasks → link-to-parent
                                                                (keepalive) → justCreatedTasks-
                                                                derived links (keepalive) → next
                     └──────────────────────┬───────────────────────┘
                                             ▼
                              Promise.allSettled(...) [only if popup still open]
                                             ▼
                                     [completion dialog]
```

---

## Integration Points

| Existing code | Change |
|---|---|
| `src/vss-extension.json:66-84` (single `ms.vss-web.action` contribution) | **Unchanged** — no manifest edits (ADR-001) |
| `src/toolbar.html:14-24` (`VSS.init`, `VSS.require`, registration) | **Unchanged** |
| `app.ts:38-48` (`getTeamSettings`/`getWorkItem`, nested) | Parallelize via `Promise.all`/`Q.all` (ADR-005) |
| `app.ts:53-66` (`getTemplates` call + create chain) | Insert Template Cache check before `getTemplates`; insert Template Classifier before building the create dispatch; replace the single `chain.then(...)` loop with the independent/ordered split (step 7-9 above) |
| `app.ts:72-83` (`createChildFromTemplate`) | Split into an independent-path and ordered-path variant; both still call `getTemplate` (now cache-aware) but route the create call through the Keepalive Fetch Client instead of directly returning `createWorkItem(...)` |
| `app.ts:85-102` (`getRelatedWorkItems`, backs `ToAllOtherChilds`) | Its own `witClient.getWorkItem(...)` read (`app.ts:88`) stays on the Existing Wrapped REST Client (it's a read); its `linkItems(...)` call (`app.ts:97`) now routes through the Keepalive Fetch Client |
| `app.ts:104-199` (`createWorkItem`) | `witClient.createWorkItem(...)` call (`app.ts:110`) replaced by a Keepalive Fetch Client create call; the `linkTo` rule-branch logic (`app.ts:122-188`) is preserved as-is (same helper names, same `justCreatedTasks` indexing) but every `linkItems(...)` call within it (`app.ts:120,140,150,159,167,175,183`) now routes through the Keepalive Fetch Client; the silent-`console.log`-only rejection handler (`app.ts:189-198`) becomes the per-template failure signal feeding the completion dialog's summary |
| `app.ts:201-229` (`linkItems`) | Becomes (or is replaced by) the Keepalive Fetch Client's link operation — same JSON-Patch document shape (`app.ts:205-215`), sent via `fetch` instead of `witClient.updateWorkItem` |
| `app.ts:495-498, 510-538` (`getTemplate`, `getTemplates`) | Gain a cache-check-first wrapper (ADR-003); underlying `witClient` calls unchanged, used only on cache miss |
| `app.ts:611-628` (`create`) | Gains the Progress Dialog Controller's start-dialog call before `AddTasks` is dispatched for each work item ID (ADR-004) |
| **New**: `VSS.getAccessToken()` | Called by the Auth Token Provider; not used anywhere in the codebase today |
| **New**: `VSS.getService(VSS.ServiceIds.Dialog)` → `IHostDialogService` | Called by the Progress Dialog Controller; not used anywhere in the codebase today |
| **Unaffected** | `GetChildTypes` (`app.ts:541-601`), all filter/template-matching helpers (`IsValidTemplateWIT`, `IsValidTemplateTitle`, `checkRules`, `matchField`, `extractJSON`, `IsJsonString`, `IsPropertyValid`, `replaceReferenceToParentField`, `createWorkItemFromTemplate`, `SortTemplates`) — pure logic, no network/lifecycle dependency, untouched |

Per design preferences, native `Promise`/`async`/`await` may be introduced in the touched functions above; there is no requirement to keep using `Q` in the code paths this design modifies, though `Q` may remain in untouched code.

---

## Design Decisions

| # | Decision | Summary | Detail |
|---|---|---|---|
| ADR-001 | No new contribution surface | Reject the Hub/Hybrid architecture from solution-exploration.md's top recommendation; stay on the single existing `ms.vss-web.action` contribution | [decision-log.md#adr-001](decision-log.md#adr-001) |
| ADR-002 | `fetch(keepalive:true)` for creates/links | Replace the wrapped REST client for create/link calls only; document the response-chaining limitation this doesn't solve | [decision-log.md#adr-002](decision-log.md#adr-002) |
| ADR-003 | `localStorage` + TTL caching | Lazy population, 4h default TTL; event-driven invalidation confirmed infeasible | [decision-log.md#adr-003](decision-log.md#adr-003) |
| ADR-004 | Modal dialog progress feedback | Two `openMessageDialog` calls; no programmatic auto-close is achievable against the confirmed API | [decision-log.md#adr-004](decision-log.md#adr-004) |
| ADR-005 | Bounded, dependency-aware parallelization | Parallelize independent reads and non-ordering-dependent template creates only | [decision-log.md#adr-005](decision-log.md#adr-005) |

---

## Concrete Examples

**Example 1 — independent templates survive popup close**
Given a parent Product Backlog Item with three child Task templates whose descriptions carry no `linkTo` rule (or only `ToAllOtherChilds`), when the user clicks "Create linked tasks" and closes the work-item popup roughly 150ms later, then: all three creates were already dispatched via `fetch(keepalive:true)` before the popup closed, so all three work items are created server-side regardless; each template's link-to-parent call succeeds only if its create's response was read before the popup closed — otherwise that specific link is skipped (the work item itself still exists, just unlinked from the parent until someone links it manually).

**Example 2 — ordering-dependent template exposed to popup close**
Given template "Task A" (no `linkTo`) and template "Task B" (`linkTo: ["PreviouslyCreatedTask"]`, alphabetically after Task A), when the user clicks create and closes the popup 50ms later — before Task A's create response has been read — then: Task A's create request was dispatched and completes server-side via keepalive, but Task B's create was waiting in the ordered chain for Task A's response (needed to populate `justCreatedTasks` correctly) and never fires, because the JS execution context died with the iframe before reaching that step. Task B is silently not created. This is the accepted, documented limitation from ADR-002 — not a defect to be further solved in this design.

**Example 3 — cache TTL staleness trade-off**
Given a user creates linked tasks twice in the same browser session, 20 minutes apart, when the second click happens, then the second invocation serves the template list/bodies from `localStorage` (populated on click #1), skipping the `getTemplates`/`getTemplate` REST round trips entirely. If a project admin edits one of those templates in Team Settings > Work Item Templates between the two clicks, the second click still uses the stale cached version, because it's within the 4-hour TTL and no event exists to invalidate it sooner — an accepted trade-off, not a bug.

---

## Out of Scope

- Any Hub, observer, or work-item-form-page contribution — explicitly rejected (ADR-001); remains available as a future escalation path if this design's partial (b)/(c) resolution proves insufficient in practice.
- Guaranteeing popup-close survival for ordering-dependent (`justCreatedTasks`) template creates, or for any template's link-to-parent/`ToAllOtherChilds` link call not yet dispatched at the moment of close — accepted limitations of the `fetch(keepalive)` approach (ADR-002), not solved further here.
- True non-blocking (non-modal) in-flight progress UI — `openMessageDialog` remains modal for the duration it's open; a fully non-blocking progress bar requires a persistent visible surface, foreclosed by ADR-001.
- Programmatic auto-dismiss of the progress dialogs after a fixed delay — not implementable against the confirmed SDK API (ADR-004); needs a scope conversation with the product owner before implementation, not a design workaround.
- Event-driven or automatic cache invalidation on template edit — no Azure DevOps extensibility point exists for this (ADR-003); a manual "clear cache" affordance is a possible future addition, not designed here.
- Full migration off the `Q` promise library across the rest of the codebase — native `Promise`/`async`/`await` may be used in the touched functions per design preferences, but a project-wide `Q` removal sweep is separate work.
- `IExtensionDataService`-based cross-device/cross-browser template cache durability — deprioritized per solution-exploration.md's Deferred Ideas; `localStorage` is sufficient for this use case.
- Fixing the pre-existing `bugsBehavior` numeric-enum-vs-string-literal bug in `GetChildTypes` — a real, already-tracked defect (roadmap.md technical debt) unrelated to this design's scope.
- Automated tests for this feature — no test framework exists in the project yet (tech-stack.md); manual/live verification is expected at implementation time, with automated coverage tracked separately under roadmap.md Phase 2.

---

## Success Criteria

1. On a second or later invocation within the same session and within the cache TTL, the `getTemplates`/`getTemplate` REST round trips are skipped entirely (served from `localStorage`).
2. `getTeamSettings` and `getWorkItem` execute concurrently on every invocation, not nested.
3. All templates whose `linkTo` rules do not reference `justCreatedTasks`-derived helpers create concurrently; only genuinely ordering-dependent templates remain serialized, with no change in their resulting links compared to current behavior.
4. For any template whose create request is dispatched (the `fetch` call issued) before the popup/work-item dialog closes, the corresponding work item exists in Azure DevOps afterward, even if the popup closed immediately after — verified via `keepalive:true` network-request semantics.
5. The user sees an on-screen acknowledgment ("Creating N tasks...") essentially immediately after clicking, before any REST call resolves; when the popup remains open through completion, a summary dialog ("N of M tasks created" or a partial-failure breakdown) appears once all trackable promises have settled.
6. No behavior change for templates that remain in the ordered/sequential group — their created items and links match what the current implementation produces today.
