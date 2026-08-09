# Codebase Findings: `app.js` Structure Inventory

## TL;DR
`src/scripts/app.js` is a single AMD module (`define([...7 deps], function(...) {...})`, `app.js:1-2` to `app.js:618`) exposing one public method (`create`, `app.js:597-614`) and 24 internal functions, built around one piece of module-level mutable state (`var ctx = null`, `app.js:4`) and deeply nested Q `.then()` chains (4 levels deep in `AddTasks`, `app.js:17-48`). Three of the seven AMD-declared dependencies (`Controls`, `StatusIndicator`, `Dialogs`) are imported but never referenced in the file body — dead imports. The global `VSS` object (from `VSS.SDK.min.js`, loaded via `<script>` in `toolbar.html:8`, not via `define()`) is called directly 12 times without being a declared AMD dependency, so TS will need an ambient `declare const VSS: ...` rather than a normal import. Two implicit-global bugs exist (`app.js:459`, `app.js:526`) that `strict` TS/lint would surface immediately. The Grunt pipeline (`gruntfile.js`) has no compile step at all today — it only copies the vendored SDK, cleans `dist/*.vsix`, and shells out to `tfx-cli` (`gruntfile.js:3-24`) — so a TS build step must be inserted as a new task ahead of `exec:package_dev`/`exec:package_release`. `toolbar.html` loads `app.js` exclusively through `VSS.require(["scripts/app"], ...)` (`toolbar.html:21`), an AMD-style dynamic import resolved by the VSS SDK's RequireJS runtime — post-compilation output must still be an AMD `define()` module at the same `scripts/app.js` path for this to keep working.

## Key Decisions
- **Treat `VSS` as an ambient global, not an AMD import.** It is used at `app.js:89,512,529,536,538,541,542,544,547,549,551,601` but is absent from the `define([...])` dependency array (`app.js:1`) — it comes from the `<script src="lib/VSS.SDK.min.js">` tag in `toolbar.html:8`, which patches `window.VSS`/global RequireJS config directly, not from an AMD module load. Typing this requires a hand-written `declare const VSS: {...}` (or `declare global`) covering at minimum `VSS.getWebContext()` and (per `toolbar.html`) `VSS.init()`, `VSS.require()`, `VSS.register()`.
- **Drop or keep-but-flag the 3 unused AMD deps** (`Controls`, `StatusIndicator`, `Dialogs`, params in `app.js:2`) — grep confirms zero usages of `Controls.`, `StatusIndicator.`, or `Dialogs.` anywhere in the file body (only `VSS.` calls matched). These add typing surface for zero benefit; synthesis should flag as candidates to drop during the port rather than type.
- **The output must stay AMD `define()`-shaped post-compile** — `toolbar.html:21` calls `VSS.require(["scripts/app"], function (app) { app.create(actionContext); })`, i.e. VSS's own RequireJS loader resolves the module by path/id at runtime. TS's `module: "amd"` compiler target (or a `.d.ts`-only type-check with output left as `allowJs`-transpiled AMD) satisfies this without restructuring the loader.
- **Two implicit-global bugs will surface as compiler/lint errors during migration**: `for (category of categories)` at `app.js:459` (missing `let`/`const`— `category` leaks as an implicit global in non-strict mode) and `bugsBehavior = workClient.getTeamSettings(team).bugsBehavior;` at `app.js:526` (no declaration, and note `getTeamSettings()` returns a promise here but is used synchronously — likely a second latent bug, `.bugsBehavior` would be `undefined` on the promise object, not the resolved value). These are worth listing as concrete pre-existing bugs a TS `strict` pass will force fixing, not regressions introduced by migration.
- **`getWorkItemFormService` (`app.js:572-576`) is dead code** — defined but never called anywhere else in `app.js` (confirmed via grep for the identifier). It also has a synchronous-return-of-async-value bug (declares `let service`, assigns it inside a `.then()` callback that resolves later, then `return service` runs before the promise settles, returning `undefined`). Candidate for deletion rather than typing.

