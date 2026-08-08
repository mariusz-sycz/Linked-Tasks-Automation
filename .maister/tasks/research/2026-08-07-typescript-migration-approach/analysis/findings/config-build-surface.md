# Configuration/Build Surface Findings — TypeScript Migration

## Artifact Summary Contract

### TL;DR
No TypeScript, type-definition, or lint tooling exists anywhere in the repo today (no `tsconfig.json`, no `.eslintrc*`, no `typescript`/`@types/*` in `package.json` or resolved in `package-lock.json`). `Q` is confirmed **not** an npm dependency at all — direct or transitive — so its runtime resolution happens purely through the VSS SDK's own AMD/RequireJS environment (`VSS.SDK.min.js` sets up `VSS.require`, and `toolbar.html` calls `VSS.require(["scripts/app"], ...)`, never `npm`'s module graph). Any TS migration must therefore (a) add `typescript` + type packages as wholly new devDependencies, (b) resolve `Q`'s types via `@types/q` or an ambient shim rather than expecting npm to link a runtime `q` package, and (c) keep the compiled output landing at `scripts/app.js` (and everything else in `vss-extension.json`'s `files[]`) unchanged, since the manifest's `addressable` file paths, `toolbar.html`'s `VSS.require(["scripts/app"], ...)` call, and the packaging conventions in `packaging.md` are all path- and AMD-output-sensitive, not source-language-sensitive.

### Key Decisions (informational — this is a findings doc, not a decision doc)
- Treat `scripts/app.js` as a **build output path**, not a source file, once TS is introduced: `tsc` must emit AMD-format JS (`--module amd`) to that exact path so `vss-extension.json:57` (`"path": "scripts/app.js"`) and `toolbar.html:21` (`VSS.require(["scripts/app"], ...)`) keep resolving without any manifest or HTML change.
- `Q`'s typing path is `@types/q` (or a hand-written ambient `.d.ts`) layered on top of the existing AMD `define([..., "q", ...])` import — there is no npm-installed `q` runtime to type against structurally, only the shape the VSS SDK's bundled Q exposes at the `"q"` AMD module id.
- The Grunt pipeline's insertion point for a `tsc` step is upstream of `exec:package_dev`/`exec:package_release` (both defined in `src/gruntfile.js:4-23`), consistent with the packaging standard's task-naming and override-file conventions, which are entirely orthogonal to source language and require no changes themselves.

### Open Questions / Risks
- `package-lock.json:3705` resolves `vss-web-extension-sdk` to **1.110.0**, not the `1.104.0` implied elsewhere in project docs (tech-stack.md) — the SDK version actually installed is newer than what other research inputs assume; any `@types/vss-web-extension-sdk`-equivalent or hand-rolled `.d.ts` coverage check should target 1.110.x behavior, not 1.104.x.
- No lockfile evidence exists for how `Q`'s specific version/behavior is determined at runtime (it's bundled inside `VSS.SDK.min.js`, a minified vendored file) — this findings pass could not extract a Q version number from the vendored SDK; flagging as a gap for the codebase/external gatherers if precise Q version compatibility matters for `@types/q` selection.
- `package.json:15` has `"scripts": {}` — empty. There is no existing `npm run build`/`test` script convention to extend; a new TS compile step will need a fresh script (or Grunt task) with no prior naming precedent to follow beyond the kebab-case Grunt convention documented in `packaging.md`.

---

## 1. `src/package.json` — devDependencies (exact, current)

Source: `src/package.json:1-16`

```json
{
  "devDependencies": {
    "grunt": "^1.0.4",
    "grunt-cli": "^1.2.0",
    "grunt-contrib-clean": "^1.0.0",
    "grunt-contrib-copy": "~1.0.0",
    "grunt-exec": "~0.4.7",
    "requirejs": "^2.2.0",
    "tfx-cli": "^0.8.1",
    "vss-web-extension-sdk": "^1.104.0"
  },
  "name": "vsts-work-item-linked-tasks-automation",
  "private": true,
  "version": "0.10.1",
  "scripts": {}
}
```

