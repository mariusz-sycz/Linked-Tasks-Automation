# Solution Exploration: Speed Up Task Creation, Add Progress Feedback, Fix Popup-Close Reliability

## TL;DR
Three interdependent decision areas: (1) which contribution surface hosts execution/UI, (2) caching strategy, (3) progress-feedback mechanism — (2) and (3) are constrained by (1)'s outcome. Recommended path: ship point-fixes now (localStorage caching, safe parallelization, live-updating modal progress dialog — no manifest change, resolves (a) partially and (b) partially); adopt a **Hybrid contribution architecture** (keep today's toolbar/context-menu trigger, add a Hub contribution as a decoupled execution+progress engine) as the target state that fully resolves (b) and (c); fall back to a pure Hub (trigger moves too) if the hand-off design proves too risky. Confidence: medium — the architecture recommendation rests on findings the research itself flags as not live-verified.

## Key Decisions
- Decision Area 1 (contribution surface) is the shared prerequisite — present it to the user first; Decision Areas 2 and 3 branch on its answer. — three independent research gatherers converged on this from unrelated angles (lifecycle, storage, progress-UI).
- Recommend `localStorage` caching strategy as "lazy now, eager-when-available later" (Alternative 4 in Decision Area 2) rather than picking one mode permanently — it is forward-compatible with whichever Decision Area 1 outcome is chosen.
- Recommend skipping the plain end-of-run modal in favor of a live-updating modal dialog as the near-term progress fix — same API (`IHostDialogService`), no manifest change, materially more informative for negligible extra effort.
- Do not pursue a toast/`GlobalProgressIndicator`-based "middle option" for progress feedback — the research found no evidence either control can cross into the host frame from this extension's contribution type; it would require the same speculative investment as the full architecture change with no confirmed benefit over it.

## Open Questions / Risks
- Whether dialog close actually tears down the current action contribution's iframe (the root-cause claim driving this entire exploration) is Medium-High confidence, not live-verified — the research report itself recommends live-verifying this before implementing any (c) fix (Recommendation 6).
- Whether a work-item-form-page contribution survives dialog close is explicitly unverified by the research and is the swing factor for whether Alternative 2 (form-page) is a viable lower-disruption substitute for the Hub in Decision Area 1.
- The Hybrid architecture's action-click → hub hand-off has no precedent in the research findings (no SDK API was found for this pattern) — it is a novel design that needs a feasibility spike before being treated as committed, not just a trade-off note.
- Whether adding a Hub contribution to an extension that currently ships only an action contribution has any Marketplace/manifest constraint was not investigated by the research and should be checked before committing to Decision Area 1's recommended path.

---

## Problem Reframing

### Research Question
How can the Linked Tasks Automation extension be changed to (a) preload/cache templates asynchronously after plugin load and create child tasks + links asynchronously so the user isn't blocked waiting after clicking "create"; (b) surface a visible, non-blocking progress indicator while creation is in flight; and (c) keep creating tasks in the background even if the Azure DevOps popup panel hosting the extension is closed, stopping only on a full page refresh?

### How Might We Questions
1. **HMW** make child-task creation resilient to the user closing the work item dialog immediately after clicking, so it keeps running until nothing short of a full page refresh stops it? *(Decision Area 1 — architecture)*
2. **HMW** give users a live, truthful sense that creation is progressing, without freezing their view of Azure DevOps while it runs? *(Decision Area 3 — progress feedback, constrained by Decision Area 1)*
3. **HMW** get templates ready before the user ever clicks "create," not just faster on the second click? *(Decision Area 1 & 2 — architecture unlocks true preload; caching alone only helps repeat clicks)*
4. **HMW** cache template data so repeat invocations feel instant today, in a way that upgrades cleanly if the architecture changes tomorrow rather than being thrown away? *(Decision Area 2 — caching strategy)*

---

## Decision Area 1: Contribution Surface for the Architecture Track