## Open Questions / Risks
- **`Q` typing scope**: `Q` is AMD-imported (`app.js:1-2`, param name `Q`) and used via `Q.when()` (`app.js:40`) and `Q.all()` (`app.js:493`, `app.js:554`) in addition to instance `.then(onFulfilled, onRejected)` calls (two-argument form at `app.js:166-176` and `app.js:193-203`, i.e. `.then(successFn, errorFn)` rather than `.then().catch()`). Any typing approach must cover both the `Q` static namespace and instance promise shape — `@types/q` (external research) should be checked against this exact usage, not just chained `.then()`.
- **`findWorkTypeCategory` return path**: `app.js:458-465` has no `return` for the not-found case — falls through to implicit `undefined`. TS will require this to be reflected in the return type (`Category | undefined`) rather than left implicit.
- **Confidence on "no other file loads app.js differently"**: only `toolbar.html` was checked for the load mechanism (per assigned scope). If other `.html`/contribution entry points exist in `vss-extension.json` beyond the one contribution seen, they weren't checked here — configuration gatherer's territory, flagging for cross-check in synthesis.

---

## 1. Function Inventory (`src/scripts/app.js`)

All functions are declared inside the `define()` factory function body (module-private scope), except the single object literal returned at the bottom (`app.js:595-616`), which is the module's public API.

