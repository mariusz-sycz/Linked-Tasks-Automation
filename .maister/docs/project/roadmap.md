# Development Roadmap

## Current State
- **Manifest Version**: 1.3.0 (`vss-extension.json`)
- **Package Version**: 1.3.0 (`package.json`) — aligned 2026-08-27 with the arithmetic-expressions release
- **Key Features**: Template-driven child work item creation, `applyWhen`/`notApplyWhen` conditional filtering, field inheritance and `{fieldName}` substitution, `@me`/`@currentiteration` tokens, `=` arithmetic expressions in template field values (allowlisted `Math.*` subset, parent-field placeholders), dynamic linking between created items
- **Recent Updates**: `src/scripts/app.js` migrated to strict TypeScript (`app.ts`); promise-chain, implicit-global, and `bugsBehavior`-threading bugs fixed; dead code removed; logging consolidated; `linkImtes` typo renamed. See `.maister/tasks/development/2026-08-07-typescript-migration/` for full detail. One residual risk: live-org behavioral verification (Group 6) was skipped — no Azure DevOps org was available at implementation time. Arithmetic expressions in template field values, Jest unit tests and the `1.3.0` version alignment were added on 2026-08-27 — see `.maister/tasks/development/2026-08-26-template-field-arithmetic-expressions/` for full detail.

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
  - [x] **Arithmetic expressions in template field values** — `=`-prefixed values evaluated against the parent's fields (`src/scripts/expressionEvaluator.ts`), skipped fields surfaced as dialog warnings (2026-08-27) `[Effort: M]`
- [x] **Automated tests** — Jest + ts-jest added (2026-08-27): evaluator, placeholder substitution, template builder, dialog wording `[Effort: M]`
- [ ] **Extend Jest coverage to template filtering (`IsValidTemplateWIT` and friends)** `[Effort: S]`

## Technical Debt
- [ ] **Partial test coverage** — template filtering, caching and REST transport untested; only the evaluator, placeholder substitution, template builder and dialog wording have Jest coverage
- [ ] **No CI/CD pipeline** — build/package/publish is currently manual via Grunt + tfx-cli
- [ ] **No CONTRIBUTING.md** — no documented setup/contribution process for other contributors
- [ ] **`bugsBehavior` numeric-enum-vs-string-literal bug in `GetChildTypes`** — `teamSettings.bugsBehavior` is a numeric SDK enum compared against string literals `'AsRequirements'`/`'AsTasks'`, so those branches are always false at runtime; discovered during the TypeScript migration (2026-08-08), deliberately left unfixed as out of that task's approved scope `[Effort: S]`
- [ ] **`tfx-cli@0.8.3` incompatible with Node v22 on `--rev-version`** — blocks `grunt package-dev`'s full `.vsix` output (dev-only; `package-release` unaffected); discovered during the TypeScript migration (2026-08-08) `[Effort: S]`
- [x] **Decide `src/scripts/app.js`'s version-control status** — commit `551aa91` committed `src/scripts/app.js` as a tracked legacy artifact (stale compiled output; the arithmetic-expressions task did not edit it) `[Effort: S]`

## Future Considerations
- **Feature Ideas**: escape syntax for a literal leading `=`; field-type-aware rounding for integer fields; `**`/comparison operators if requested
- **Scalability**: not currently a concern (browser-extension scale), revisit if the extension's feature surface grows significantly

---
*Assessment based on project analysis performed 2026-08-08*
