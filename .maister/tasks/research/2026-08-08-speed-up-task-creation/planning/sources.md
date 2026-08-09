# Research Sources

## Codebase Sources

### Key Files (verified to exist; entire runtime logic surface)
- `src/scripts/app.ts` — All extension logic: `create()` entry point, `AddTasks()` orchestration, `GetChildTypes()`, `getTemplates()`/`getTemplate()`, `createChildFromTemplate()`, `createWorkItem()`, `linkItems()`, filter/rule evaluation (`IsValidTemplateWIT`, `checkRules`, `matchField`). Single strictly-sequential `Q.Promise` chain per work item: `getTeamSettings` → `getWorkItem` → `GetChildTypes` → `getTemplates` → `templates.forEach` chained via `chain = chain.then(...)` → per-template `createWorkItem` → fire-and-forget `linkItems()` calls (not chained back into the awaited flow). No progress/status UI code anywhere in the file.
- `src/toolbar.html` — Extension frame entry point. Calls `VSS.init()` (no options object — defaults apply, i.e. `explicitNotifyLoaded` is `false`), defines the `createChildTask` action object (`createTasks`/`execute`), loads `scripts/app` via `VSS.require`, and registers it under `create-linked-tasks-button-test` via `VSS.register`. This is the iframe that gets loaded per action-contribution invocation — directly relevant to sub-question (c) (popup/panel lifecycle).
- `src/vss-extension.json` — Manifest: contribution `create-linked-tasks-button-test` of `type: "ms.vss-web.action"`, targeted at `ms.vss-work-web.work-item-toolbar-menu` and `ms.vss-work-web.work-item-context-menu`, `uri: "toolbar.html"`. Scopes: `vso.work`, `vso.work_write` (work-item read/write only — no extension-data scope currently requested, relevant to sub-question (a) if `IExtensionDataService` caching is proposed). `files[]` confirms only `img`, `toolbar.html`, `scripts/app.js` (compiled), `lib/VSS.SDK.min.js` ship — no server component.
- `src/gruntfile.js` — Build pipeline: `exec:tsc` compiles `app.ts` → `app.js`; `copy:static` stages `toolbar.html`, `vss-extension.json`, `img`, and the vendored `VSS.SDK.min.js` into `../build`; confirms no bundler/minifier changes module structure (still plain AMD).
- `src/configs/dev.json`, `src/configs/release.json` — Manifest override files (`public` flag only); not directly relevant to async/progress/lifecycle but confirm the dev/release packaging split described in `standards/build-tooling/packaging.md`.
- `src/package.json` / `src/tsconfig.json` — Confirms pinned dependency versions: `vss-web-extension-sdk@^1.104.0` (the SDK version whose typings are authoritative for this research), `q` (promise library in use, relevant to any async-refactor proposal), `requirejs@^2.2.0` (AMD loader), TypeScript `^5.4.5`, `strict: true` in `tsconfig.json`.

### Directories
- `src/scripts/` — sole logic module directory (just `app.ts`)
- `src/configs/` — manifest override files
- `src/node_modules/vss-web-extension-sdk/typings/` — bundled SDK type definitions (see below)

## Local SDK Typings (Platform Capability Ground Truth)