| Function | Signature | Lines | Purpose |
|---|---|---|---|
| `AddTasks` | `(workItemId)` | `app.js:6-49` | Orchestrates the whole "create child tasks from templates" flow for one work item: fetches team settings, the parent work item, its valid child types, matching templates, sorts them, and chains sequential creation via `createChildFromTemplate`. |
| `createChildFromTemplate` | `(witClient, workItemId, currentWorkItem, template, teamSettings, justCreatedTasks)` → returns a thunk `() => Promise` | `app.js:51-62` | Curried factory: returns a zero-arg function (used to build a sequential Q `.then()` chain in `AddTasks:41-43`) that fetches one template's full detail and, if it passes both validity checks, creates the work item. |
| `getRelatedWorkItems` | `(witClient, workItemId, relationTypeToFilter, itemToLinkTo, relationTypeToLinkAs)` | `app.js:64-81` | Fetches a work item with relations expanded (`workItemExpand = 1`, `app.js:66`), filters relations by `rel` type, and links each matching related item to `itemToLinkTo` via `linkImtes`. |
| `createWorkItem` | `(workItemId, currentWorkItem, taskTemplate, teamSettings, justCreatedTasks)` | `app.js:83-177` | Builds a JSON-Patch document from the template (`createWorkItemFromTemplate`), POSTs it via `witClient.createWorkItem`, then on success: records the created item, links it to its parent, parses `taskTemplate.description` as JSON for a `linkTo` directive, and dispatches to one of 6 linking strategies (`ToAllOtherChilds`, `ToAllJustCreatedTasks`, `PreviouslyCreatedTask`, `PreviouslyJustCreatedTask`, `SecondPreviouslyJustCreatedTask`, `FirstJustCreatedTask`, `SecondJustCreatedTask` — 7 string literals compared via `.toUpperCase()`, `app.js:109-162`). Uses two-callback `.then(success, error)` form (`app.js:90-176`). |
| `linkImtes` *(sic — typo for "linkItems", used consistently)* | `(witClient, newWorkItemId, relType, existedItemUrl)` | `app.js:179-204` | Builds a single-op JSON-Patch add-relation document and calls `witClient.updateWorkItem`. Two-callback `.then(success, error)` form. |
| `createWorkItemFromTemplate` | `(currentWorkItem, taskTemplate, teamSettings)` | `app.js:206-256` | Pure(ish) transform: builds a JSON-Patch array from `taskTemplate.fields`, applying `IsPropertyValid` filtering, `{parentField}` substitution (`replaceReferenceToParentField`), and special-case defaults for `System.Title`, `System.AreaPath`, `System.IterationPath` (incl. `@currentiteration` → `teamSettings.backlogIteration/defaultIteration`), and `System.AssignedTo` (`@me` → `ctx.user.uniqueName`, reads module-level `ctx`). |
| `checkRules` | `(rules, currentWorkItem)` | `app.js:258-274` | Coerces `rules` to an array if not already one, then returns `true` if *any* rule object has *every* one of its filter properties match via `matchField`. |
| `IsValidTemplateWIT` | `(currentWorkItem, taskTemplate)` | `app.js:276-326` | Validates whether a template applies to the current work item's type. Supports two description formats: (a) JSON `{applywhen: [...], notapplywhen: [...]}` evaluated via `checkRules`, or (b) legacy square-bracket `[Type1,Type2]` syntax matched via regex + case-insensitive string compare against `System.WorkItemType`. |
| `matchField` | `(fieldName, currentWorkItem, filterObject)` | `app.js:328-362` | Compares one field: coerces both the filter value and the work item's current value to arrays (special-cases `System.Tags` splitting on `"; "`), then checks case-insensitive intersection. Wrapped in try/catch, logs via `WriteError` on exception. |
| `IsValidTemplateTitle` | `(currentWorkItem, taskTemplate)` | `app.js:364-388` | Validates title-based filter tokens `{token}` in `taskTemplate.description` against tokens present in `currentWorkItem["System.Title"]`; JSON-format templates always pass (title filtering superseded by JSON `applywhen`). |
| `extractJSON` | `(str)` | `app.js:390-417` | Hand-rolled brace-matching JSON extractor: scans for the first `{`, then tries progressively smaller substrings ending at each `}` from the last backward, `JSON.parse`-ing candidates until one succeeds. Returns `[parsedObject, startIndex, endIndex]` or `null`/`''`. Used to pull an embedded JSON filter object out of a work item template's `description` HTML/text field. |
| `IsJsonString` | `(str)` | `app.js:419-426` | `try { JSON.parse(str) } catch { return false }` guard. |
| `IsPropertyValid` | `(taskTemplate, key)` | `app.js:428-443` | Filters out fields that shouldn't be copied verbatim from the template: not own-property, `System.Tags`-containing keys (tags unsupported), and `@me`/`@currentiteration` placeholder values (handled specially elsewhere). |
| `replaceReferenceToParentField` | `(fieldValue, currentWorkItem)` | `app.js:445-456` | Replaces `{ParentFieldName}` tokens inside a template field's value string with the corresponding value from `currentWorkItem`. |
| `findWorkTypeCategory` | `(categories, workItemType)` | `app.js:458-465` | Linear search of `categories[].workItemTypes[]` for a matching `.name`; returns the owning category or `undefined` (no explicit `return` on the not-found path). **Bug**: `for (category of categories)` at `app.js:459` omits `let`/`const`. |
| `getTemplate` | `(id)` | `app.js:467-470` | Fetches one work item template by id: `witClient.getTemplate(ctx.project.id, ctx.team.id, id)` — reads module-level `ctx`. |
| `SortTemplates` | `(a, b)` | `app.js:473-480` | Standard `Array.prototype.sort` comparator, case-insensitive on `.name`. |
| `getTemplates` | `(workItemTypes)` | `app.js:482-507` | For each work item type string, requests `witClient.getTemplates(ctx.project.id, ctx.team.id, workItemType)` (reads `ctx`), issues all requests in parallel via `Q.all`, then flattens the per-type template arrays into one array. |
| `GetChildTypes` | `(witClient, workItemType)` | `app.js:510-570` | The category-tree walk: fetches work item type categories for the project, finds the category containing `workItemType`, then — depending on which of 5 known category reference names it is (`Microsoft.EpicCategory`, `.FeatureCategory`, `.RequirementCategory`, `.BugCategory`, `.TaskCategory`) and the team's `bugsBehavior` setting (`Off`/`AsTasks`/`AsRequirements`) — determines the applicable child category/categories and returns their work item type names. Deepest/most complex branching logic in the file. **Bug**: `bugsBehavior = ...` at `app.js:526` has no declaration (implicit global) and reads `.bugsBehavior` directly off what `getTeamSettings()` returns without awaiting/`.then()` — likely reads a property off a pending promise, not the resolved settings object. |
| `getWorkItemFormService` | `()` | `app.js:572-576` | Calls `_WorkItemServices.WorkItemFormService.getService().then(...)`, assigning to outer `let service` inside the callback, then returns `service` synchronously (before the promise resolves — returns `undefined`). **Dead code**: not called anywhere else in the file. |
| `Log` | `(msg)` | `app.js:578-580` | `console.log('linked-tasks-automation: ' + msg)`. |
| `WriteTrace` | `(msg)` | `app.js:582-584` | Identical body to `Log` — `console.log('linked-tasks-automation: ' + msg)`. |
| `WriteLog` | `(msg)` | `app.js:586-588` | Identical body to `Log`/`WriteTrace` — `console.log('linked-tasks-automation: ' + msg)`. |
| `WriteError` | `(msg)` | `app.js:590-592` | `console.error('linked-tasks-automation: ' + msg)` — the only one of the four that differs (uses `console.error`, not `.log`). |
| *(public)* `create` | `(context)` | `app.js:597-614` | The module's sole exported entry point (returned in the object literal at `app.js:595-616`). Logs init, sets module-level `ctx = VSS.getWebContext()` (`app.js:601`), then dispatches to `AddTasks` once per id in `context.workItemIds[]`, or once for `context.id`, or once for `context.workItemId` — three different shapes of the `context` parameter are handled as alternatives. |

