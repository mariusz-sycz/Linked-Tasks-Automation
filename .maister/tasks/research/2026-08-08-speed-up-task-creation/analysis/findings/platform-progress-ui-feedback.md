# Platform Findings: VSS SDK Progress / Notification UI Options for Action-Contribution Extension

## TL;DR
- This extension's only contribution (`create-linked-tasks-button-test`, `src/vss-extension.json:67-84`) is type `ms.vss-web.action` targeting `ms.vss-work-web.work-item-toolbar-menu` / `-context-menu`, backed by `toolbar.html` (`src/toolbar.html:1-42`), which has an **empty `<body>`** — it is a script-execution surface only, not a persistent visible panel. Any UI class instantiated from `VSS/Controls/*` (StatusIndicator, WaitControl, LongRunningOperation, ToastNotification) renders **into the DOM of that same invisible/non-hosted iframe context**, so on their own **none of them will be visible to the user** in this extension's current architecture.
- The one API in the legacy `vss-web-extension-sdk` (v1.104.0) that genuinely renders in the **host page** (visible regardless of the action-contribution iframe's visibility) is `IHostDialogService` (`VSS.getService(VSS.ServiceIds.Dialog)` → `openMessageDialog`), because it is implemented via cross-domain messaging (XDM) to a service living in the parent frame (`src/node_modules/vss-web-extension-sdk/typings/vss.d.ts:25877-25907`). It is **modal** though — it blocks user interaction with the host page (not JS execution) until dismissed, which conflicts with the "non-blocking" requirement unless used only for a final success/error message, not live progress.
- `GlobalProgressIndicator` (`VSS/VSS` module) is also host-page-scoped conceptually, but the exported `globalProgressIndicator` singleton (`vss.d.ts:29316,29473-29494`) lives in whichever page's `VSS/VSS` module instance is running — for an extension iframe that is the **extension's own local instance**, not the host page's. There is no documented/typed way for an extension to reach into the *host frame's* `globalProgressIndicator` instance; only `IHostDialogService`-style contributed services (obtained via `VSS.getService`) cross the frame boundary.
- **Practical implication**: none of the built-in VSS controls give a clean "visible, non-blocking, host-page-level progress bar" out of the box for this contribution type. The two realistic paths are (a) give the extension a visible host surface (e.g., add a `ms.vss-work-web.work-item-form-page` or a menu-triggered `openDialog` contribution) and use `StatusIndicator`/`WaitControl` inside that surface, or (b) use `IHostDialogService.openMessageDialog` for a lightweight blocking confirmation/result message (acceptable if creation is fast, weaker fit if it must be non-blocking), or (c) do the progress UI outside the VSS Controls library entirely (e.g., manipulate the ADO work item form's own DOM/notification area via REST, or rely on the natural side effect of work items appearing/linking on the board as "progress").

## Open Questions / Risks
- Could not find a first-party Microsoft sample specifically showing a toast/progress indicator triggered from a **toolbar/context-menu action contribution** (as opposed to a hub or work-item-form-page contribution) — Microsoft Learn and the extension-sample repo mostly document dialogs and work-item-form panels, not toolbar actions with live progress (Medium confidence gap, see External Sources below).
- Whether the `ms.vss-web.action` iframe (`toolbar.html`) is rendered with zero size / `display:none` by the ADO host, or is simply not given a layout container that keeps it in the visible viewport, was not directly confirmed against ADO's host-page source (no access to that in this task) — inferred from the manifest target type and the empty `<body>` in `toolbar.html`, and corroborated by general community reports that `ms.vss-web.action` bodies are not meant to render visible UI (see External Sources). **Confidence: Medium.**
- Newer `azure-devops-extension-sdk` (not what this project uses) exposes `IGlobalMessagesService`/`addToast` and `IHostPageLayoutService.openMessageDialog` with richer options; confirmed **absent** from this project's SDK typings (grep for `IGlobalMessagesService`, `addToast`, `HostPageLayoutService` in `vss.d.ts` returned no matches). If a host-level toast is a hard requirement, migrating to `azure-devops-extension-sdk` is a separate, larger option worth flagging to the user/orchestrator — out of scope for this findings file but noted as a trade-off row.

---

## Local Typings Findings

### 1. `VSS/Controls/StatusIndicator` — `StatusIndicator`, `LongRunningOperation`, `WaitControl`

Source: `src/node_modules/vss-web-extension-sdk/typings/vss.d.ts:14976-15299`

**`StatusIndicator`** (extends `StatusIndicatorO<IStatusIndicatorOptions>`, `vss.d.ts:14994-15035`)
- It is a `Controls.Control<TOptions>` — i.e., a jQuery-UI-style widget that must be created/enhanced **into a DOM element that already exists in the calling page**. There is no host-frame variant.
- Key options (`IStatusIndicatorOptions`, `vss.d.ts:14979-14993`): `message`, `eventTarget`, `imageClass`, `center`, `throttleMinTime`, `statusStartEvent`/`statusCompleteEvent`/`statusErrorEvent` (event-name driven auto start/stop), `announceProgress` (screen-reader).
- Methods: `start(options?)`, `delayStart(delay)`, `complete()`, `error(error)`, `setMessage(message)`, `showElement()`, `hideElement()`, `isActive()` (`vss.d.ts:15006-15025`).
- **Confidence: High** (directly from typings) that this is inline/in-DOM only — confirmed by its base class `Controls.Control<TOptions>` and lack of any XDM/service plumbing in its module.

**`LongRunningOperation`** (`vss.d.ts:15037-15079`)
- Constructor: `new LongRunningOperation(container: any, options?: any)` — JSDoc explicitly says: *"showing a blocking indicator in a cancellable means **overtop the specified container**"* (`vss.d.ts:15044-15053`). This is an explicit **blocking overlay** over a container element you supply — it needs `container` to be a real, visible DOM node in the same document. Internally creates a `WaitControl` (`createWaitControl`, `getWaitControl()`).
- Methods: `beginOperation(operationCallback: IResultCallback)`, `endOperation()`, `isCancelled()`, `cancelOperation()`.
- **Confidence: High** that this is inline-DOM and, per its own doc comment, explicitly blocking (overlay), not a good match for "non-blocking."

**`WaitControl`** (extends `WaitControlO<IWaitControlOptions>`, `vss.d.ts:15091-15297`)
- `IWaitControlOptions.target?: JQuery` — *"Target element in which an overlay and a message box is displayed. If not specified, **whole window is used**"* (`vss.d.ts:15093-15096`). So it CAN cover the "whole window" of whatever document it's instantiated in — but that document is still the extension's own iframe document (`toolbar.html`), not the ADO host page, so "whole window" still means "whole (invisible) extension iframe," not the visible work-item form.
- Other options: `message`, `cancellable`, `cancelCallback`, `fade`, `showDelay` (default 250ms), `backgroundColor`, `image`, `minLifetime`, `minLifeSpanBlocking`.
- Methods: `startWait(cancellable?)`, `endWait()`, `cancelWait()`, `setMessage(message)`, `isCancelled()`.
- **Confidence: High** — inline/in-DOM, and per its name/design intent it is a blocking overlay+message box (not a slim progress bar), matching `minLifeSpanBlocking` option naming.

**Verdict for #1**: All three classes render into the DOM of the calling script's document. Since this extension's only contribution is an action (`toolbar.html`, empty `<body>`) with no persistent visible host surface, using these classes as-is would create UI the user never sees. They would only become useful if the extension gained a visible host surface (dialog contribution or work-item-form-page contribution) to host them in.

---

### 2. `VSS/Controls/Notifications` — `ToastNotification`

Source: `src/node_modules/vss-web-extension-sdk/typings/vss.d.ts:13860-14012` (class at `13987-14011`)

- `export class ToastNotification extends Controls.BaseControl` — doc comment: *"This class affords showing a toast-style notification which fades in, appears for a certain amount of time and then fades out"* (`vss.d.ts:13983-13987`).
- API: `constructor(options?: any)`, `toast(message: any, messageType?: MessageAreaType)` (`MessageAreaType`: `None`, `Info`, `Warning`, `Error` — `vss.d.ts:13862-13867`), internal `_ensureNoActiveToast()` to cancel overlapping toasts.
- Like `StatusIndicator`, it extends `Controls.BaseControl` — **rendered in the calling document's DOM**, not the host frame. There is no XDM/service wrapper for it (unlike `HostDialogService`).
- **Confidence: High** that `ToastNotification` is contained within the extension's own iframe and would be invisible for this action-contribution's `toolbar.html` (no visible host surface), and would only appear if used inside a contribution type that *does* get a rendered/visible surface (e.g. a `ms.vss-web.control` hosted in an `IHostDialogService.openDialog`, or a work-item-form-page contribution's own panel).

---

### 3. `GlobalProgressIndicator`

Source: `src/node_modules/vss-web-extension-sdk/typings/vss.d.ts:29312-29494`

- `declare module "VSS/VSS"` exports `export var globalProgressIndicator: GlobalProgressIndicator;` (`vss.d.ts:29316`) — a **singleton instance of the current page's `VSS/VSS` module**.
- Class `GlobalProgressIndicator` (`vss.d.ts:29473-29494`): doc comment — *"Global handler for displaying progress during page loads, module_ loads, ajax requests, or any other registered long-running operations"*.
- API: `registerProgressElement(element: JQuery)` / `unRegisterProgressElement(element)` (register a DOM element, e.g. a thin top-of-page bar, to be shown/hidden automatically), `actionStarted(name: string, immediate?: boolean): number` / `actionCompleted(id: number)` (reference-counted start/stop pairing), `getPendingActions(): string[]`.
- **Critical caveat**: because `VSS/VSS` is loaded independently inside every frame that calls `VSS.init()`/`VSS.require(...)` (each frame gets its own module instance under RequireJS), the `globalProgressIndicator` an extension script accesses via `VSS.require(["VSS/VSS"], ...)` from `toolbar.html` is **the extension iframe's own instance**, tracking/registering elements only within that iframe's DOM — not the ADO host page's top-level progress bar. There is no typed accessor that lets an extension reach into the *host frame's* `globalProgressIndicator`. (There's also a companion `GlobalMessageIndicator.updateGlobalMessageIfEmpty(message, messageLevel?)` at `vss.d.ts:29496-29498`, same frame-locality caveat applies.)
- **Confidence: Medium-High**. The frame-locality conclusion is inferred from standard RequireJS-per-document behavior plus the total absence of any XDM/service wrapper for `VSS/VSS` (contrast with `HostDialogService`, which is explicitly delivered via `VSS.getService` and documented as reaching "the parent host," `vss.d.ts:2812-2818`). Not empirically verified against a live ADO page in this task.

---

### 4. `IHostDialogService` (host-level; the one API confirmed to cross the frame boundary)

Source: interface `vss.d.ts:636-674`; implementation `HostDialogService` in `declare module "VSS/SDK/Services/Dialogs"` `vss.d.ts:25877-25907`; service id `VSS.ServiceIds.Dialog` documented at `vss.d.ts:2745-2750` ("Service for showing dialogs in the host frame. Use: `<IHostDialogService>`").

- Obtained via `VSS.getService<IHostDialogService>(VSS.ServiceIds.Dialog).then(dialogService => ...)`. `VSS.getService` is explicitly documented: *"Get a **contributed service from the parent host**"* (`vss.d.ts:2812-2818`) — this is the one call in the SDK that is unambiguously host-frame-scoped, implemented over XDM (`VSS/SDK/Services/Dialogs` service id `"vss.dialogs"`, `vss.d.ts:25877-25884`).
- `openMessageDialog(message: string | JQuery, options?: IOpenMessageDialogOptions): IPromise<IMessageDialogResult>` (`vss.d.ts:654`, impl `25900`) — shows a **modal** dialog in the host frame with a message and buttons (default Ok/Cancel), resolves/rejects based on which button was clicked. Options (`IOpenMessageDialogOptions`, `vss.d.ts:592-621`): `buttons`, `escapeButton`, `requiredTypedConfirmation`, `title`, `width`, `height`, `useBowtieStyle`.
- `openDialog(contributionId, dialogOptions, contributionConfig?, postContent?): IPromise<IExternalDialog>` (`vss.d.ts:646`, impl `25893`) — opens a modal dialog whose *content* comes from a **separate contribution of type `ms.vss-web.control`** that this extension does not currently define (`vss-extension.json` only declares the one `ms.vss-web.action` contribution). `IHostDialogOptions` (`vss.d.ts:517-533`) includes `modal?: boolean`, `draggable`, `resizable`, `okCallback`, `cancelCallback`, etc. — but note `openDialog` always requires a contributed control to host, i.e., non-trivial manifest + new HTML/JS surface to build a real progress panel this way.
- **Blocking semantics**: "modal" here means the dialog blocks *user interaction with the host page* (an actual overlay/modal in the host DOM) — it does **not** block the JavaScript event loop or any in-flight async REST calls, which continue running underneath. So it's not "blocking" in the code-execution sense, but it **is** blocking in the UX sense the user asked to avoid (they can't interact with the work item until they dismiss it), unless it is only shown briefly for a final success/failure notice rather than kept open for the whole creation duration.
- **Confidence: High** (directly from typings + doc comments) on the API surface and host-frame-crossing behavior; **Medium** on how "modal" renders visually in the current ADO host chrome (not verified live).

---

### 5. Contribution type confirmation (`src/vss-extension.json:39-84`)

```json
"targets": [{ "id": "Microsoft.VisualStudio.Services" }],
"contributions": [
  {
    "id": "create-linked-tasks-button-test",
    "type": "ms.vss-web.action",
    "targets": [
      "ms.vss-work-web.work-item-toolbar-menu",
      "ms.vss-work-web.work-item-context-menu"
    ],
    "properties": {
      "uri": "toolbar.html",
      "registeredObjectId": "create-linked-tasks-button-test"
    }
  }
]
```
- Single contribution, type `ms.vss-web.action`, targeting the work item toolbar menu and context menu. No `ms.vss-work-web.work-item-form-page`, no hub, no `ms.vss-web.control`/dialog-content contribution exists in the manifest today.
- `src/toolbar.html:11-41` — `<body>` contains only a `<script>` block; `VSS.init()` then `VSS.register(...)` registers an object whose `execute(actionContext)` method (invoked by the host when the menu item is clicked) calls into `scripts/app.js`. There is no visible markup at all in the body — confirming this iframe was never designed to show UI, only to run JS in response to the menu click.
- **Confidence: High** (direct file read).

---

## External Sources

1. **Add a menu action** — https://learn.microsoft.com/en-us/azure/devops/extend/develop/add-action?view=azure-devops
   Confirms the `ms.vss-web.action` contribution pattern (`type: "ms.vss-web.action"`, `uri` pointing to an HTML page with a registered execute handler) matches this project's setup. Does not show any progress/toast UI example for this contribution type — action-contribution samples in Microsoft's docs focus purely on triggering logic, not on rendering feedback. Supports the inference that this contribution type is not designed with a visible persistent surface in mind. **Confidence: Medium** (absence of an example is suggestive, not conclusive).

2. **Create modal dialogs in Azure DevOps extensions** — https://learn.microsoft.com/en-us/azure/devops/extend/develop/using-host-dialog?view=azure-devops
   Documents exactly the `VSS.getService(VSS.ServiceIds.Dialog)` → `openDialog`/`openMessageDialog` pattern found in the typings, confirming this is the sanctioned way for any extension surface (including an action contribution) to show host-frame-level UI. Matches `vss.d.ts:636-674, 25877-25907`. **Confidence: High.**

3. **Porting VSS Web Extension SDK to Azure DevOps Web Extension SDK** (Medium, Phong Cao) — https://phongthaicao.medium.com/porting-vss-web-extension-sdk-to-azure-devops-web-extension-sdk-86a6ce3f39c2
   Describes the newer `azure-devops-extension-sdk`/`azure-devops-extension-api` packages replacing `VSS.getService(VSS.ServiceIds.Dialog)` with `SDK.getService(CommonServiceIds.HostPageLayoutService)`, which additionally exposes richer host-level UX (e.g. banners/toasts) not present in the legacy SDK this project pins (`vss-web-extension-sdk@^1.104.0`, `src/package.json:14`). Relevant only as a **future migration trade-off**, not an in-place fix. **Confidence: Medium** (blog source, not primary docs) — corroborated by this project's typings genuinely lacking `HostPageLayoutService`/`IGlobalMessagesService`/`addToast` (grep returned zero matches).

4. **Add a menu action / Extend the work item form** (general context) — https://learn.microsoft.com/en-us/azure/devops/extend/develop/add-workitem-extension?view=azure-devops
   Shows the alternative contribution type `ms.vss-work-web.work-item-form-page`, which *does* get a persistent, visible panel/tab on the work item form (unlike the toolbar/context-menu action this extension currently uses). This is the concrete path to a "real" visible host surface if the team wants in-DOM `StatusIndicator`/`WaitControl`/`ToastNotification` to actually be seen. **Confidence: High** (directly documents an alternative, well-known contribution type) — but adopting it is a manifest/UX change beyond just "add a progress indicator," flagged as an option for the synthesis phase, not a recommendation made here.

---

## Trade-off Table

| API | Requires visible extension host surface? | Genuinely non-blocking of host page? | Implementation complexity | Fit for toolbar/context-menu action contribution (no persistent hub) |
|---|---|---|---|---|
| `StatusIndicator` (`VSS/Controls/StatusIndicator`) | Yes — renders inline into a DOM element in the calling document; that document is `toolbar.html`'s invisible iframe today | Yes (it's just a small spinner/message element, doesn't overlay/lock anything) | Low (simple `start()`/`complete()`/`setMessage()`) | **Poor as-is** — invisible in current architecture; would need a new visible surface (dialog content or form-page contribution) to host it in |
| `WaitControl` / `LongRunningOperation` (`VSS/Controls/StatusIndicator`) | Yes — same as above, plus by design overlays/blocks its target container ("whole window" of the iframe if no target given) | **No** — explicitly a blocking overlay+message-box pattern (`LongRunningOperation` doc literally says "blocking indicator") | Low-Medium | **Poor fit** — even if made visible, its blocking-overlay design fights the "non-blocking" requirement |
| `ToastNotification` (`VSS/Controls/Notifications`) | Yes — same in-DOM limitation as `StatusIndicator` | Yes (fades in/out, doesn't lock anything) | Low (`toast(message, type)`) | **Poor as-is** for the same invisibility reason; good candidate *if* paired with a visible surface |
| `GlobalProgressIndicator` (`VSS/VSS`) | Ambiguous/likely yes — appears to be host-page-level conceptually but the extension only gets its **own local frame's instance**, not the true host page's; no documented cross-frame accessor | Yes in design intent (thin top bar), but moot if it never crosses into the visible host frame | Low API, but effectively unusable for this purpose without cross-frame access — **not verified** to work at all from an action-contribution iframe | **Unreliable / not recommended** without further live verification; not proven to reach the host page a user actually sees |
| `IHostDialogService.openMessageDialog` (`VSS/SDK/Services/Dialogs`, via `VSS.getService(VSS.ServiceIds.Dialog)`) | **No** — it's the one API confirmed to render in the **host frame** regardless of the calling iframe's own visibility (XDM-based contributed service) | **No** for the open duration — it is a modal dialog that blocks user interaction with the host page (though not JS execution) until dismissed | Low (single promise-based call) | **Best fit among built-ins for a final result message** (e.g., "5 of 5 tasks created" / error summary) shown once creation finishes; **poor fit as a live in-flight progress display** because it's modal by design |
| `IHostDialogService.openDialog` (custom `ms.vss-web.control` contribution) | No (renders in host frame) but requires building an **entirely new contribution** (extra manifest entry + HTML/JS) to host real content (e.g., a `StatusIndicator`/progress bar) inside it | Same modal caveat as `openMessageDialog` unless configured non-modal (`IHostDialogOptions.modal?`) — modality is a dialog option, not forced | **High** — new contribution type, new HTML page, new manifest wiring, plus dialog lifecycle management | Viable but heavyweight; more work than likely justified just for a progress indicator |
| New `ms.vss-work-web.work-item-form-page` contribution (or similar persistent hub/panel) | Yes, but this contribution type is **designed** to have a visible, persistent panel — so `StatusIndicator`/`WaitControl`/`ToastNotification` would then genuinely be visible | Yes, fully controllable | **Medium-High** — new contribution type in manifest, new panel HTML/JS, likely reorganizes how the extension is invoked (persistent panel vs current click-to-run action) | Best long-term fit for "visible, non-blocking progress bar," but is a larger architecture change beyond adding one API call |
| Migrate to `azure-devops-extension-sdk` (`HostPageLayoutService`/toast APIs) | Depends on chosen service, but modern SDK has richer non-modal host-level notification options not present in the legacy SDK | Potentially yes (modern toast/banner APIs) | **High** — full SDK migration, out of scope for a targeted progress-indicator change | Not recommended as the direct fix here; noted only as a longer-term alternative the synthesis phase may want to flag |

**Overall conclusion for the research question**: Given this extension's actual contribution type (`ms.vss-web.action` with an invisible `toolbar.html` iframe and no persistent panel), **no built-in VSS SDK v1.104.0 control delivers a visible, in-flight, non-blocking progress bar without either (a) adding a new visible contribution/surface to the manifest, or (b) accepting a modal `openMessageDialog` (only really works well as a "done" summary, not live progress), or (c) an unverified/likely-nonfunctional attempt to reach the host frame's `globalProgressIndicator`.** This is the key architectural constraint the synthesis/solution-design phase needs to reconcile with the "non-blocking progress indicator" requirement — it will very likely require adding a new manifest contribution (dialog-content control or work-item-form-page panel) rather than a same-file code change to `toolbar.html`/`app.ts` alone.