**Confirmed absent**: no `typescript`, no `@types/*` (any), no `q`/`Q` entry, no `eslint`, no test runner. `scripts` is an empty object — no existing `npm run` commands to integrate with or extend.

**Version note**: `package.json:14` declares package `"version": "0.10.1"`, which does not match `vss-extension.json`'s manifest `"version": "1.1.17"` (see §2). This mismatch is pre-existing and orthogonal to the TS migration, but the packaging standard (`packaging.md:16-18`) only requires the `name` field to match the manifest `id` — it does not require version alignment, so this is not a migration blocker, just a pre-existing inconsistency worth flagging.

## 2. `Q` resolution — confirmed NOT an npm dependency, direct or transitive

Source: `src/package-lock.json` (6,700+ line file, `lockfileVersion: 2`, `name`/`version` at lines 2-3 matching `package.json`).

- A full-file search for `"q"` as a package-name token (`node_modules/q"`, standalone `"q":` package block) returned **zero matches** anywhere in `package-lock.json`.
- The only `q`-adjacent lockfile entries are unrelated dev-toolchain type packages pulled in transitively by `tfx-cli`'s own dependency tree: `@types/minimist` (`package-lock.json:2322,3992,5658`) and `@types/normalize-package-data` (`package-lock.json:2852,3998,6044`) — neither is Q-related; they are `@types/*` packages that already exist in the tree for unrelated tooling, not evidence of any TS setup.
- `vss-web-extension-sdk`'s own lockfile node (`package-lock.json:3704-3709` and duplicate legacy-format node at `6701-6706`) declares **no `dependencies`/`requires` block at all** — it resolves as a leaf package with zero declared npm dependencies:
  ```json
  "node_modules/vss-web-extension-sdk": {
    "version": "1.110.0",
    "resolved": "https://registry.npmjs.org/vss-web-extension-sdk/-/vss-web-extension-sdk-1.110.0.tgz",
    "integrity": "sha512-NDrXrnhhxVcmTFaDjwxJ7s1fenMtMYCupCGX/EOEWYdPoqvJ4gx4SnSOPOB378GHbjxvUZOYjBUiPnUfAE+TaQ==",
    "dev": true
  }
  ```
  This proves `Q` cannot be reaching `app.js` through npm's dependency graph at all — not even as an undeclared transitive of the SDK's npm package.

**Runtime resolution mechanism (confirmed via toolbar.html + app.js, not package-lock.json)**:
- `src/toolbar.html:8` loads the vendored SDK directly as a `<script>` tag: `<script src="lib/VSS.SDK.min.js"></script>` — this is the actual runtime artifact (a build output copied by `grunt-contrib-copy`, per `packaging.md:24-26`), not the npm package resolved by the lockfile.
- `src/toolbar.html:21` then loads the app module through the SDK's own loader: `VSS.require(["scripts/app"], function (app) {...})` — i.e., `VSS.SDK.min.js` establishes its own AMD/RequireJS runtime environment (`VSS.require`) at execution time, separate from the `requirejs` npm devDependency (which per `packaging.md` and gruntfile inspection is used only as a build-time tool, not bundled/copied into runtime).
- `src/scripts/app.js:1-2` declares `define(["TFS/WorkItemTracking/Services", "TFS/WorkItemTracking/RestClient", "TFS/Work/RestClient", "q", ..., function (_WorkItemServices, _WorkItemRestClient, workRestClient, Q, ...) {`.

**Conclusion**: the `"q"` AMD module id resolves at runtime through whatever module registry `VSS.SDK.min.js` (the vendored, minified SDK script) establishes internally — Microsoft bundles a Q-compatible promise implementation inside the SDK bundle and registers it under the `"q"` module id in its own AMD loader, entirely independent of npm/`node_modules`. This was not directly verifiable by inspecting the minified `VSS.SDK.min.js` source in this pass (out of scope per `sources.md:8`, flagged low-priority), but is the only mechanism consistent with (a) zero `q` presence anywhere in `package-lock.json`, (b) the SDK npm package declaring zero dependencies, and (c) `app.js` successfully resolving `"q"` at runtime in production today.