**Logging functions note**: `Log`, `WriteTrace`, and `WriteLog` (`app.js:578-588`) are byte-for-byte identical implementations — three names for one behavior. `WriteError` is the only functionally distinct one. This matches roadmap.md's noted task to "consolidate the 4 logging functions" — trivial to collapse into one leveled `log(level, msg)` function during the TS port.

---

## 2. AMD Dependency List and VSS SDK Mapping

Declaration at `app.js:1-2`:

```js
define(["TFS/WorkItemTracking/Services", "TFS/WorkItemTracking/RestClient", "TFS/Work/RestClient", "q", "VSS/Controls", "VSS/Controls/StatusIndicator", "VSS/Controls/Dialogs"],
    function (_WorkItemServices, _WorkItemRestClient, workRestClient, Q, Controls, StatusIndicator, Dialogs) {
```

| Position | AMD module id | Bound param name | Used in file? | Where used |
|---|---|---|---|---|
| 1 | `TFS/WorkItemTracking/Services` | `_WorkItemServices` | Yes | `_WorkItemServices.WorkItemFormService.getService()` — `app.js:574` (inside dead-code `getWorkItemFormService`, so effectively unexercised at runtime) |
| 2 | `TFS/WorkItemTracking/RestClient` | `_WorkItemRestClient` | Yes (heavily) | `.getClient()` called at `app.js:7, 85, 468, 485` → yields `witClient`, used throughout for `getWorkItem`, `createWorkItem`, `updateWorkItem`, `getTemplate`, `getTemplates`, `getWorkItemTypeCategories`, `getWorkItemTypeCategory` |
| 3 | `TFS/Work/RestClient` | `workRestClient` | Yes | `.getClient()` at `app.js:8, 519` → yields `workClient`, used for `getTeamSettings(team)` (`app.js:17, 526`) |
| 4 | `q` | `Q` | Yes | `Q.when()` (`app.js:40`), `Q.all()` (`app.js:493, 554`) |
| 5 | `VSS/Controls` | `Controls` | **No** — zero references found | dead import |
| 6 | `VSS/Controls/StatusIndicator` | `StatusIndicator` | **No** — zero references found | dead import |
| 7 | `VSS/Controls/Dialogs` | `Dialogs` | **No** — zero references found | dead import |

**Global (non-AMD) SDK usage**: `VSS` itself is called directly as a global at `app.js:89, 512, 529, 536, 538, 541, 542, 544, 547, 549, 551, 601` (all `VSS.getWebContext()` except `601` which assigns it to `ctx`). It is *not* in the `define([...])` array — it's supplied globally by `<script src="lib/VSS.SDK.min.js">` in `toolbar.html:8`, which also calls `VSS.init()`, `VSS.require()`, and `VSS.register()` (`toolbar.html:14, 21, 34`). For TypeScript this needs an ambient global declaration (`declare const VSS: ...` or a `.d.ts` with `declare global { const VSS: ... }`), separate from whatever typings cover the AMD-imported `TFS/*`/`VSS/*` modules.

