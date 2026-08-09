# Codebase Findings: Click-to-Task-Created Call Graph

## TL;DR
The entire flow is a single deeply-nested Q-promise chain (`AddTasks` → `getTeamSettings` → `getWorkItem` → `GetChildTypes` → `getTemplates` → per-template `getTemplate`+`createWorkItem` chained **sequentially, one template at a time** via `chain = chain.then(...)`) with **zero UI feedback anywhere** — no spinner, no disabled button, no progress text, not even a final "done" callback back to the host (`create()` returns `void` and nothing is awaited by the caller). Templates are only serialized because of the `justCreatedTasks` array used by "linkTo" rules (`ToAllJustCreatedTasks`, `PreviouslyCreatedTask`, etc.) — but the code as written serializes **all** templates unconditionally, even ones with no such rule, so there is real parallelization headroom for templates that don't reference `justCreatedTasks`. Parent-link and same-batch "linkTo" calls (`linkItems`, `getRelatedWorkItems`) are already fire-and-forget — their promises are never returned into the chain — so they are not literally on the critical path today, but there is also no mechanism that waits for them, meaning nothing currently tracks true "all work finished" completion. Templates are fetched fresh via `VSS.require(["scripts/app"], ...)` and `getTemplates`/`getWorkItemTypeCategories` on every click; nothing is preloaded/cached at plugin load. The extension is instantiated per-invocation inside `toolbar.html`, loaded fresh via `VSS.require` when the toolbar/context-menu action fires — there's no persistent background context visible in this repo.

## Open Questions / Risks (for other gatherers, not answered here)
- Does the `toolbar.html` iframe (registered via `ms.vss-web.action` / `ms.vss-work-web.work-item-toolbar-menu` & `work-item-context-menu` contribution, `src/vss-extension.json:66-84`) survive if the Azure DevOps host closes the popup/panel that hosts it? This is a VSS-SDK/platform lifecycle question, out of scope for a codebase-only read — flag for the platform-lifecycle gatherer.
- Whether `VSS.require`/`VSS.init` (`src/toolbar.html:14,21`) create a new iframe/context per click or reuse one — also a platform question.
- Runtime resolution of the AMD module `"q"` (imported in `src/scripts/app.ts:8` as `import * as Q from "q"`) could not be confirmed from static inspection: `src/node_modules/vss-web-extension-sdk/lib/VSS.SDK.js` has no `define("q", ...)` registration (grep for `"q"` returned nothing), and `src/gruntfile.js`'s `copy:static` task (lines 35-51) only copies `VSS.SDK.min.js`, `toolbar.html`, `vss-extension.json`, `overview.md`, and `img/` into `../build` — it does **not** copy any `q.js` AMD module or bundle RequireJS itself into the shipped `.vsix`. There is no `src/node_modules/q` package (only `@types/q` for compile-time types) and no visible RequireJS `paths` config mapping `"q"` to a URL. How the compiled AMD `scripts/app.js` resolves the `"q"` dependency at runtime in the packaged extension is unclear from the code alone — flag as an open question (possibly it's silently broken today, or VSS.SDK.min.js bundles a `q` module not visible via grep in the unminified copy, or RequireJS's built-in support for CommonJS module IDs somehow satisfies it). This matters because any redesign of the async flow needs a promise primitive that's confirmed to work in this AMD sandbox — native `Promise`/`async`/`await` (ES2015+ target, `tsconfig.json:3`) may be a safer bet than continuing to depend on an unverified `q` resolution.

---

## 1. Entry Point: `toolbar.html`

**File**: `src/toolbar.html`

```html
<script src="lib/VSS.SDK.min.js"></script>
...
<script>
VSS.init();                                                    // line 14

var createChildTask = (function() {
    return {
        createTasks: function(actionContext) {
            VSS.require(["scripts/app"], function (app) {      // line 21
                app.create(actionContext);                     // line 23
            });
        },
        execute: function(actionContext) {
            this.createTasks(actionContext);                   // line 28
        }
    }
}());

VSS.register("create-linked-tasks-button-test", function (context) {   // line 34
    return createChildTask;
});
</script>
```