**Migration implication**: typing `Q` cannot rely on an installed runtime `q` package's actual shipped version — `@types/q` (or a hand-rolled ambient declaration) will be typed against the *interface* `Q` is used with in `app.js`, not a verified installed version. The type package choice is independent of any npm resolution; it only needs to describe the AMD-global `Q` shape TypeScript sees at the `"q"` import.

## 3. `src/vss-extension.json` — manifest structure and file surface

Source: `src/vss-extension.json:1-84`

- `manifestVersion: 1.0` (`:2`), `id: "vsts-work-item-linked-tasks-automation"` (`:3`), `version: "1.1.17"` (`:4`), `publisher: "SyczMariusz"` (`:8`).
- `files[]` array (`:47-64`), each entry with `"addressable": true`:
  - `{ "path": "img", "addressable": true }` (`:48-51`)
  - `{ "path": "toolbar.html", "addressable": true }` (`:52-55`)
  - `{ "path": "scripts/app.js", "addressable": true }` (`:56-59`)
  - `{ "path": "lib/VSS.SDK.min.js", "addressable": true }` (`:60-63`)
- Contribution `create-linked-tasks-button` (`:65-83`): type `ms.vss-web.action`, targets `ms.vss-work-web.work-item-toolbar-menu` and `ms.vss-work-web.work-item-context-menu`, `uri: "toolbar.html"` (`:79`), `registeredObjectId: "create-linked-tasks-button"` (`:80`).

**Migration constraint this establishes**: the manifest references `scripts/app.js` by that exact literal path (`:57`) with no glob/pattern matching (`tfx-cli` manifests are literal file lists). Whatever the TS build produces, **compiled JS output must land at `src/scripts/app.js`** (or the manifest's `files[]` entry and `toolbar.html:21`'s `VSS.require(["scripts/app"], ...)` call must both be updated in lockstep) — there is no flexibility to emit to e.g. `dist/app.js` without also editing the manifest and the HTML loader. The `id`, `version`, and contribution id are unaffected by a TS migration; they're independent of source language.

## 4. `src/configs/dev.json` and `src/configs/release.json` — override files, confirmed unaffected

Source: `src/configs/dev.json:1-5`, `src/configs/release.json:1-3`

```json
// dev.json
{
    "id": "vsts-work-item-linked-tasks-automation",
    "name": "Linked Tasks Automation",
    "public": false
}
```
```json
// release.json
{
    "public": true
}
```

Both are pure `tfx-cli` `--overrides-file` inputs consumed by `exec:package_dev`/`exec:package_release` in `src/gruntfile.js:4-13`. Neither references source file paths, build tooling, or language — **confirmed unaffected by a TypeScript migration**, consistent with the packaging standard's override-file pattern (`packaging.md:7-10`).

## 5. `.maister/docs/standards/build-tooling/packaging.md` — conventions any new build step must respect

Source: `.maister/docs/standards/build-tooling/packaging.md:1-36`

| Convention | Evidence in doc | Constraint on TS build step |
|---|---|---|
| Kebab-case Grunt task names | `:3-5` — `package-dev`, `package-release`, `publish-dev`, `publish-release` | A new `compile`/`build-ts`-style task (if registered as a Grunt alias) should follow the same kebab-case verb-object naming, not camelCase. |
| Dev/release override-file pattern | `:7-10` | Untouched by TS — confirmed in §4 above. |
| `--rev-version` on dev only | `:12-14` | Untouched — this flag is on the `tfx extension create` invocation (`gruntfile.js:5`), independent of what compiled the JS feeding into that package step. |
| `package.json` `name` matches manifest `id` | `:16-18` | Must be preserved; adding `typescript`/`@types/*` to `devDependencies` does not touch `name`. |
| `"private": true` | `:20-22` | Must be preserved when editing `package.json` to add TS tooling — no reason a TS migration would touch this field, but it's an easy accidental-diff risk when hand-editing `package.json`. |
| Vendored SDK copy via `grunt-contrib-copy` | `:24-26` | The `copy.scripts` target (`gruntfile.js:26-34`) copies the **pre-built vendor artifact** `VSS.SDK.min.js` — this is copying a third-party binary, not compiling first-party TS, so it is unaffected by and does not need to sequence with a new `tsc` step (no shared inputs/outputs). |
| All manifest `files[]` entries `addressable: true` | `:28-31` | Confirmed still true post-migration as long as `scripts/app.js` remains the compiled-output path (§3). |
| Contribution ids kebab-case | `:33-35` | Untouched by TS migration. |