---

## 3. Module-Level Mutable State

- `var ctx = null;` — `app.js:4`. The only module-level (closure-scoped) mutable variable. Assigned once, at `app.js:601` (`ctx = VSS.getWebContext();`), inside the public `create()` entry point. Read in three places: `app.js:11-12` (`AddTasks`, builds `{projectId: ctx.project.id, teamId: ctx.team.id}`), `app.js:245` (`createWorkItemFromTemplate`, reads `ctx.user.uniqueName` for `@me` substitution), `app.js:469` (`getTemplate`, reads `ctx.project.id`/`ctx.team.id`), `app.js:489, 521-523` (`getTemplates`/`GetChildTypes`, same project/team id pattern).
- Two **implicit** module-scope leaks caused by missing declarations (not intentional state, but relevant to typing/strict-mode readiness): `category` at `app.js:459` (`for (category of categories)`) and `bugsBehavior` at `app.js:526`. Under `"use strict"` or TS's implicit strict parsing these would be compile errors, not silent globals — a concrete example of a pre-existing bug that migration will force a decision on.
- The `context` variable shape passed into `create(context)` (`app.js:597`) is itself effectively read-only external state per call, not module state, but is worth flagging here since it drives which of 3 shapes (`workItemIds: string[]`, `id`, `workItemId`) trigger `AddTasks` — see §5 below for the type-shape implication.

---

## 4. Q Promise `.then()` Chain Shapes

15 `.then()` call sites plus 2 `Q.all()` and 1 `Q.when()` call. The deepest and most structurally significant chain is in `AddTasks`:

**`AddTasks` — 4 levels of nested `.then()` (`app.js:17-48`)**:
```
workClient.getTeamSettings(team)                         // app.js:17
  .then(teamSettings =>
    witClient.getWorkItem(workItemId)                     // app.js:20
      .then(value =>
        GetChildTypes(witClient, workItemType)             // app.js:27
          .then(childTypes =>
            getTemplates(childTypes)                        // app.js:32
              .then(response => {
                 // sort + build a *sequential* chain via reduce-like forEach:
                 var chain = Q.when();                       // app.js:40
                 templates.forEach(t => {
                   chain = chain.then(createChildFromTemplate(...));  // app.js:42
                 });
                 return chain;
              })
          )
      )
  )
```
Notable: this is **nested callback pyramid**, not linear chaining — each `.then()` is called on the result of the *previous* async call from *inside* its own callback, rather than `return`ed and chained flat. None of the outer promises (`getTeamSettings`, `getWorkItem`, `GetChildTypes` at this call site) have their results `return`ed to the outer `.then()`, so `AddTasks` itself does not return a promise — the whole chain is fire-and-forget from the caller's perspective (`create()` at `app.js:603-613` does not await `AddTasks()`). No `.catch()` or error-callback anywhere in this chain — any rejection is silently swallowed.

**Other chain shapes**:
- `createChildFromTemplate` (`app.js:51-62`): single `.then()`, returned as part of a thunk consumed by the sequential-chain pattern above.
- `createWorkItem` (`app.js:83-177`): single `.then(onSuccess, onError)` — **two-argument form** (success + error callback, not `.then().catch()`), `app.js:90` opens, error callback at `app.js:166-176`.
- `linkImtes` (`app.js:179-204`): same two-argument `.then(onSuccess, onError)` shape, `app.js:192-203`.
- `getRelatedWorkItems` (`app.js:64-81`): single `.then()`, no error callback (`app.js:67-80`).
- `getTemplates` (`app.js:482-507`): `Q.all(requests).then(...)` — fan-out/fan-in pattern, `app.js:493-506`.
- `GetChildTypes` (`app.js:510-570`): outer `.then()` (`app.js:513`) containing a conditional branch that either returns a nested single `.then()` (`app.js:529-534`, for the Epic case) or builds up a `requests` array and does a second `Q.all(requests).then(...)` (`app.js:554-565`) — i.e., one function contains two different fan-out shapes depending on category.
- `getWorkItemFormService` (`app.js:572-576`): single `.then()` used only to (buggily) assign to an outer variable — see §1/dead-code note.

