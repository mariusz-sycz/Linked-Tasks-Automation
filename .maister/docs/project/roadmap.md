# Development Roadmap

## Current State
- **Manifest Version**: 1.1.17 (`vss-extension.json`)
- **Package Version**: 1.1.17 (`package.json`) — aligned as of the TypeScript migration (2026-08-08)
- **Key Features**: Template-driven child work item creation, `applyWhen`/`notApplyWhen` conditional filtering, field inheritance and `{fieldName}` substitution, `@me`/`@currentiteration` tokens, dynamic linking between created items
- **Recent Updates**: `src/scripts/app.js` migrated to strict TypeScript (`app.ts`); promise-chain, implicit-global, and `bugsBehavior`-threading bugs fixed; dead code removed; logging consolidated; `linkImtes` typo renamed. See `.maister/tasks/development/2026-08-07-typescript-migration/` for full detail. One residual risk: live-org behavioral verification (Group 6) was skipped — no Azure DevOps org was available at implementation time.

## Phase 1: Ground Refactor to TypeScript
**Timeline**: Completed 2026-08-08

- [x] **Introduce TypeScript tooling** — `tsconfig.json`, TypeScript compiler, and Grunt/tfx build pipeline (`exec.tsc` wired into both `package-dev` and `package-release`) `[Effort: M]`
- [x] **Port `src/scripts/app.js` to TypeScript** — migrated to `src/scripts/app.ts`, `strict: true`, zero compile errors `[Effort: L]`
- [x] **Type the VSS SDK / REST client boundary** — typed via the SDK's own bundled `typings/` (`vss.d.ts`, `tfs.d.ts`) referenced directly; `@types/q` for `Q` `[Effort: M]`
- [x] **Consolidate logging** — `Log`/`WriteTrace`/`WriteLog`/`WriteError` replaced with `logInfo`/`logError` `[Effort: S]`
- [x] **Align versioning** — `package.json` now reads `1.1.17`, matching `vss-extension.json` `[Effort: S]`

## Phase 2: New Feature Development
**Timeline**: After Phase 1 lands

- [ ] **Feature backlog** — to be defined once the TypeScript base is in place
- [ ] **Automated tests** — add a test framework (e.g., Jest) targeting the newly-typed core logic, starting with template filtering (`IsValidTemplateWIT` and friends) `[Effort: M]`

## Technical Debt
- [ ] **No automated tests** — zero test coverage today; best addressed alongside or right after the TypeScript port
- [ ] **No CI/CD pipeline** — build/package/publish is currently manual via Grunt + tfx-cli
- [ ] **No CONTRIBUTING.md** — no documented setup/contribution process for other contributors
- [ ] **`bugsBehavior` numeric-enum-vs-string-literal bug in `GetChildTypes`** — `teamSettings.bugsBehavior` is a numeric SDK enum compared against string literals `'AsRequirements'`/`'AsTasks'`, so those branches are always false at runtime; discovered during the TypeScript migration (2026-08-08), deliberately left unfixed as out of that task's approved scope `[Effort: S]`
- [ ] **`tfx-cli@0.8.3` incompatible with Node v22 on `--rev-version`** — blocks `grunt package-dev`'s full `.vsix` output (dev-only; `package-release` unaffected); discovered during the TypeScript migration (2026-08-08) `[Effort: S]`
- [ ] **Decide `src/scripts/app.js`'s version-control status** — the `tsc`-compiled build output is currently untracked and not gitignored; decide explicitly whether to commit it (clone-and-run) or add it to `.gitignore` (build artifact) `[Effort: S]`

## Future Considerations
- **Feature Ideas**: deferred until after the refactor — track in this roadmap once scoped
- **Scalability**: not currently a concern (browser-extension scale), revisit if the extension's feature surface grows significantly

---
*Assessment based on project analysis performed 2026-08-08*
