# Decision Log: Speed Up Task Creation, Progress Feedback, Popup-Close Reliability

## TL;DR
Five ADRs, all reflecting the simpler path chosen during interactive convergence over solution-exploration.md's top-recommended Hybrid architecture. The most consequential: ADR-001 rejects any new contribution surface, which forces ADR-002's `fetch(keepalive:true)` create/link approach and ADR-004's still-modal dialog feedback to accept real, documented limitations rather than fully solving popup-close survival and non-blocking progress. ADR-003 settles caching (localStorage + TTL) after live-verifying that event-driven invalidation is not possible on this platform. ADR-004 additionally surfaces a design-time finding — `openMessageDialog` has no programmatic close handle — that narrows what "self-dismissing" can mean in implementation.

## Key Decisions
- ADR-001: No new contribution surface — Hub/Hybrid rejected for this iteration.
- ADR-002: `fetch(keepalive:true)` replaces the wrapped REST client for creates/links only, with an accepted response-chaining limitation.
- ADR-003: `localStorage` + TTL caching; event-driven invalidation ruled out as infeasible, not deprioritized.
- ADR-004: Two `openMessageDialog` calls for progress feedback; programmatic auto-close is not achievable against the confirmed SDK surface.
- ADR-005: Parallelize independent reads and non-ordering-dependent template creates; ordering-dependent templates stay sequential.

## Open Questions / Risks
- ADR-004's "self-dismissing" framing from convergence is resolved as: ship the one-click-dismiss dialogs now (proven against the typings); separately spike whether `openMessageDialog`'s `message: string | JQuery` overload can host self-closing content (e.g. a jQuery fragment with its own dismiss timer) when called across the extension's sandboxed XDM boundary — plausible from the typings but not confirmed, since live DOM/jQuery objects generally aren't structured-cloneable across that boundary and this may only work for Azure DevOps' own in-frame code, not third-party extensions. If the spike succeeds, swap it in as a direct upgrade; if not, the one-click dialogs remain the shipped behavior. Not a blocker for implementation.
- ADR-002's popup-close protection does not extend to ordering-dependent template creates or to any template's link-to-parent/`ToAllOtherChilds` link call not yet dispatched at the moment of close — this should be communicated as the actual behavior, not full popup-close survival.
- ADR-005's classification logic (which `linkTo` values count as `justCreatedTasks`-derived) must be kept in sync if new `linkTo` rule types are added later — see ADR-005 Consequences.

---

## ADR-001: No New Contribution Surface — Reject Hub/Hybrid Architecture {#adr-001}

### Status
Accepted

### Context
solution-exploration.md's Recommended Approach proposed shipping point-fixes immediately while adopting Alternative 5 (Hybrid: keep the action trigger, add a Hub-hosted execution engine) as the target architecture — the only alternative judged to fully resolve visible non-blocking progress and popup-close survival without changing how users invoke the feature. During interactive convergence (Phase 4), the user weighed the Hybrid's benefits against its cost and explicitly chose to stay within the existing single `ms.vss-web.action` contribution, accepting partial resolution of progress-visibility and popup-close survival via lower-risk mechanisms instead.

### Decision Drivers
- The Hybrid/Hub is the highest-complexity alternative among all five evaluated (solution-exploration.md Decision Area 1 trade-off table) — two contributions to build and coordinate, a novel hand-off/job-queue protocol with no SDK precedent, and an unresolved "hub not yet loaded" race condition.
- The extension is in stable/maintenance mode (vision.md) with an established user base; adding a Hub changes discoverability/navigation in ways the team wants to avoid for this iteration.
- `fetch(keepalive:true)` — investigated live during convergence — provides a materially better popup-close survival story than was assumed available within the current contribution type when solution-exploration.md was written, reducing the marginal benefit of the Hub for popup-close resilience specifically.
- Whether Azure DevOps permits adding a Hub alongside an existing action contribution with no Marketplace/manifest constraint was never investigated (an explicit open question in solution-exploration.md) — this remains unresolved, adding execution risk to the Hybrid path that a simpler design avoids entirely.