- `VSS.init()` — `src/toolbar.html:14`. Called unconditionally as soon as the `toolbar.html` document (the contribution's `uri`, see §3) loads/parses in whatever frame the host creates for it.
- `VSS.register(...)` — `src/toolbar.html:34`. Registers the `createChildTask` object as the implementation of the `create-linked-tasks-button-test` contribution ID (matches `registeredObjectId` in `vss-extension.json:81`) so the host can invoke `.execute(actionContext)` on it when the user clicks the toolbar/context-menu button.
- `execute(actionContext)` (line 27-29) is the actual host-invoked entry point → calls `createTasks(actionContext)` (line 19-25) → **first now** does `VSS.require(["scripts/app"], ...)` (line 21) to AMD-load the compiled `scripts/app.js` module, and only then calls `app.create(actionContext)` (line 23).
- **Nothing in `toolbar.html` is preloaded ahead of the click.** The `scripts/app` module is fetched/evaluated lazily inside the `execute` handler, i.e. the AMD module load itself happens after the user has already clicked "create" — this is one additional (currently synchronous-feeling, callback-based but not pre-warmed) round trip before any work-item REST calls even begin.
- `app.create(actionContext)` (line 23) is fire-and-forget from `toolbar.html`'s perspective — its return value (`void`, see §2) is never used, so there's no hook here to attach a "finished" callback or spinner-clearing logic without adding one.

---

## 2. `src/scripts/app.ts` — Full Call Graph

### 2.1 `create()` — the exported entry point

```ts
export function create(context: any): void {                 // line 611
    ctx = VSS.getWebContext();                                // line 615
    if (context.workItemIds && context.workItemIds.length > 0) {
        context.workItemIds.forEach(function (workItemId: number) {
            AddTasks(workItemId);                              // line 619 — fire-and-forget, no await/return
        });
    }
    else if (context.id) {
        AddTasks(context.id);                                  // line 623
    }
    else if (context.workItemId) {
        AddTasks(context.workItemId);                          // line 626
    }
}
```

- `create()` returns `void` (line 611) and never returns/awaits the promise chain started by `AddTasks`. There is **no signal anywhere** — to `toolbar.html`, to the host UI, or to the user — that creation has started, is in progress, or has finished. This is the root cause of "zero visual feedback."
- If `context.workItemIds` has multiple IDs (multi-select context-menu invocation), `AddTasks` is called once per ID in a plain `forEach` (line 617-620) — these per-work-item chains run **fully in parallel** already (no chaining between different `workItemId`s), since each call to `AddTasks` starts its own independent promise chain with no shared state (`justCreatedTasks` is declared fresh inside each `AddTasks` call, line 36).

### 2.2 `AddTasks(workItemId)` — per-parent-work-item orchestration

`src/scripts/app.ts:24-70`

```ts
function AddTasks(workItemId: number): void {
    var witClient = _WorkItemRestClient.getClient();           // line 25
    var workClient = workRestClient.getClient();                // line 26
    var team = { projectId: ctx.project.id, teamId: ctx.team.id }; // lines 31-34
    var justCreatedTasks: WorkItemContracts.WorkItem[] = [];    // line 36 — per-call accumulator

    workClient.getTeamSettings(team)                            // line 38 — REST call #1
        .then(function (teamSettings) {
            witClient.getWorkItem(workItemId)                   // line 41 — REST call #2 (nested inside .then of #1)
                .then(function (value) {
                    var currentWorkItem = value.fields;
                    currentWorkItem['System.Id'] = workItemId;
                    var workItemType = currentWorkItem["System.WorkItemType"];
                    GetChildTypes(witClient, workItemType, teamSettings)   // line 48 — REST call(s) #3 (nested)
                        .then(function (childTypes) {
                            if (childTypes == null) return;
                            getTemplates(childTypes)             // line 53 — REST call(s) #4 (nested)
                                .then(function (response) {
                                    if (response.length == 0) { console.log(...); return; }
                                    var templates = response.sort(SortTemplates);   // line 60
                                    var chain: Q.Promise<any> = Q.when();           // line 61
                                    templates.forEach(function (template) {
                                        chain = chain.then(createChildFromTemplate(witClient, workItemId, currentWorkItem, template, teamSettings, justCreatedTasks));  // line 63
                                    });
                                    return chain;
                                });
                        });
                })
        })
}
```

**Sequencing analysis (every step here is `.then`-nested, i.e. strictly sequential / awaited):**

| Step | Call | Line | Network round trip? | Could run in parallel with siblings? |
|---|---|---|---|---|
| 1 | `workClient.getTeamSettings(team)` | 38 | Yes | No — needed before step 3 (bugsBehavior) and step 5 (iteration path) |
| 2 | `witClient.getWorkItem(workItemId)` | 41 | Yes | **Yes** — does not depend on `teamSettings` result at all, only nested inside its `.then` by code structure. Could run concurrently with step 1 via `Q.all`/`Promise.all`. |
| 3 | `GetChildTypes(witClient, workItemType, teamSettings)` | 48 | Yes (1-2 REST calls, see §2.6) | No — needs `workItemType` (from step 2) and `teamSettings` (from step 1); genuine dependency |
| 4 | `getTemplates(childTypes)` | 53 | Yes (N REST calls, one per child type, already parallelized internally via `Q.all`, see §2.5) | No — needs `childTypes` from step 3 |
| 5 | Per-template loop: `chain.then(createChildFromTemplate(...))` | 61-65 | Yes (`getTemplate` + `createWorkItem`, one full round-trip pair per template) | **Conditionally** — see §2.7 analysis of `justCreatedTasks` dependency below |

**Key finding**: Steps 1 (`getTeamSettings`) and 2 (`getWorkItem`) are independent of each other but are coded as nested/sequential (`.then` inside `.then`), needlessly serializing two REST round trips that could run concurrently with `Q.all([workClient.getTeamSettings(team), witClient.getWorkItem(workItemId)])`.

### 2.3 `createChildFromTemplate` — per-template step in the chain

`src/scripts/app.ts:72-83`

```ts
function createChildFromTemplate(witClient, workItemId, currentWorkItem, template, teamSettings, justCreatedTasks) {
    return function () {
        return getTemplate(template.id).then(function (taskTemplate) {   // line 74 — REST call
            if (IsValidTemplateWIT(currentWorkItem, taskTemplate)) {
                if (IsValidTemplateTitle(currentWorkItem, taskTemplate)) {
                    return createWorkItem(workItemId, currentWorkItem, taskTemplate, teamSettings, justCreatedTasks)  // line 78
                }
            }
        });
    };
}
```

- This is the factory invoked once per template inside `AddTasks`'s `templates.forEach` loop (`app.ts:62-64`) and chained via `chain = chain.then(...)`. Each invocation does a `getTemplate(template.id)` REST call (line 74) — a full template-body fetch per template, even though `getTemplates` (§2.5) already fetched lightweight `WorkItemTemplateReference` objects. This is a second REST round trip per template that's on the critical path.
- Returns the promise from `createWorkItem(...)` (line 78) — i.e., `createWorkItem`'s resolution (which itself resolves only after the create-work-item REST call and its `.then` body finish, see §2.4) is what actually advances `chain` to the next template.

### 2.4 `createWorkItem` — the actual create + parent-link + same-batch-link logic

`src/scripts/app.ts:104-199`

```ts
function createWorkItem(workItemId, currentWorkItem, taskTemplate, teamSettings, justCreatedTasks) {
    var witClient = _WorkItemRestClient.getClient();                      // line 106
    var newWorkItem = createWorkItemFromTemplate(currentWorkItem, taskTemplate, teamSettings);  // line 108 — local/no network

    return witClient.createWorkItem(newWorkItem, VSS.getWebContext().project.name, taskTemplate.workItemTypeName)  // line 110 — REST call: THE actual "create task" call
        .then(function (response) {
            justCreatedTasks.push(response);                              // line 116 — mutates shared accumulator

            linkItems(witClient, workItemId, "System.LinkTypes.Hierarchy-Forward", response.url)  // line 120 — parent link; NOT returned/awaited (fire-and-forget)

            var jsonFilters = extractJSON(taskTemplate.description)[0];   // line 122
            if (IsJsonString(JSON.stringify(jsonFilters))) {
                if (jsonFilters.linkTo !== undefined && jsonFilters.linkTo.length > 0) {
                    jsonFilters.linkTo.forEach(function (linkTo: string) {
                        // ToAllOtherChilds / ToAllJustCreatedTasks / PreviouslyCreatedTask /
                        // PreviouslyJustCreatedTask / SecondPreviouslyJustCreatedTask /
                        // FirstJustCreatedTask / SecondJustCreatedTask handling, lines 130-186
                        // ALL of these call linkItems(...) (line 140, 150, 159, 167, 175, 183)
                        // WITHOUT returning/awaiting the promise — every linkItems call here
                        // is fire-and-forget, not chained back into `chain`.
                    });
                }
            }
        }, function (error) { /* console.log only, lines 189-198 */ });
}
```

**Critical finding — `createWorkItem`'s returned promise resolves as soon as its synchronous `.then` callback body finishes running** (i.e., once all the `linkItems(...)` calls have been *initiated*, not once they've *completed*, since none of their promises are `return`ed or awaited). This means:
- The per-template `chain` (in `AddTasks`) advances to the next template as soon as the current template's `createWorkItem` REST call responds and its synchronous link-dispatching code runs — it does **not** wait for any of the link REST calls to actually complete.
- `linkItems` calls (parent link at line 120, and all "linkTo" rule links at lines 140/150/159/167/175/183) are **already fire-and-forget** relative to the `chain` in `AddTasks` — they are not on the critical path that blocks moving to the next template or that blocks "done." However, there is currently **no aggregate promise that tracks when all of these fire-and-forget link calls have actually finished** — so "the last thing that happens" today is genuinely unbounded/untracked, which is relevant to designing a "still running in background" indicator.