File: `src/node_modules/vss-web-extension-sdk/typings/vss.d.ts` (bundled with `vss-web-extension-sdk@1.104.0`, the version actually shipped by this extension — authoritative for what's callable, though not necessarily for runtime/lifecycle *behavior*, which needs external docs).

### Lifecycle / handshake / async initialization (sub-question a, c)
- `IExtensionInitializationOptions` (~line 305): `explicitNotifyLoaded` (defer "loaded" signal until extension calls `notifyLoadSucceeded`/`notifyLoadFailed` — currently unused; `toolbar.html` calls bare `VSS.init()`), `usePlatformScripts`, `moduleLoaderConfig`, `extensionReusedCallback` (fires when an already-loaded extension frame is reused by a new contribution invocation — potentially relevant to whether a second click reuses or reloads the frame).
- `IHostHandshakeData` (~line 356) / `IExtensionHandshakeData` (~line 387) — initial handshake payload between host frame and extension iframe (`pageContext`, `extensionContext`, `contribution`, `notifyLoadSucceeded`).
- `IXDMObjectRegistry` (~line 283) — object registration/invocation across the XDM (cross-document messaging) channel; underlies how `VSS.register`/host callbacks work across the iframe boundary.
- `IHostNavigationService` (~line 679) — `reload()` (reloads the *parent* frame), `onHashChanged`, `getHash`/`setHash`. Relevant to confirming what "full page refresh" actually tears down.
- `IHostDialogService` (~line 636) — `openDialog`, `openMessageDialog`; alternate host-level UI surface for status/errors (modal, so likely unsuitable for "non-blocking" but worth ruling in/out explicitly).

### Storage / caching (sub-question a)
- `IExtensionDataService` (~line 711, implementation `ExtensionDataService` ~line 25941) — `getValue`/`setValue`, `getDocument(s)`/`create/set/updateDocument` with `IDocumentOptions` scoping (account-wide by default; project/user/collection scopes available). Candidate for persisted template cache across sessions.
- `ISandboxedStorage` (~line 346) — host-shimmed `localStorage` for sandboxed extension content, scoped per publisher. Candidate for simpler synchronous-feeling client cache, but scope/quota semantics need external confirmation.

### Progress / status UI (sub-question b)
- `VSS/Controls/StatusIndicator` module (~line 14976): `IStatusIndicatorOptions`, `StatusIndicator`/`StatusIndicatorO` (~line 14994), `LongRunningOperation` (~line 15037, with `createWaitControl`/`getWaitControl`), `WaitControl`/`WaitControlO` (~line 15156, `IWaitControlOptions` ~line 15091) — built-in VSS control apparently purpose-built for exactly this "long running operation with visible wait indicator" scenario.
- `VSS/Controls/Notifications` module (~line 13860): `ToastNotification` (~line 13987) — fade-in/fade-out toast with `toast(message, messageType)`, `InformationAreaControl` (~line 13687) for inline expandable info/error areas.
- `GlobalProgressIndicator` (~line 29473) and `globalProgressIndicator` singleton (~line 29316) in the SDK interfaces module — global/host-level progress indicator, scope and invocation context need confirmation via external docs.
- `showProgressIndicator` / `showStatusIndicator` boolean options appear on multiple control option interfaces (~lines 33, 14120, 30069) — pattern worth checking against the specific controls in use.

## Documentation Sources

### Project Documentation (already read in full during planning)
- `.maister/docs/project/vision.md` — confirms stable/maintenance-mode status, purpose, and that TypeScript refactor (now complete per `roadmap.md`) precedes renewed feature work — this research is exactly that "renewed feature work."
- `.maister/docs/project/roadmap.md` — confirms `app.ts` migration is done (2026-08-08), notes **no Azure DevOps org was available for live behavioral verification** during that migration (same constraint likely applies here — flag confidence accordingly), and lists the unrelated `bugsBehavior` enum bug as explicitly out of scope.
- `.maister/docs/project/tech-stack.md` — confirms stateless/browser-only architecture (no backend/database available — rules out any server-side background-job solution for sub-question c), VSS SDK v1.104.0, no CI/CD, no linting.

### Standards
- `.maister/docs/INDEX.md` — confirms only global/frontend/testing/build-tooling standards are initialized; no backend standards (not applicable — no backend exists).
- `.maister/docs/standards/build-tooling/packaging.md` — confirms dev/release packaging split, addressable file entries, kebab-case contribution IDs; background context for any manifest changes (e.g., new scopes) a proposed solution might require.
- `.maister/docs/standards/global/*.md` (error-handling, minimal-implementation, conventions) — general engineering standards to apply when evaluating solution trade-offs (e.g., error-handling.md's guidance on graceful degradation and retry-with-backoff is directly relevant to async task/link creation failure handling).

## Configuration Sources
- `src/vss-extension.json` — scopes (`vso.work`, `vso.work_write`), contribution targets, manifest version.
- `src/package.json` / `src/package-lock.json` — exact dependency versions (`vss-web-extension-sdk@^1.104.0`, `q`, `requirejs@^2.2.0`, `typescript@^5.4.5`).
- `src/tsconfig.json` — compiler target/module settings (affects what async syntax, e.g. native `async`/`await` vs. `Q` promises, is realistic to propose).
- `src/configs/dev.json`, `src/configs/release.json` — manifest overrides (public flag only).

## External Sources (platform capability confirmation — to be fetched by platform gatherers)
- Microsoft Learn: Azure DevOps Extensions — SDK reference (`VSS.init`, `VSS.require`, `VSS.register`, action contributions) — https://learn.microsoft.com/en-us/azure/devops/extend/
- Microsoft Learn: Azure DevOps Extension SDK — Data storage (`IExtensionDataService` account/collection/user/document scoping, quotas) — https://learn.microsoft.com/en-us/azure/devops/extend/develop/data-storage
- Microsoft Learn: Azure DevOps Extension SDK — Web Context / lifecycle and contribution types (`ms.vss-web.action`, work-item toolbar/context-menu targets, peek/panel hosting) — https://learn.microsoft.com/en-us/azure/devops/extend/reference/targets/overview
- `Microsoft/vss-web-extension-sdk` GitHub repo (samples, `VSS.SDK.min.js` source) — https://github.com/microsoft/vss-web-extension-sdk — for iframe/XDM channel implementation details not fully documented on Learn.
- `Microsoft/azure-devops-extension-sdk` (the newer/actively maintained sibling SDK) — https://github.com/microsoft/azure-devops-extension-sdk — useful for cross-checking whether lifecycle/background-execution constraints differ or are documented more clearly in the newer SDK generation, even though this project stays on the legacy `vss-web-extension-sdk`.
- Azure DevOps work item form / peek panel behavior discussions (Developer Community / Stack Overflow) — to be searched for prior reports of extension iframes being torn down/reloaded when a work item peek panel closes, corroborating or refuting the reported bug's root cause.