**Typing implication**: the mix of (a) single-callback `.then(fn)`, (b) two-callback `.then(onSuccess, onError)`, and (c) `Q.all()`/`Q.when()` fan-out/sequencing means `@types/q` needs to cover all three `Q` API shapes, and the deeply-nested untyped callback parameters (`teamSettings`, `value`, `childTypes`, `response`, etc. in `AddTasks`) are exactly where explicit interfaces (§5) will have the most payoff for catching mistakes.

---

## 5. Implicit Data Shapes Needing Explicit Types

None of these shapes are declared anywhere in the file (no JSDoc `@typedef`s present) — they exist only as implicit object-literal/consumption patterns. Candidate interfaces for the TS port:

1. **`Team` / team-context shape** — built ad hoc twice, identically, at `app.js:10-13` and `app.js:521-524`:
   ```js
   { projectId: ctx.project.id, teamId: ctx.team.id }
   ```
   Candidate: `interface TeamRef { projectId: string; teamId: string }`.

2. **`ctx` (VSS web context)** — module-level state (§3). Fields observed in use: `ctx.project.id` (`app.js:11, 469, 489, 522`), `ctx.team.id` (`app.js:12, 469, 489, 523`), `ctx.user.uniqueName` (`app.js:245`). This is the SDK's `WebContext` shape — likely already covered by any VSS SDK type package (external research territory) rather than hand-rolled, but the *subset actually used* is small (project.id, team.id, user.uniqueName).

3. **Work item ("currentWorkItem") field-bag** — accessed via bracket notation throughout (`currentWorkItem['System.Id']` `app.js:24`, `currentWorkItem["System.WorkItemType"]` `app.js:26, 315`, `currentWorkItem["System.Title"]` `app.js:229, 371`, `currentWorkItem["System.AreaPath"]` `app.js:233`, `currentWorkItem["System.IterationPath"]` `app.js:238-240`, `currentWorkItem['System.AssignedTo']` `app.js:245`, arbitrary `currentWorkItem[fieldName]` in `matchField` `app.js:330-347`). This is a `Record<string, string>`-shaped field bag keyed by TFS field reference names, not a fixed interface — best modeled as `type WorkItemFields = Record<string, string> & { 'System.Id': string; 'System.WorkItemType': string; ... }` or similar index-signature type rather than a closed interface, since `IsPropertyValid`/`matchField` iterate arbitrary keys (`app.js:209, 264`).

4. **Task template shape (`taskTemplate` / template REST objects)** — fields observed: `.id` (`app.js:53`), `.name` (`app.js:278, 474`), `.description` (`app.js:281, 310, 365, 370`), `.fields` (an object, itself keyed like the work item field bag: `app.js:209, 212, 218, 228, 232, 237, 239, 243-244, 428-438`), `.workItemTypeName` (`app.js:89`). Candidate: `interface WorkItemTemplate { id: string; name: string; description: string; fields: Record<string, string>; workItemTypeName: string }`.

5. **Filter-rule JSON embedded in `taskTemplate.description`** — two competing formats parsed at runtime, both worth modeling as discriminated shapes:
   - JSON format (documented via inline comment at `app.js:283-299`): `{ applywhen?: FilterRule[] | FilterRule, notapplywhen?: FilterRule[] | FilterRule }` where `FilterRule = { [fieldRefName: string]: string | string[] }` (e.g. `"System.State": "Approved"`, `"System.Tags": ["Blah","ClickMe"]` — `app.js:288-296`). Also a separate `linkTo` key observed only in `createWorkItem` (`app.js:101-165`): `{ linkTo?: string[] }` with 7 recognized string-literal values (`ToAllOtherChilds`, `ToAllJustCreatedTasks`, `PreviouslyCreatedTask`, `PreviouslyJustCreatedTask`, `SecondPreviouslyJustCreatedTask`, `FirstJustCreatedTask`, `SecondJustCreatedTask` — case-insensitive compare, `app.js:109-161`) — good candidate for a TS string-literal union type.
   - Legacy square-bracket format: `description` containing `[Type1,Type2]` tokens, parsed via regex (`app.js:310, 446`) rather than JSON — no object shape, just string parsing; not typeable beyond `string`.
   - Combined: `extractJSON`'s return shape itself, `[parsedObject, startIndex, endIndex] | null | ''` (`app.js:390-417`), is an inconsistent return type (tuple vs. null vs. empty string) that TS will force to be reconciled (e.g. `[unknown, number, number] | null`).