### 2.5 `getTemplates` — already parallelized via `Q.all`

`src/scripts/app.ts:510-538`

```ts
function getTemplates(workItemTypes: string[]) {
    var requests: any[] = []
    var witClient = _WorkItemRestClient.getClient();
    workItemTypes.forEach(function (workItemType) {
        var request = witClient.getTemplates(ctx.project.id, ctx.team.id, workItemType);   // line 520
        requests.push(request);
    });
    return Q.all(requests)     // line 524 — parallel fan-out already
        .then(function (templateTypes) { /* flatten, lines 526-536 */ });
}
```
- One REST call per work-item-type category (line 520), fired concurrently and joined with `Q.all` (line 524). This part is already non-blocking/parallel internally — no change needed here.

### 2.6 `GetChildTypes` — mostly sequential, with one parallel fan-out

`src/scripts/app.ts:541-601`

- `witClient.getWorkItemTypeCategories(...)` (line 543) is the first, required REST call.
- Depending on `category.referenceName` (Epic/Feature/Requirement/Bug/Task, lines 559-583), it either does one more single chained call (Epic case, line 560) or pushes 1-3 requests into `requests[]` and joins them via `Q.all(requests)` (line 585) — this fan-out (Feature/Requirement/Bug/Task cases) is already parallel.
- Net: 1-2 sequential REST round trips (categories, then sub-category batch), unavoidable dependency chain since the second call needs the category result from the first.