### Considered Options
1. Hybrid — action trigger + Hub-hosted execution engine (solution-exploration.md's top recommendation)
2. Pure Hub (trigger moves to a new navigation page)
3. Work-item-form-page contribution
4. Observer contribution, paired with a second UI surface
5. No new contribution surface — point-fixes only (SELECTED)

### Decision Outcome
Chosen option: 5 (no new contribution surface), because it fully preserves today's UX/trigger behavior, requires zero manifest changes, ships with markedly lower implementation and adoption risk than any alternative, and — combined with ADR-002's `fetch(keepalive)` approach — closes enough of the progress-visibility and popup-close-survival gap to satisfy the convergence's stated priorities without the Hybrid's unresolved hand-off-protocol risk.

### Consequences

#### Good
- Zero manifest change, zero UX/discoverability disruption for existing users.
- Lowest implementation risk and effort among all five alternatives; no live-org verification of a novel hand-off protocol required before shipping.
- Ships fastest.

#### Bad
- Does not achieve fully visible, non-blocking, in-flight progress — feedback remains modal (ADR-004).
- Does not guarantee popup-close survival for every template/link combination — only for creates whose `fetch(keepalive)` request was dispatched before the popup closed (ADR-002).
- If this partial resolution proves insufficient in practice, the Hub/Hybrid investment is deferred, not avoided — it remains available as a future escalation path per solution-exploration.md's alternatives.

---

## ADR-002: `fetch(keepalive:true)` Replaces the Wrapped REST Client for Creates and Links {#adr-002}

### Status
Accepted

### Context
`app.ts` calls `witClient.createWorkItem(...)` (`app.ts:110`) and `witClient.updateWorkItem(...)` (used by `linkItems`, `app.ts:217`) via the VSS SDK's wrapped REST client, which issues its underlying network requests from inside the `toolbar.html` iframe. Per the research report's Finding 9, when that iframe is torn down (e.g., on dialog/popup close), its in-flight requests are aborted by the browser — this is the mechanical root cause of task creation stopping the instant the popup closes. During convergence, the standard Fetch API's `keepalive` option was investigated live and confirmed (general, cross-engine web-platform behavior) to let a request continue past the document/frame that initiated it.

### Decision Drivers
- The fix must operate within ADR-001's "no new contribution surface" constraint — it cannot rely on a persistent host-frame surface to keep code running.
- `keepalive` is a browser-platform guarantee, not an Azure-DevOps-specific API, which lowers platform-capability risk relative to the SDK-lifecycle claims the original research could not live-verify.
- `keepalive` only guarantees the *network request* survives — it does not keep the JavaScript execution context (and thus any `.then()` continuation reading the response) alive. Any step that depends on reading a prior response cannot be relied upon once the popup has closed.

### Considered Options
1. Keep `witClient` wrapped REST calls for creates/links, accept full popup-close fragility (status quo)
2. Move execution to a new persistent surface (superseded by ADR-001)
3. Raw `fetch` with `keepalive:true` for creates/links, using a bearer token from `VSS.getAccessToken()`; leave read-only calls (`getTeamSettings`, `getWorkItem`, `getWorkItemTypeCategories`, `getTemplates`, `getTemplate`) on the existing wrapped client (SELECTED)

### Decision Outcome
Chosen option: 3, because it directly targets the mechanism identified as the failure point (in-flight request abortion on iframe teardown), requires no manifest change, and confines the blast radius of a new REST-calling pattern to exactly the two operations — create and link — where "keep running after popup close" actually matters. Reads are not user-visible background work and gain nothing from `keepalive`.

### Consequences

#### Good
- Every create/link `fetch` call dispatched before the popup closes will complete server-side even if the popup closes immediately after — directly resolving popup-close survival for the class of requests that don't depend on reading a prior response.
- No manifest change, no new contribution.
- Confines risk: reads keep using the well-tested wrapped client; only writes change calling pattern.

#### Bad
- Any template whose `linkTo` rules reference `justCreatedTasks`-derived helpers (`ToAllJustCreatedTasks`, `PreviouslyCreatedTask`, `PreviouslyJustCreatedTask`, `SecondPreviouslyJustCreatedTask`, `FirstJustCreatedTask`, `SecondJustCreatedTask`) must have its create call sequenced after the templates it depends on (ADR-005). If the popup closes before that specific `fetch` call has been dispatched, that template's create — and everything chained after it — simply never fires; the chain does not resume. Accepted limitation, not a defect.
- Even for "independent" templates, the link-to-parent call (`app.ts:120`, `System.LinkTypes.Hierarchy-Forward`) depends on reading the create call's own response (to get the new item's id/url). If the popup closes in the window between a template's create request being dispatched and its response arriving, that template's create still succeeds via `keepalive`, but its link-to-parent call never fires. Same applies to the `ToAllOtherChilds` related-items link path (`app.ts:85-102`), which depends on reading a `witClient.getWorkItem` response before linking.
- Two REST-calling patterns now coexist in the codebase (wrapped `witClient` for reads, raw `fetch` for writes) — a documented, deliberate split, not an oversight.
- Auth handling moves from "handled transparently by the SDK client" to "extension code must fetch and attach a bearer token per write call" via `VSS.getAccessToken()` — a small new failure mode (token fetch failure/expiry) that reads don't have.