6. **`teamSettings`** (from `workClient.getTeamSettings(team)`, `app.js:17-18, 526`) — fields used: `.bugsBehavior` (`app.js:526`, string enum-like: `'Off' | 'AsTasks' | 'AsRequirements'` per usage at `app.js:537, 543`), `.backlogIteration.name` and `.defaultIteration.path` (`app.js:240`). Likely covered by VSS SDK's own `TeamSettings` type if a package exists; otherwise a minimal hand-rolled interface covering just these 3 fields.

7. **Category shape** (from `witClient.getWorkItemTypeCategories`/`getWorkItemTypeCategory`) — `.referenceName` (string, compared against 5 literal values `app.js:528, 535, 540, 546, 548, 550` — union-type candidate), `.workItemTypes[]` each with `.name` (`app.js:460, 533, 561`).

8. **`context` parameter of the public `create(context)`** (`app.js:597-613`) — three mutually-exclusive shapes handled: `{ workItemIds: string[] }` (`app.js:602-607`), `{ id: string }` (`app.js:608-609`), `{ workItemId: string }` (`app.js:611-612`). Candidate: a union type `type CreateContext = { workItemIds: string[] } | { id: string } | { workItemId: string }`, or (more likely, since these look like different VSS action-context shapes from different toolbar/menu contribution points) three separate documented call shapes — worth flagging to synthesis as a possible external-VSS-SDK-typed shape (`IWorkItemFormActionsContext`-style) rather than hand-rolled.

---

## 6. VSS SDK Surface Actually Used

Confirmed via full-file read + grep, restricted to `app.js` only (not the vendored `VSS.SDK.min.js`, which was out of scope per sources.md):

| Module / global | Access pattern | Methods called | Call sites |
|---|---|---|---|
| `TFS/WorkItemTracking/RestClient` (AMD dep, `_WorkItemRestClient`) | `.getClient()` → `witClient` | `getWorkItem(id[, ...expand])`, `createWorkItem(patchDoc, projectName, typeName)`, `updateWorkItem(patchDoc, id)`, `getTemplate(projectId, teamId, id)`, `getTemplates(projectId, teamId, workItemType)`, `getWorkItemTypeCategories(projectName)`, `getWorkItemTypeCategory(projectName, categoryRefName)` | `app.js:7,20,67,85,89,179,192,468,469,485,489,512,529,536,538,541,542,544,547,549,551` |
| `TFS/Work/RestClient` (AMD dep, `workRestClient`) | `.getClient()` → `workClient` | `getTeamSettings(team)` | `app.js:8,17,519,526` |
| `TFS/WorkItemTracking/Services` (AMD dep, `_WorkItemServices`) | direct | `WorkItemFormService.getService()` | `app.js:574` (dead-code path only, §1) |
| `q` (AMD dep, `Q`) | direct | `Q.when()`, `Q.all()`, instance `.then()` | see §4 |
| `VSS/Controls`, `VSS/Controls/StatusIndicator`, `VSS/Controls/Dialogs` (AMD deps) | — | **none — unused** | — |
| `VSS` (global, not AMD) | direct | `getWebContext()` | `app.js:89,512,529,536,538,541,542,544,547,549,551,601` |
| `VSS` (global, used only in `toolbar.html`, not `app.js`) | direct | `init()`, `require()`, `register()` | `toolbar.html:14,21,34` |

