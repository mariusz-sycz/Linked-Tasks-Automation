# Build & Packaging Standards

### Grunt Task Naming: kebab-case
Grunt tasks are registered with hyphenated, lowercase, verb-object names (e.g. `package-dev`, `publish-release`) rather than camelCase or colon-namespaced names.
Evidence: `src/gruntfile.js` — `grunt.registerTask("package-dev", ...)`, `grunt.registerTask("package-release", ...)`, `grunt.registerTask("publish-dev", ...)`, `grunt.registerTask("publish-release", ...)`.

### Environment-Specific Packaging via Override Files
Dev and release builds of the extension are produced from the same `vss-extension.json` manifest, differentiated only by a small overrides file (`configs/dev.json` vs `configs/release.json`) passed to `tfx extension create`/`publish`. New environment variants should follow this override-file pattern rather than duplicating the manifest.
Evidence: `src/gruntfile.js` (`--overrides-file configs/dev.json` / `configs/release.json`), `src/configs/dev.json` (`"public": false`), `src/configs/release.json` (`"public": true`).
Example: `configs/release.json` only overrides the fields that differ from the base manifest (here just `public`).

### Dev Builds Auto-Increment Version, Release Builds Do Not
The dev packaging task passes `--rev-version` to tfx-cli so each dev package auto-bumps the manifest version; the release packaging task omits this flag so release versions are bumped intentionally/manually.
Evidence: `src/gruntfile.js` — `exec.package_dev.command` includes `--rev-version`; `exec.package_release.command` does not.

### package.json name Matches Extension Manifest id
The npm package name in `package.json` is kept identical to the `id` field in `vss-extension.json`, keeping the two identifiers for the same artifact in sync.
Evidence: `src/package.json` (`"name": "vsts-work-item-linked-tasks-automation"`), `src/vss-extension.json` (`"id": "vsts-work-item-linked-tasks-automation"`).

### Package Marked Private
`package.json` sets `"private": true`, signaling this is not an npm-publishable package (it is packaged/distributed only as a `.vsix` via tfx-cli), preventing accidental `npm publish`.
Evidence: `src/package.json` — `"private": true`.

### Copied Third-Party SDK Assets via Grunt Copy Task
Vendored/third-party runtime dependencies (e.g. the VSS Web Extension SDK) are copied from `node_modules` into a flat `src/lib/` directory via a dedicated `grunt-contrib-copy` target rather than being referenced directly from `node_modules` or bundled.
Evidence: `src/gruntfile.js` — `copy.scripts` target flattens `node_modules/vss-web-extension-sdk/lib/VSS.SDK.min.js` into `dest: "lib"`; `src/lib/VSS.SDK.min.js` present in repo, matching the `vss-extension.json` files entry `"lib/VSS.SDK.min.js"`.

### Extension Manifest File Entries Marked Addressable
Every file entry served by the extension in `vss-extension.json`'s `files` array (img, toolbar.html, scripts/app.js, lib/VSS.SDK.min.js) sets `"addressable": true`, the required convention for assets the extension needs to reference by URL at runtime.
Evidence: `src/vss-extension.json` — each `files[]` entry includes `"addressable": true`.
Example: `{ "path": "toolbar.html", "addressable": true }`

### Contribution IDs Use kebab-case Matching Their Purpose
Extension contribution ids in `vss-extension.json` use lowercase, hyphenated, descriptive names (e.g. `create-linked-tasks-button`) that mirror the contribution's action, and this same id is reused as the `registeredObjectId`.
Evidence: `src/vss-extension.json` — `"id": "create-linked-tasks-button"`, `"registeredObjectId": "create-linked-tasks-button"`.