**Build-step insertion point**: `src/gruntfile.js:1-52` currently has no `compile`/`ts`/`tsc` target. The task graph is `exec` (package/publish via tfx-cli) + `copy` (vendor SDK) + `clean` (`../dist/*.vsix`), aliased into `package-dev` → `["exec:package_dev"]` (`:46`), `package-release` → `["exec:package_release"]` (`:47`), `publish-dev` → `["package-dev", "exec:publish_dev"]` (`:48`), `publish-release` → `["package-release", "exec:publish_release"]` (`:49`), `default` → `["package-dev"]` (`:51`). A TS compile step must run **before** `exec:package_dev`/`exec:package_release` execute (since those tasks package whatever currently exists at `scripts/app.js` — `tfx extension create` reads files off disk at invocation time per the manifest, it does not itself compile anything), and ideally before/alongside the existing `copy:scripts` step since both are pre-packaging preparation. Given `grunt-exec` (`~0.4.7`) is already a devDependency (`package.json:7`), the lowest-new-dependency-count integration path is invoking `tsc` via an additional `exec` target rather than adding a dedicated (likely unmaintained) `grunt-ts` plugin — this observation is for the external/literature gatherer to weigh, flagged here only because it falls directly out of the existing task-graph shape.

## 6. No TS/lint configuration currently exists

Confirmed via `Glob`:
- `**/tsconfig*.json` → no matches anywhere in the repo.
- `**/.eslintrc*` → no matches anywhere in the repo.
- Full `src/` directory listing (`Glob src/**/*`) shows exactly 15 entries: `configs/dev.json`, `configs/release.json`, `gruntfile.js`, `img/*.png` (4 files), `lib/VSS.SDK.min.js`, `overview.md`, `package-lock.json`, `package.json`, `scripts/app.js`, `toolbar.html`, `vss-extension.json` — no `.ts`, `.d.ts`, `tsconfig.json`, or lint config files present. There is no partial/abandoned prior TS setup to account for; migration starts from a clean slate on the tooling side.

## 7. Source-loading chain (supporting evidence for §2 and §3)

Source: `src/toolbar.html:1-42`

```html
<script src="lib/VSS.SDK.min.js"></script>
...
<script>
VSS.init();
var createChildTask = (function() {
    "use strict";
    return {
        createTasks: function(actionContext) {
             VSS.require(["scripts/app"], function (app) {
                console.log(app);
                app.create(actionContext);
                });
            },
        execute: function(actionContext) {
            this.createTasks(actionContext);
        }
    }
    }());
VSS.register("create-linked-tasks-button", function (context) {
    return createChildTask;
});
</script>
```

Source: `src/scripts/app.js:1-2`
```js
define(["TFS/WorkItemTracking/Services", "TFS/WorkItemTracking/RestClient", "TFS/Work/RestClient", "q", "VSS/Controls", "VSS/Controls/StatusIndicator", "VSS/Controls/Dialogs"],
    function (_WorkItemServices, _WorkItemRestClient, workRestClient, Q, Controls, StatusIndicator, Dialogs) {
```

This confirms end-to-end: `VSS.SDK.min.js` (vendored SDK script, loaded first) → establishes `VSS.require`/AMD environment including the `"q"` module id → `toolbar.html` calls `VSS.require(["scripts/app"], ...)` to load the compiled/source app module by its manifest-relative path `scripts/app` → `app.js`'s `define()` call resolves `"q"` and the `TFS/*`/`VSS/*` module ids through that same SDK-provided loader, not through npm/webpack/RequireJS-the-npm-package. Any TS build must continue emitting an AMD `define([...])` module (via `tsc --module amd` or equivalent) at `scripts/app.js` for this chain to keep working unmodified.