---

## ADR-003: `localStorage` + TTL Template Caching; Event-Driven Invalidation Rejected as Infeasible {#adr-003}

### Status
Accepted

### Context
Templates are fetched via `witClient.getTemplates`/`getTemplate` on every single invocation today (research report Finding 1), even though templates in this stable/maintenance-mode extension change infrequently. Finding 6 confirmed `localStorage` (native or SDK-shimmed) survives the `toolbar.html` iframe's teardown, making it a viable cross-invocation cache with no manifest change. During convergence, the user specifically asked whether an event-driven invalidation approach (reacting to a template being saved) was feasible instead of a time-based one.

### Decision Drivers
- The cache must survive iframe teardown between invocations (`localStorage`, per Finding 6) — no in-memory option qualifies.
- A template edited in Azure DevOps's Team Settings > Work Item Templates admin UI should become visible to the extension automatically within a bounded, predictable window, without requiring the user to know to clear a cache.
- Verified during convergence against Microsoft's "Extensibility Points" reference (`targets/overview`): no contribution/extensibility point exists for template create/save events. Hubs, menus, toolbars, tabs, dashboard widgets, work-item-form contributions, and the Service Hooks consumer type were all checked; none cover work item template administration. This makes event-driven invalidation infeasible, not merely lower priority than a TTL approach.
- Design preferences specify no special constraints; sensible defaults (e.g., a few hours TTL) are acceptable.

### Considered Options
1. Plain lazy caching, no TTL (solution-exploration.md Decision Area 2, Alternative 1)
2. TTL + stale-while-revalidate (Alternative 2)
3. Eager warming on contribution load (Alternative 3) — requires a persistent surface, foreclosed by ADR-001
4. Event-driven invalidation via a template-save hook — investigated live during convergence and found infeasible; no such extensibility point exists
5. Lazy population + TTL, no background revalidation (SELECTED)