**Summary for external-typing research**: the *actually-exercised* SDK surface is narrow — 7 REST client methods across 2 clients, 1 service getter (dead code), `Q`'s 2 static + instance `.then`, and `VSS.getWebContext()` + 3 bootstrap calls. Any typing solution (DefinitelyTyped package vs. hand-rolled `.d.ts`) only needs to cover this surface, not the full SDK — relevant to the external gatherer's "hand-roll minimal `.d.ts`" fallback-viability assessment.

---

## 7. Build Pipeline (`src/gruntfile.js`, 52 lines)

- **No compile/transpile step exists today.** The entire `exec` config (`gruntfile.js:3-24`) only shells out to `tfx-cli` for packaging/publishing; `copy` (`gruntfile.js:25-35`) vendors `node_modules/vss-web-extension-sdk/lib/VSS.SDK.min.js` → `lib/VSS.SDK.min.js`; `clean` (`gruntfile.js:37`) removes `../dist/*.vsix`. There is nothing that touches `src/scripts/app.js` at all — it's packaged as-is by `tfx extension create`.
- **Task graph** (`gruntfile.js:46-51`): `package-dev` → `[exec:package_dev]`; `package-release` → `[exec:package_release]`; `publish-dev` → `["package-dev", "exec:publish_dev"]`; `publish-release` → `["package-release", "exec:publish_release"]`; `default` → `["package-dev"]`.
- **Where a TS step slots in**: a new task (e.g. `exec:tsc` reusing the already-present `grunt-exec` plugin, or a dedicated `ts` task if a Grunt-TS plugin is added) must run and be registered as a prerequisite *before* `exec:package_dev`/`exec:package_release` in both the `package-dev` and `package-release` task-array definitions (`gruntfile.js:46-47`), so that `tfx extension create` picks up compiled `.js` output rather than raw `.ts` source. `vss-extension.json`'s `files[]` entry for `scripts/app.js` (per sources.md) must continue to resolve to a real `.js` file at that exact path post-compile — i.e., `tsconfig.json` `outDir`/`outFile` must target `scripts/app.js` in place, or the manifest must be updated to point at wherever `tsc` emits.
- **`package.json` devDependencies with no `typescript`/`@types/*`/`q` entries** was independently confirmed in sources.md (`src/package.json`) — not re-verified here (out of this gatherer's assigned scope; configuration gatherer's territory) but consistent with what's observed in `app.js`/`gruntfile.js`: nothing here assumes TS tooling exists yet.

## 8. Script Loading / RequireJS Entry Point (`src/toolbar.html`, 42 lines)

- `toolbar.html:8` — `<script src="lib/VSS.SDK.min.js"></script>` loads the vendored SDK (copied by Grunt's `copy` task) as a plain global script, *before* any AMD module resolution happens. This is what defines the global `VSS` object used in `app.js`.
- `toolbar.html:14` — `VSS.init()` bootstraps the SDK/RequireJS-compatible loader.
- `toolbar.html:16-32` — defines an inline `createChildTask` object whose `createTasks(actionContext)` method calls `VSS.require(["scripts/app"], function (app) { app.create(actionContext); })` (`toolbar.html:21-24`). This is the **only** place `app.js` is loaded — dynamically, by AMD module id `"scripts/app"`, resolved relative to the extension's base path at runtime by VSS's RequireJS-based loader. It expects `scripts/app.js` (or `scripts/app`) to resolve to a script that calls `define([...], function(...) {...})` and exposes `{ create: function(context) {...} }` — i.e., the exact shape `app.js:1` and `app.js:595-616` currently produce.
- `toolbar.html:34-36` — `VSS.register("create-linked-tasks-button", function (context) { return createChildTask; })` registers the contribution matching the `create-linked-tasks-button` id noted in sources.md's `vss-extension.json` summary.
- **Migration constraint confirmed**: because loading is via `VSS.require(["scripts/app"], ...)` — not a bundler import, not a `<script>` tag pointing at a specific typed entry — any TS compile output must (a) still be named/pathed `scripts/app.js` (or the manifest/HTML updated in lockstep), and (b) still emit an AMD `define()` call (TS's `--module amd` compiler option produces exactly this), and (c) still return an object with a `create(context)` method as its module export. No changes needed to `toolbar.html` itself as long as those three hold.