**Why this comes first**: per the research synthesis, this is "the single architectural fork the solution-design phase must resolve first" — it is the shared prerequisite for a robust fix to (b) and (c), and materially upgrades (a) from "faster on click #2" to true pre-click preload (synthesis Key Decision #1, Relationships diagram).

### Alternative 1: Minimal Change — Point-Fixes Only, No New Surface
Keep the single existing `ms.vss-web.action` contribution unchanged. Apply only the no-manifest-change point fixes: `localStorage` template caching, parallelize `getTeamSettings`/`getWorkItem`, selectively parallelize non-`justCreatedTasks`-dependent template creates, and a progress-adjacent modal dialog via `IHostDialogService`.

- **Strengths**: Zero manifest change, zero UX disruption (identical trigger location/behavior for existing users), lowest implementation risk and effort, ships fastest, requires no live-org verification to deliver value.
- **Weaknesses**: Does not genuinely resolve (b) — best available is a modal dialog, not live non-blocking progress. Does not resolve (c) at all — no point-fix exists for popup-close survival within this contribution type (Finding 11: no detached-execution API in this SDK generation). Deferring the architecture investment doesn't reduce its total cost, only delays it.
- **Best when**: The team wants to ship value immediately and is willing to treat (b)/(c) as a distinct follow-on phase, or if live verification later shows the popup-close root cause doesn't actually manifest as severely as the documented category contrast suggests.
- **Evidence**: Findings 2, 3, 6, 7; Report Recommendations 1–4; synthesis Pattern 3.

### Alternative 2: Work-Item-Form-Page Contribution
Add a new `ms.vss-work-web.work-item-form-page` contribution — a tab/section embedded directly in the work item form, visible for as long as the form is open.

- **Strengths**: Stays within the work-item context the user is already in (arguably more discoverable than a menu action, since it's an always-visible tab rather than something the user must know to click). Can host in-DOM VSS controls (`StatusIndicator`, `WaitControl`) *visibly*, unlike `toolbar.html`'s invisible iframe (Finding 7) — because the tab is part of the visible form DOM. Well-documented, common contribution type — moderate implementation complexity.
- **Weaknesses**: Whether it survives the *dialog* closing is explicitly unverified by the research ("needs verification" per this task's brief). Insight 2 warns that any fix keeping execution inside a form-scoped surface "inherits the same fragility" as the current action, "regardless of how the async work... is restructured" — a form-page tab is still form-scoped, the same category the research's strongest evidence (Finding 8) contrasts *against* the observer type that's documented to survive. If the parent work item is opened in a peek/dialog panel rather than the full form page, the tab's fate is the same open question as today's action.
- **Best when**: Live verification confirms work-item-form-page tabs do survive dialog close (currently an unverified assumption) *and* the team wants to keep the feature's UI inside the work item rather than moving to global navigation.
- **Evidence**: Finding 7 (visible DOM), Finding 8 (form-scoped vs. observer contrast), Insight 2, synthesis Open Question #1.

### Alternative 3: Hub Contribution
Add a new persistent Hub contribution — a dedicated page in Azure DevOps's left-hand navigation, fully decoupled from any work item form or dialog. Users would navigate to it to trigger creation and/or watch/verify progress.

- **Strengths**: Fully decoupled from the work item dialog's lifecycle — the cleanest, most-evidenced fix for (c). Can host any in-DOM VSS control fully visibly, resolving (b) without compromise. A hub's own page-load moment is the best available substitute for "preload after plugin load" (Finding 5's gap), since — unlike the action contribution — it can have a load moment distinct from any click. Per Finding 11 (no SDK detached-execution mode in this generation), a Hub is the most "always-on" surface architecturally available.
- **Weaknesses**: The single biggest UX/discoverability change among all alternatives — moves the trigger away from the toolbar/context-menu users click today. Users would need to navigate to a separate page to trigger or check on a feature that is inherently "act on the work item I have open right now," which risks feeling like a workflow regression for an established, stable extension (vision.md: "stable/maintenance mode... no active feature development in the last year" — an established user base with existing muscle memory). Requires either fully relocating the trigger (bigger behavior change) or building a hand-off from the existing trigger (Alternative 5's added complexity). Medium-High implementation complexity — new contribution type, new UI to build from scratch.
- **Best when**: Visible non-blocking progress and popup-close survival are hard requirements, and the team accepts changing how users invoke the feature.
- **Evidence**: Finding 11 (no detached execution), Finding 5 (no pre-click load moment for the action type), Finding 7 (visible DOM), synthesis Relationships diagram.

### Alternative 4: Observer Contribution (paired with a UI surface)
Add an `ms.vss-work-web.work-item-notifications`-style observer contribution — the one contribution type the research found *affirmatively documented* (not just inferred) to survive dialog close, because it "lives outside the form." The observer would own execution (headless), while the existing action stays as the trigger.

- **Strengths**: Directly targets (c) with the strongest single piece of evidence in the whole research set — a verbatim Microsoft Learn quote, not a category inference (Finding 8). Keeps the existing trigger unchanged, so no UX/discoverability disruption on the invocation side.
- **Weaknesses**: Headless by definition — has no UI surface of its own, so it does *not* resolve (b) on its own and must be paired with a second contribution purely for display, meaning this alternative alone is a partial answer requiring a second architectural decision anyway. Observer contributions are documented as designed to react to work-item *events* (e.g., `onSaved`) — the research found no evidence this contribution type is designed to be invoked on-demand from a toolbar click the way this extension needs; the click-to-observer hand-off mechanism is unverified and architecturally unclear, a genuine open question rather than a known API path.
- **Best when**: (c) is the single highest-priority sub-question and the team is willing to design a *second* contribution purely for (b)'s display needs, accepting a two-contribution architecture with an unresolved hand-off design.
- **Evidence**: Finding 8 (verbatim quote), synthesis Pattern 1.

### Alternative 5: Hybrid — Action Trigger + Hub-Hosted Execution Engine
Keep the existing `ms.vss-web.action` toolbar/context-menu entry as the *only* user-facing trigger (zero change to today's invocation UX), but on click, hand off the actual work to a Hub contribution decoupled from the dialog's lifecycle — e.g., write a "job" record to `localStorage` (already proven to survive iframe teardown, Finding 6) that the hub reads and executes, or activate the hub via `IHostNavigationService` alongside the click.

- **Strengths**: Preserves today's exact trigger UX (no discoverability regression, unlike Alternative 3 alone) while gaining the Hub's full decoupling from the dialog for execution — resolving (c) as robustly as Alternative 3 — and a fully visible surface for in-DOM progress controls — resolving (b) as robustly as Alternative 3. Reuses the already-validated `localStorage` mechanism (Finding 6) as the hand-off channel, keeping the point-fix and architecture tracks connected rather than duplicated.
- **Weaknesses**: Highest implementation complexity of all five alternatives — two contributions to build and coordinate, a hand-off/job-queue protocol to design and test from scratch (no precedent found anywhere in the research), and a real race condition to handle: if the user has never opened the hub, is it loaded to receive the hand-off at all? The exact scenario that most needs (c) — user clicks and immediately closes the dialog — is also the scenario where the hub's load state is least certain.
- **Best when**: The team wants to preserve today's UX trigger exactly while still fully resolving (b) and (c), and accepts materially higher effort and a genuinely novel design for that combination.
- **Evidence**: Synthesizes Finding 6 (localStorage survives teardown), Finding 11 (no detached execution — a loaded hub is the closest substitute), Insight 2 (trigger location need not move, only execution does).

---

## Decision Area 2: Caching/Async Restructuring Strategy

**Dependency on Decision Area 1**: a persistent surface (Hub, Hybrid, or a verified-surviving form-page) can warm the cache *eagerly* on its own load, before any click. A dialog-scoped surface (Alternative 1, or Alternative 2 if unverified/unsuitable) cannot — it only ever gets a "check cache, else fetch" moment at click time. Storage mechanism (`localStorage`) is settled per the research (Insight 4, Finding 12) — these alternatives differ only in *strategy*.

### Alternative 1: Reactive Check-Cache-Then-Fetch (Lazy Caching)
On every `AddTasks` invocation, check `localStorage` first; if present, use it; if absent, fetch and populate.

- **Strengths**: Simplest possible implementation; works identically regardless of Decision Area 1's outcome; delivers the full "helps click #2 onward" benefit documented in Finding 6/Report Recommendation 1 with minimal code change.
- **Weaknesses**: Click #1 in every session still pays full fetch latency; provides zero improvement toward the "preload before click" framing of the original brief.
- **Best when**: Decision Area 1 resolves to Alternative 1 (minimal change) or the team wants the cheapest possible near-term win regardless of the architecture track's timeline.

### Alternative 2: TTL/Staleness-Aware Cache with Stale-While-Revalidate
Same lazy read, but cache entries carry a TTL; on a cache hit, serve immediately *and* kick off a non-blocking background refetch to keep the cache current for next time.

- **Strengths**: Guards against serving stale templates if template configs change mid-session or across sessions; still delivers instant response on cache hits.
- **Weaknesses**: More moving parts (TTL bookkeeping, background refresh logic, potential double-fetch races) for a benefit that may be premature — templates in a stable/maintenance-mode extension (vision.md) likely change infrequently; risks conflicting with the project's own minimal-implementation standard (`.maister/docs/standards/global/minimal-implementation.md`) if built before staleness is an observed problem.
- **Best when**: Template configuration is known to change frequently enough that stale cache hits would be a real user-visible problem — not currently evidenced in this research.

### Alternative 3: Eager Cache Warming on Contribution Load
Warm the `localStorage` cache proactively the instant the new persistent surface (Hub/Hybrid/verified form-page) loads — before the user ever clicks "create." This is the literal "preload after plugin load" from the original brief.

- **Strengths**: The only alternative that fully satisfies (a) as literally stated; first click in a session is as fast as any subsequent click.
- **Weaknesses**: Only implementable once Decision Area 1 lands on a persistent surface — cannot stand alone as a near-term strategy; adds a small amount of unconditional background network traffic every time the surface loads, even if the user never ends up clicking "create."
- **Best when**: Decision Area 1 resolves to Alternative 3, 4, or 5 (any persistent surface), and true pre-click preload is a stated priority.

### Alternative 4: Hybrid — Lazy Now, Eager When Available (Recommended)
Ship Alternative 1's lazy caching immediately (works under any Decision Area 1 outcome), using the same cache read/write code path that Alternative 3's eager warming will later call from the new surface's load handler once/if it exists.

- **Strengths**: Forward-compatible regardless of which Decision Area 1 alternative is ultimately chosen — no code is thrown away or rewritten if the architecture track lands later; delivers Alternative 1's benefit today and upgrades automatically to Alternative 3's benefit without a second design effort.
- **Weaknesses**: Marginally more upfront design discipline than plain Alternative 1 (the cache-access function must be written as a reusable unit two call sites can share) — a small, worthwhile cost.
- **Best when**: As a general default — this is the recommended strategy independent of how Decision Area 1 resolves, since it strictly dominates Alternative 1 at negligible extra cost and doesn't require Decision Area 1 to be resolved first.
- **Evidence**: Finding 6 (localStorage mechanism), Finding 5 (no pre-click load moment without a new surface), synthesis Pattern 3.

---

## Decision Area 3: Progress-Feedback Approach

**Dependency on Decision Area 1**: only `IHostDialogService.openMessageDialog` is confirmed to render in the visible host frame from the *current* contribution type, and it is modal by design (Finding 7). Genuinely live, non-blocking, in-flight progress requires a visible surface not scoped to the dialog — i.e., the outcome of Decision Area 1.

### Alternative 1: Modal End-of-Run Summary Dialog
Open `IHostDialogService.openMessageDialog` once, after all creates/links finish, showing a result summary (e.g., "5 of 5 tasks created" or a partial-failure list).

- **Strengths**: Available today, no manifest change, cheapest possible feedback win, gives users *something* where there is currently nothing.
- **Weaknesses**: Not in-flight (only appears at the end) and not non-blocking (modal) — satisfies neither half of the brief's "visible, non-blocking, in-flight" requirement; strictly dominated by Alternative 2 below, which uses the same API for barely more effort.
- **Best when**: Only as a fallback if Alternative 2's live-update mechanism proves harder to implement than expected.

### Alternative 2: Live-Updating Modal Progress Dialog (Recommended near-term)
Open the same `IHostDialogService` dialog immediately on click, showing "0 of N created"; update its content via messaging as each template resolves; convert it to the final summary when done.

- **Strengths**: Available today, no manifest change; gives real in-flight visibility (not just an end-of-run summary) using the one API the research confirms crosses into the host frame; directly addresses the currently-silent error handling gap (Finding 4/secondary conclusion) by surfacing partial failures as they happen, not just at the end.
- **Weaknesses**: Still modal — blocks the user from interacting with the host page while it's open, which is an explicit violation of the brief's "non-blocking" requirement, just a smaller one than Alternative 1 (the user gets useful information while blocked, at least).
- **Best when**: As the near-term progress fix under any Decision Area 1 outcome, including while the architecture track is still being evaluated or built — it's a real improvement available immediately at low cost.
- **Evidence**: Finding 7 (`IHostDialogService` confirmed host-frame-crossing but modal), Finding 4 (no aggregate completion signal exists yet — this alternative requires building one, which is needed regardless of the final progress mechanism chosen).

### Alternative 3: Toast / Periodic Notification-Based Progress — Not Recommended
Investigated per this task's brief as a possible "middle option": fire periodic `ToastNotification`-style updates from the host frame as templates complete.

- **Strengths**: Would be non-blocking if it worked, unlike the modal alternatives — no explicit interaction blocking.
- **Weaknesses**: The research found no evidence this is reachable from the current contribution type. Finding 7 states explicitly that `ToastNotification`, like `StatusIndicator`/`WaitControl`, "renders in-DOM into whatever document instantiates them" — for this extension, that's the invisible `toolbar.html` iframe, not the host frame. `GlobalProgressIndicator` is likewise a "per-frame singleton with no documented way for an extension to reach the host page's instance." Pursuing this option would require the same category of speculative platform investigation as evaluating Decision Area 1's new-surface alternatives, with no confirmed advantage over simply building genuine live progress in that new surface once it exists (Alternative 4 below).
- **Best when**: Not recommended given current evidence. Worth revisiting only if a live-org spike specifically discovers a host-frame-reachable toast/notification path this research didn't find.
- **Evidence**: Finding 7 (exhaustive typings-verified scan, explicitly covering `ToastNotification` and `GlobalProgressIndicator`).

### Alternative 4: True Live, Non-Blocking Progress in a New Visible Surface
Once Decision Area 1 lands on a persistent visible surface (Hub, Hybrid, or a verified-surviving form-page), host a real progress bar/status control directly in that surface's DOM, updated live as each template/link resolves, with no interaction blocking.

- **Strengths**: The only alternative that fully satisfies (b) exactly as stated in the brief — visible, non-blocking, and in-flight, all three at once.
- **Weaknesses**: Categorically unavailable until Decision Area 1 is resolved in favor of a persistent surface — cannot be delivered on its own timeline; inherits all of that surface's implementation complexity and (for Alternative 5/Hybrid specifically) its hand-off-timing risk.
- **Best when**: As the target state once Decision Area 1's architecture track lands — should replace Alternative 2 at that point rather than run alongside it indefinitely.
- **Evidence**: Finding 7 (in-DOM controls work correctly, just not in an invisible iframe), synthesis Relationships diagram.

---

## Trade-Off Analysis

### Decision Area 1 — Contribution Surface

| Alternative | Technical Feasibility | User Impact | Simplicity | Risk | Scalability |
|---|---|---|---|---|---|
| 1. Minimal change (no new surface) | High — all mechanisms confirmed today | Neutral-positive — same trigger, faster repeat clicks, no live progress | High — smallest change surface | Low technical risk; but leaves (b)/(c) unsolved, a scope/expectation risk | Fine at current scale; doesn't grow with feature set |
| 2. Work-item-form-page | Medium — well-documented contribution type, but dialog-close survival unverified | Neutral — stays in-context, but discoverability of a new tab is unproven | Medium | Medium-High — the load-bearing claim (survives dialog close) is unverified and Insight 2 casts doubt on it | Good — reusable pattern if more form-integrated features are added later |
| 3. Hub | High — most-evidenced fix for (b) and (c) | Negative in the near term (workflow change: navigate away from the work item) | Medium-Low — new UI, new contribution to build | Medium — mostly UX/adoption risk, not technical | Good — a hub can host future features beyond this one |
| 4. Observer (paired) | Medium — strongest single evidence for (c), but click-to-observer hand-off is unverified/unclear | Neutral for the trigger, but (b) still needs a second surface to be usable | Low — this alone is a partial answer, not a complete one | Medium-High — hand-off mechanism has no confirmed API path | Limited on its own; only scales as part of a paired design |
| 5. Hybrid (action + hub) | Medium — combines two confirmed mechanisms (action, localStorage, hub) in a novel, unverified combination | Best of all — no trigger UX change, full (b)/(c) resolution | Low — most moving parts of any alternative | Medium-High — genuine race-condition risk (hub not yet loaded) and no precedent for the hand-off pattern | Best long-term — trigger and execution surface can evolve independently later |

### Decision Area 2 — Caching Strategy

| Alternative | Technical Feasibility | User Impact | Simplicity | Risk | Scalability |
|---|---|---|---|---|---|
| 1. Lazy (check-then-fetch) | High — directly confirmed by Finding 6 | Positive from click #2 onward; click #1 unchanged | High | Low | Fine — no added moving parts as usage grows |
| 2. TTL + stale-while-revalidate | Medium — sound pattern, but adds bookkeeping | Marginal improvement over Alt 1 for this data profile (infrequent template changes) | Medium-Low | Low-Medium — mostly complexity risk, possible premature optimization | Fine, but complexity doesn't buy proportionate benefit here |
| 3. Eager warming | High, but only once Decision Area 1 provides a load moment | Best for (a) as literally stated — first click is instant | Medium | Low once the prerequisite surface exists | Fine |
| 4. Hybrid (lazy now, eager later) | High — reuses Alt 1's confirmed mechanism, extensible to Alt 3 | Matches Alt 1 now, upgrades to Alt 3's benefit automatically | High — same effort as Alt 1 if written as a shared function | Low | Best — no rework needed when Decision Area 1 resolves |

### Decision Area 3 — Progress Feedback

| Alternative | Technical Feasibility | User Impact | Simplicity | Risk | Scalability |
|---|---|---|---|---|---|
| 1. End-of-run modal | High — confirmed API, available today | Low — no in-flight visibility, still blocks user at the end | High | Low | Fine, but strictly dominated by Alt 2 |
| 2. Live-updating modal | High — same confirmed API, extended | Medium — real in-flight info, but still blocks interaction | Medium | Low | Fine as an interim measure |
| 3. Toast/notification "middle option" | Low — no evidence this crosses to the host frame | Would be best (non-blocking) *if* it worked, but it's speculative | Low — would require net-new platform discovery work | High — unvalidated technical premise | N/A — not evidenced as viable |
| 4. Live progress in new surface | High, but gated on Decision Area 1 | Best possible — fully satisfies "visible, non-blocking, in-flight" | Medium (inherits the surface's complexity) | Medium — inherits Decision Area 1's risk profile | Best — same surface can host future feedback needs |

---

## User Preferences

No user preferences have been captured yet at this stage — per the solution-brainstormer's mandate, these alternatives were generated purely from research evidence, without bias toward any pre-existing preference, so the orchestrator can run an unbiased convergence dialogue against this document. The one preference signal available from the task brief itself is an explicit concern about UX/trigger-location disruption in Decision Area 1, which is reflected in every alternative's "User Impact" assessment above and should be weighted explicitly when the user is asked to choose.

---

## Recommended Approach

**Decision Area 1 (contribution surface)**: Ship **Alternative 1 (minimal change / point-fixes)** immediately — it is net-positive regardless of what happens next and unblocks nothing else. In parallel, adopt **Alternative 5 (Hybrid: action trigger + Hub-hosted execution engine)** as the target architecture, because it is the only alternative that fully resolves (b) and (c) *without* changing how users trigger the feature today — the concern this task's brief explicitly flagged as needing real evaluation. Treat **Alternative 3 (pure Hub)** as the fallback if the Hybrid's action-to-hub hand-off proves too unreliable during a feasibility spike (the hub-not-yet-loaded race condition is the specific risk to de-risk first). Treat **Alternative 2 (form-page)** as a contingent, potentially lower-effort UI-hosting option only if live verification shows it survives dialog close — currently unverified and viewed with skepticism per Insight 2. Treat **Alternative 4 (observer)** as a possible defensive addition layered onto the Hybrid later (not a starting point) if the hub-load race proves to be a real, unsolvable problem in practice.

**Decision Area 2 (caching strategy)**: Adopt **Alternative 4 (lazy now, eager when available)**. It ships today under Alternative 1's minimal-change track and requires no rework when/if the architecture track lands — it's a strict improvement over plain lazy caching at negligible extra cost.

**Decision Area 3 (progress feedback)**: Adopt **Alternative 2 (live-updating modal dialog)** as the near-term fix, shipping alongside the Decision Area 1 point-fixes. Plan to replace it with **Alternative 4 (true live progress in the new surface)** once the architecture track lands. Do not pursue Alternative 3 (toast/notification) — no evidence supports it being reachable from this extension's contribution type.

**Key trade-offs accepted**: The Hybrid architecture (Decision Area 1) is the highest-complexity alternative among its peers, chosen deliberately to protect the existing trigger UX at the cost of a genuinely novel, unprecedented hand-off design that will need its own feasibility validation before being treated as committed. The interim progress fix (Decision Area 3, Alternative 2) knowingly ships something that is still technically "blocking" (modal) as a deliberate, evidence-based trade-off against shipping nothing until the full architecture lands.

**Key assumptions**:
- Dialog close does in fact tear down the current action contribution's iframe as the documented category-contrast evidence suggests (Finding 8, Medium-High confidence, not live-verified). If live verification shows otherwise, the urgency and shape of the entire Decision Area 1 recommendation changes.
- Azure DevOps permits adding a Hub contribution alongside an extension's existing action contribution with no Marketplace/manifest constraint the research did not investigate.
- Users will tolerate a Hub existing in navigation (even if never required to visit it under the Hybrid) as long as their existing click-to-create workflow is unchanged — this is a product judgment, not something the research evidenced, and should be confirmed with actual users/stakeholders during convergence.

**Confidence**: Medium. High confidence in the mechanisms underlying the point-fix track (Findings 2, 3, 6, 7 are all High confidence); medium confidence in the architecture recommendation specifically, because it depends on claims the research itself rates Medium/Medium-High and explicitly recommends live-verifying (Report Recommendation 6) before implementation.

---

## Why Not Others

**Decision Area 1**:
- *Alternative 2 (form-page), rejected as primary*: The one claim that would make it competitive with the Hub — that it survives dialog close — is unverified, and the strongest available evidence (Finding 8's category contrast) suggests skepticism, not confidence, since it's still a form-scoped surface.
- *Alternative 3 (pure Hub), rejected as primary but kept as fallback*: Fully resolves (b)/(c) but at the cost of the UX disruption this task's brief specifically asked to be evaluated carefully — the Hybrid achieves the same technical outcome without that cost, at the price of more implementation complexity, which is judged worth paying first.
- *Alternative 4 (observer alone), rejected as primary*: Headless by definition, so it cannot resolve (b) without a paired surface anyway — adopting it as the primary answer would just mean building the Hub (or form-page) regardless, making the observer redundant as a starting point rather than a genuine alternative to one.

**Decision Area 2**:
- *Alternative 1 (plain lazy), rejected in favor of Alternative 4*: Alternative 4 delivers identical near-term behavior at negligible extra design cost and avoids a rewrite later — there's no scenario where plain Alternative 1 is strictly better.
- *Alternative 2 (TTL/stale-while-revalidate), rejected*: Adds complexity for a staleness problem not evidenced as real in a stable/maintenance-mode extension with infrequently-changing templates; would conflict with the project's own minimal-implementation standard absent an observed need.
- *Alternative 3 (eager only), rejected as a standalone choice*: Cannot ship until Decision Area 1 resolves — Alternative 4 already includes it as a phase, making it redundant as a separate choice.

**Decision Area 3**:
- *Alternative 1 (end-of-run modal only), rejected*: Strictly dominated by Alternative 2, which uses the identical API for materially more useful information.
- *Alternative 3 (toast/notification), rejected*: No research evidence supports it being reachable from the host frame in this contribution type; pursuing it would mean redoing platform-capability research this task already completed, for an uncertain payoff.

---

## Deferred Ideas

- **Migrating the promise chain off `Q` to native `Promise`/`async`/`await`** — orthogonal to all three decision areas; relevant only because the `q` AMD module's runtime resolution in the shipped bundle is an open question (Gaps and Uncertainties). Worth addressing as part of implementation but not a solution-space decision in its own right.
- **`IExtensionDataService`-based cross-device/cross-browser template durability** — explicitly deprioritized by the research (Insight 4) since it offers no latency advantage and the current localStorage approach is sufficient; would only become relevant if cross-device durability becomes a stated product requirement, which it isn't today.
- **Fixing the pre-existing `bugsBehavior` numeric-enum-vs-string-literal bug in `GetChildTypes`** — a real, already-documented defect (roadmap.md technical debt) discovered during the prior TypeScript migration, but unrelated to speed/progress/popup-close; out of this research's scope and this exploration's scope.
- **Full server-side/backend component to enable truly detached background execution** — would sidestep the entire "no detached-execution API" constraint (Finding 11) at the root of Decision Area 1, but is explicitly out of scope per the original research brief (extension is stateless/browser-only by design) and conflicts with the project's "no backend" architecture (tech-stack.md).