### Decision Outcome
Chosen option: 5, because it is implementable with zero manifest change (unlike eager warming, which needs ADR-001's rejected persistent surface), needs no event source (unlike option 4, confirmed not to exist), and bounds staleness to a known window without the added bookkeeping/race-condition surface of stale-while-revalidate — which solution-exploration.md itself flagged as likely premature optimization for an infrequently-changing data profile.

### Consequences

#### Good
- Repeat invocations within the TTL window skip the templates fetch entirely.
- Template edits are picked up automatically — no manual cache-clear needed — within a bounded, predictable window (default 4 hours, configurable).
- Simplest option that still satisfies "picked up automatically," avoiding stale-while-revalidate's added complexity for a data profile with infrequent changes.

#### Bad
- A template edited in Team Settings can take up to the full TTL to be reflected in a given browser session — a user who edits a template and immediately tries it will see the old version unless they wait out the TTL, or the extension is later given a manual "refresh cache" affordance (not designed here).
- The 4-hour default is a starting point, not empirically tuned — may need adjustment based on real usage patterns.

---

## ADR-004: Self-Dismissing Modal Dialog for Progress Feedback — With a Confirmed API Limitation {#adr-004}

### Status
Accepted

### Context
Research report Finding 7 established that `IHostDialogService.openMessageDialog` is the only VSS SDK API confirmed to render in the visible host frame from this extension's contribution type, and that it is modal by design. Convergence selected a two-call pattern (start dialog + end-of-run dialog) that auto-dismisses after roughly 5 seconds, framed as "a brief, self-limiting interaction-blocking window, not a true non-blocking toast." Design-time inspection of the SDK typings (`vss.d.ts:646-654` vs. `535-562`) found a constraint the convergence framing did not anticipate: `openMessageDialog` returns only `IPromise<IMessageDialogResult>`, resolved when the user clicks a button — it does **not** return an `IExternalDialog` handle. Only `IHostDialogService.openDialog` (`vss.d.ts:646`) returns an `IExternalDialog` with a `.close()` method, and `openDialog` requires hosting a contributed control to supply its content — itself a new contribution surface, which would contradict ADR-001.

### Decision Drivers
- Must stay within ADR-001 (no new contribution surface), which rules out `openDialog`'s contributed-control pattern as a way to obtain a closeable handle.
- Must give the user an immediate on-click acknowledgment plus a later completion summary, per convergence.
- A JavaScript `setTimeout` that calls `.close()` on the dialog is not implementable against the confirmed API — there is no such handle to call it on.

### Considered Options
1. Single end-of-run modal only (solution-exploration.md Decision Area 3, Alternative 1)
2. "Live-updating" single modal via `openMessageDialog` (Alternative 2) — not implementable as live-updating either, since `openMessageDialog` exposes no update method once open
3. Toast / `GlobalProgressIndicator` middle option — already rejected in solution-exploration.md (Finding 7: no confirmed host-frame reach)
4. Two separate `openMessageDialog` calls (start + completion), single default-focused "OK" button each, no programmatic auto-close, with terse copy so one click/Enter dismisses immediately (SELECTED)

### Decision Outcome
Chosen option: 4, as the closest available approximation to convergence's intent within the confirmed API's real capabilities. It preserves the two-touchpoint UX (an immediate "Creating N tasks..." acknowledgment, and a later "N of M created" summary) using the one API confirmed to reach the host frame, without introducing a second contribution. The literal "auto-dismiss after ~5s via a timer that closes the dialog programmatically" is flagged as not implementable against the confirmed SDK surface and is replaced with a single-default-button design that minimizes the manual dismissal cost.

### Consequences

#### Good
- No new contribution required.
- User gets an immediate acknowledgment and, when the popup stays open through completion, a completion summary.
- Each dialog is dismissed in one click/Enter press since there's exactly one, pre-focused button — the closest practical substitute for "self-dismissing" given the API's actual shape.

#### Bad
- Still genuinely modal for as long as it's open (unchanged from Finding 7) — an accepted trade-off from convergence.
- There is no *confirmed* way to programmatically auto-close either dialog after a fixed delay via a returned handle — the "self-dismissing" framing from convergence is shipped as one-click-dismiss for v1. A follow-up spike (not a blocker) should test whether `openMessageDialog`'s `message: string | JQuery` overload can carry self-closing content across the extension's sandboxed XDM boundary; if it works, it upgrades this ADR's outcome without changing ADR-001's "no new contribution surface" constraint.
- The completion (second) dialog only appears if the popup/work-item dialog is still open and the extension's JavaScript is still alive when the tracked promises settle — consistent with, and not a new instance of, ADR-002's accepted popup-close limitation.

---

## ADR-005: Bounded, Dependency-Aware Parallelization of Reads and Template Creates {#adr-005}

### Status
Accepted

### Context
Research report Finding 2 shows `getTeamSettings` and `getWorkItem` are coded as nested/sequential despite being data-independent. Finding 3 shows the per-template create loop is serialized unconditionally (`app.ts:61-64`) even though only templates whose `linkTo` rules reference `justCreatedTasks`-derived helpers genuinely require creation order to be preserved (Insight 3, `app.ts:134-186`). This decision is independent of, but interacts with, ADR-002: the more templates run in the parallel/independent group, the more of the batch is protected by `fetch(keepalive)`; templates forced into the ordered group inherit ADR-002's chain-dependency limitation.

### Decision Drivers
- Blanket parallelization would silently change existing templates' linking behavior (Insight 3) — unacceptable for a stable, in-production extension with real customer template configurations.
- The independent/ordered classification must be derived from the same `linkTo`-rule parsing already present in `createWorkItem` (`app.ts:122-188`), not a new declarative field on templates — no template schema change is in scope.
- Whatever is parallelizable also determines which templates get ADR-002's full popup-close protection and which do not, so the classification is load-bearing for more than just speed.

### Considered Options
1. Leave the create loop fully serialized (status quo)
2. Blanket-parallelize all template creates — rejected: breaks `justCreatedTasks`-dependent templates per Insight 3
3. Classify templates by scanning their `linkTo` rules for `justCreatedTasks`-derived helper references; run the non-referencing group concurrently and the referencing group in the existing alphabetical order (SELECTED); also apply `Promise.all` to `getTeamSettings`/`getWorkItem` (zero-risk, no serious alternative considered)

### Decision Outcome
Chosen option: 3, because it delivers real, measured concurrency gains (Finding 3) with no observed behavior change for existing templates, and produces exactly the independent/ordered split that ADR-002's popup-close story depends on.

### Consequences

#### Good
- `getTeamSettings`/`getWorkItem` latency overlaps instead of stacking.
- Independent-group templates create concurrently and are maximally protected by `keepalive`.
- Ordered-group templates retain today's exact linking semantics — no observable behavior change.

#### Bad
- The classification logic (which `linkTo` values count as `justCreatedTasks`-derived) must be kept in sync if new `linkTo` rule types are ever added — a new maintenance coupling between the classifier and `createWorkItem`'s `linkTo` switch (`app.ts:127-186`) that didn't exist before.
- Requires careful implementation-time verification against existing template behavior (synthesis.md Open Question) — not just design-time reasoning — before shipping.