### 2.7 Does `justCreatedTasks` impose a genuine cross-template ordering dependency?

`src/scripts/app.ts:36, 63, 116, 134-186`

- `justCreatedTasks` is a single array shared across the whole `AddTasks` call (declared once, line 36), pushed to inside every `createWorkItem` call (line 116) after each template's work item is created.
- The `linkTo` rules that read from it — `ToAllJustCreatedTasks` (134), `PreviouslyCreatedTask`/`PreviouslyJustCreatedTask` (144/153), `SecondPreviouslyJustCreatedTask` (162), `FirstJustCreatedTask` (170), `SecondJustCreatedTask` (178) — all read `justCreatedTasks` **at the moment `createWorkItem`'s `.then` callback runs for a given template**, i.e., after that template's own `createWorkItem` REST call has resolved and pushed itself onto the array (push happens at line 116, before any `linkTo` handling at line 122+).
- **This is a genuine, but partial, ordering dependency.** Any template whose description JSON contains a `linkTo` rule referencing `PreviouslyCreatedTask`, `FirstJustCreatedTask`, `SecondJustCreatedTask`, `SecondPreviouslyJustCreatedTask`, or `ToAllJustCreatedTasks` needs earlier templates' `createWorkItem` calls to have already resolved (so `justCreatedTasks` is populated) before its own `createWorkItem` fires — because `IsValidTemplateWIT`/creation happens per-template, and it's the **creation itself**, not just the link-dispatch, that populates the array in order. Since templates are processed in alphabetical-by-name order (`SortTemplates`, `app.ts:501-508`, applied at line 60), "previously created" / "first" / "second" are order-*and-position*-dependent on that alphabetical sequence.
- **However**, the code as currently written (`chain = chain.then(...)`, line 63) serializes **every** template unconditionally — including templates whose description has no `linkTo` rule at all, or whose `linkTo` rules only use `ToAllOtherChilds` (which queries the *parent's* existing relations via a separate `getWorkItem` call at line 88, not `justCreatedTasks`, so it has no same-batch ordering dependency). Those templates gain nothing from being serialized and are pure parallelization headroom.
- **Practical implication for the research question**: a genuinely safe concurrency-improving change cannot just blanket-parallelize all `createWorkItem` calls, because doing so would break the position-based semantics of `PreviouslyCreatedTask`/`FirstJustCreatedTask`/etc. (their correctness *depends on* earlier creates having already resolved and pushed to `justCreatedTasks` in alphabetical template order). A safe redesign would need to either (a) detect which templates' `linkTo` rules reference `justCreatedTasks`-derived rules and only serialize *those*, running everything else concurrently, or (b) keep the ordered/sequential create step (which is what actually determines correctness) but make the *linking* calls (already fire-and-forget) run without blocking a "done" indicator, and/or (c) show progress per-template as each resolves rather than trying to fully parallelize the ordered rule set.

---

## 3. `src/vss-extension.json` — Contribution Targets & Scopes

`src/vss-extension.json:66-84`

```json
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

- Contribution type is `ms.vss-web.action` (line 69) — an *action* contribution, not a persistent UI panel/hub. It targets both `ms.vss-work-web.work-item-toolbar-menu` (toolbar button on an open work item form) and `ms.vss-work-web.work-item-context-menu` (right-click context menu on work-item list rows, supports multi-select — explains the `context.workItemIds` array path in `create()`, `app.ts:616-621`).
- The `uri` (`toolbar.html`, line 80) is the iframe document the host loads to back this action; `registeredObjectId` (line 81) matches the ID passed to `VSS.register(...)` in `toolbar.html:34`.
- Scopes: `vso.work`, `vso.work_write` (lines 45-47) — read/write work-item REST access, no other scopes (no identity/graph scope beyond what's implied for `@me` resolution via `ctx.user.uniqueName`, `app.ts:271`, which comes from `VSS.getWebContext()` and needs no extra scope).
- **No `ms.vss-web.hub` or panel-with-persistent-lifecycle contribution exists in this manifest** — this extension is *only* registered as a menu action, which is consistent with it being invoked via a transient host-managed surface (toolbar button / context menu) rather than a dedicated always-open hub page. Whether that transient surface is a "popup panel" that can be closed while work continues, and what happens to its iframe/JS context on close, is a platform/lifecycle question this codebase read cannot answer (see Open Questions above).

---

## 4. Build & Packaging Confirmation — No Server Component

- `src/gruntfile.js:66` — `grunt.registerTask("build", ["clean:build", "exec:tsc", "copy:static"])`: compiles TypeScript (`tsc -p tsconfig.json`, line 4-8) and copies only static assets (line 35-51: `toolbar.html`, `vss-extension.json`, `overview.md`, `img/**`, `VSS.SDK.min.js`) into `../build`. No server-side code, no API routes, no backend build step anywhere in this file.
- `src/gruntfile.js:9-13,14-18` — `package_dev`/`package_release` tasks run `tfx extension create --root ../build ... --output-path ../dist`, producing a `.vsix` — confirms this ships as a pure static-file browser extension.
- `src/tsconfig.json:3-4` — `"target": "ES2015"`, `"module": "amd"` — confirms AMD module output (matches `VSS.require(["scripts/app"], ...)` usage in `toolbar.html:21`), and ES2015 target means native `Promise`/`async`/`await` are compile-target-safe if adopted (no need to stay on `Q` for language-level reasons).
- `src/package.json:14` — `"vss-web-extension-sdk": "^1.104.0"` is the semver range declared in `package.json`; the actually-installed/pinned version per `src/node_modules/vss-web-extension-sdk/package.json:3` is **1.110.0**.
- `src/package.json:13` — `"typescript": "^5.4.5"`.
- `src/package.json:3` — `"@types/q": "^1.5.8"` (type-only dependency); `app.ts:8` does `import * as Q from "q"` and uses `Q.when()` (line 61) and `Q.all(...)` (lines 524, 585) as the promise library throughout. See the Open Questions section above regarding unresolved runtime AMD module resolution of `"q"` — no runtime `q` package or bundled `q` AMD module was found copied into `../build` by `copy:static` (`gruntfile.js:35-51`), and no `define("q", ...)` registration was found via grep in `vss-web-extension-sdk/lib/VSS.SDK.js`.
- `src/configs/dev.json` and `src/configs/release.json` — only override `public`/`name`/`id` fields for packaging; neither adds any server/runtime configuration relevant to async behavior.

---

## Summary Table: Network Round Trips Per `AddTasks(workItemId)` Invocation

| # | Call | File:Line | Awaited/blocking? | User feedback shown? |
|---|---|---|---|---|
| 0 | AMD load of `scripts/app` module | `toolbar.html:21` | Yes (callback-gated) | No |
| 1 | `workClient.getTeamSettings(team)` | `app.ts:38` | Yes | No |
| 2 | `witClient.getWorkItem(workItemId)` | `app.ts:41` | Yes (nested after #1, though independent of it) | No |
| 3 | `witClient.getWorkItemTypeCategories(...)` (+ 0-2 more, parallel) | `app.ts:543` (`GetChildTypes`) | Yes | No |
| 4 | `witClient.getTemplates(...)` × N types (parallel via `Q.all`) | `app.ts:520` (`getTemplates`) | Yes | No |
| 5a | `witClient.getTemplate(template.id)` × per template | `app.ts:74` (`getTemplate`, via `createChildFromTemplate`) | Yes, sequential across templates | No |
| 5b | `witClient.createWorkItem(...)` × per template | `app.ts:110` | Yes, sequential across templates (see §2.7 for why) | No |
| 6a | `witClient.updateWorkItem(...)` for parent link | `app.ts:120` → `linkItems` at line 217 | No — fire-and-forget | No |
| 6b | `witClient.updateWorkItem(...)` for each `linkTo` rule match | `app.ts:140/150/159/167/175/183` → `linkItems` at line 217 | No — fire-and-forget | No |
| 6c | `witClient.getWorkItem(...)` for `ToAllOtherChilds` rule | `app.ts:88` (`getRelatedWorkItems`) | No — fire-and-forget from `createWorkItem`'s perspective | No |

No step in this entire flow produces any DOM update, spinner, disabled state, or console-visible-to-user feedback — every `console.log`/`console.error` call in the file (throughout, e.g. lines 56, 112-115, 190-197) goes only to the devtools console, not the UI.
