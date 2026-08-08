# Production Readiness Report

**Date**: 2026-08-08
**Path**: `src/` (TypeScript migration of `vsts-work-item-linked-tasks-automation`)
**Target**: production (Azure DevOps Marketplace publish)
**Status**: With Concerns

## Project Context

This is a stateless, client-side Azure DevOps extension (VSS SDK, no backend, no database, no server process). Many conventional production-readiness checks — health-check endpoints, connection pooling, rate limiting, CORS, graceful shutdown, HTTPS enforcement — are **not applicable** to this deployment shape; the extension runs inside the ADO web UI iframe, calls ADO's own REST APIs through the SDK's client (which owns its own transport/throttling), and is distributed as a single `.vsix` to the Marketplace. Checks below are scoped accordingly.

## Executive Summary

- **Recommendation**: GO WITH MITIGATIONS
- **Overall Readiness**: 82%
- **Deployment Risk**: Medium
- **Blockers**: 1  Concerns: 3  Recommendations: 3

The build/package pipeline for this migration was independently re-verified end-to-end and is solid: `tsc` compiles clean under `strict: true`, `grunt package-release` (the actual Marketplace publishing path) succeeds and produces the correctly versioned `.vsix`, and versions are aligned. The one open item that keeps this from being an unqualified GO is that the migration's single intentional behavior change — fixing the broken promise chain so child work items are created/linked sequentially instead of racing — has only been verified at compile-time (TypeScript's structural checks), not exercised against a live Azure DevOps org. That verification (Group 6) was explicitly skipped by operator decision due to no org access.

## Category Breakdown

| Category | Score | Status |
|----------|-------|--------|
| Configuration | 95% | Ready |
| Monitoring | 60% | Adequate (pre-existing gaps, not migration regressions) |
| Resilience | 70% | Concern — behavioral change unverified live |
| Performance | 90% | Ready (mostly N/A for this deployment shape) |
| Security | 90% | Ready |
| Deployment | 85% | Ready with process gaps |

## Verified Directly (not taken on trust)

| Claim | Verification performed | Result |
|---|---|---|
| `tsc -p tsconfig.json` compiles with zero errors under `strict: true` | Ran `npx tsc -p tsconfig.json` from `src/` after clearing prior build artifacts | Exit code 0, zero errors — confirmed |
| `grunt package-release` succeeds end-to-end and produces the versioned `.vsix` | Deleted `dist/*.vsix`, ran `npx grunt package-release` from `src/` | Succeeded; produced `dist/SyczMariusz.vsts-work-item-linked-tasks-automation-1.1.17.vsix` — confirmed |
| `grunt package-dev`'s `exec:tsc` succeeds and regenerates `app.js`; `exec:package_dev` fails on a pre-existing `tfx-cli@0.8.3`/Node v22 incompatibility | Ran `npx grunt package-dev` from `src/` | `exec:tsc` ran and completed; `exec:package_dev` failed with `TypeError [ERR_INVALID_ARG_TYPE]` inside tfx's internal writer, exit code 3 — confirmed. Isolated to the `--rev-version` flag path used only by `package_dev`, not `package_release`. **Does not block production deployment**: the Marketplace publishing path (`package-release` → `publish-release`) does not invoke `--rev-version` and is unaffected. `package-dev` is only used for iterative local dev builds. |
| `package.json` version (`1.1.17`) matches published `vss-extension.json` version | Read both files directly | Both `1.1.17` — confirmed, no mismatch |
| No manifest/HTML changes required; `app.js` output lands where the manifest already expects it | Diffed `src/toolbar.html` and `src/vss-extension.json` against last committed revision (`feb306e`) | Zero diff on both files — confirmed untouched. Manifest's `files[].path: "scripts/app.js"` and `toolbar.html`'s `uri` are satisfied by the in-place `tsc` emission (no `outDir` remap) |
| Dependency audit | Ran `npm audit --production` in `src/` | 0 vulnerabilities found |
| Promise-chain fix is actually present in the compiled output | Read `git diff` of `src/scripts/app.ts`: `createChildFromTemplate`'s inner `.then()` now returns `createWorkItem(...)`, and the `chain.then(...)` sequencing in `AddTasks` relies on that return | Confirmed structurally present; **not** functionally exercised against a live org (see Blocker below) |

## Blockers (Must Fix or Explicitly Accept Before Publish)

### 1. Group 6 (live-org manual E2E verification) was skipped — the one behavioral change in this migration is functionally unverified

- **Location**: `.maister/tasks/development/2026-08-07-typescript-migration/implementation/work-log.md`, "Group 6 Skipped" entry
- **Issue**: The migration fixes a genuine, pre-existing bug: `createChildFromTemplate` and `createWorkItem`'s inner `.then()` callbacks previously didn't `return` their promises, so the `chain = chain.then(...)` sequencing in `AddTasks` didn't actually wait for each child work item to be created before starting the next — templates could be created out of order or racing. The fix (returning the chained promises) is now type-correct, but the actual runtime behavior — sequential creation of all 7 `linkTo` branches (`ToAllOtherChilds`, `ToAllJustCreatedTasks`, `PreviouslyCreatedTask`, `PreviouslyJustCreatedTask`, `SecondPreviouslyJustCreatedTask`, `FirstJustCreatedTask`, `SecondJustCreatedTask`) and the `bugsBehavior` branches against a real Azure DevOps project — was never exercised. TypeScript's structural type-checking cannot catch ordering/timing regressions; only running the extension against live work items can.
- **Why this matters for GO/NO-GO**: This is a published Marketplace extension with existing users. A behavior change to the core "create linked tasks" flow that ships without any live verification carries real risk of a regression reaching production users immediately, with no staged rollout mechanism in the VS Marketplace (a publish goes to 100% of update-checking installs).
- **Recommendation**: Before publishing to the Marketplace, get at least one manual smoke test against any reachable ADO org (a free/trial org is sufficient) covering: (a) the promise-chain ordering (create 2+ templates, confirm sequential not racing creation), and (b) a representative subset of the `linkTo` branches. If genuinely no org access exists before the deadline, the fallback is to publish and monitor closely (issue tracker / marketplace reviews) with a documented rollback plan (see Concern 3), since the fix is low-complexity and reversible. This is a judgment call for the operator, not a hard technical blocker — flagging it here as the one open item standing between "GO" and "GO WITH MITIGATIONS."

## Concerns (Should Address)

### 1. No error tracking or crash reporting for the client-side extension (pre-existing, not a migration regression)
- **Location**: `src/scripts/app.ts` (all functions)
- **Issue**: Failures surface only via `console.log`/`console.error` inside the ADO web UI's browser console; there's no Sentry/Bugsnag-equivalent capturing runtime errors from installed extensions in the field.
- **Recommendation**: Out of scope for this migration (roadmap defers broader feature work to Phase 2), but worth tracking as a roadmap item given Concern above about post-publish visibility into regressions.

### 2. `bugsBehavior` numeric-enum-vs-string-literal bug intentionally left unfixed
- **Location**: `src/scripts/app.ts`, `GetChildTypes` (typed as `bugsBehavior: any` to preserve existing dead-branch comparison)
- **Issue**: `teamSettings.bugsBehavior` is a numeric SDK enum but is compared against string literals `'AsRequirements'`/`'AsTasks'`, so those branches have always been dead code at runtime. Deliberately preserved as-is per the migration's "no logic changes beyond the three approved fixes" scope.
- **Recommendation**: Track as a follow-up fix candidate (already flagged in the spec audit and work-log); do not silently fix inside this migration since it wasn't in the approved scope.

### 3. No documented rollback procedure for a bad Marketplace publish
- **Location**: Deployment process (no CI/CD, per `tech-stack.md`/`roadmap.md`)
- **Issue**: If the (unverified) promise-chain fix regresses in production, the recovery path — re-publishing the prior `1.1.x` `.vsix`, or how quickly that can happen — isn't written down anywhere in the task docs.
- **Recommendation**: Before publishing, note the rollback path (keep the previous `.vsix` on hand, know the `tfx extension publish` command for a point revert) so recovery isn't improvised under pressure if Blocker 1's risk materializes.

## Recommendations (Nice to Have)

1. Remove `src/scripts/global.d.ts` — now redundant since `app.ts` references the SDK's bundled typings directly via `/// <reference path="...">`. Harmless but dead.
2. Consider pinning `tsconfig.json`'s `target` to an explicit ES level (currently satisfied by ES2015 but was left as a range decision during spec review) for future-proofing against accidental syntax drift.
3. Track the `tfx-cli@0.8.3`/Node v22 incompatibility in `package-dev` as its own small backlog item — it doesn't block production today but will keep blocking local dev-build iteration until `tfx-cli` is upgraded or pinned to a compatible Node version.

## Next Steps

1. **Decide on Blocker 1**: either perform a minimal live-org smoke test of the promise-chain fix and `linkTo` branches before publishing, or make an explicit, documented risk-acceptance decision to publish without it (the operator has already indicated acceptance of this risk once, per the work-log — this should be reconfirmed at the point of actual Marketplace publish, not just at the implementation-sign-off stage).
2. Publish via `grunt package-release` → `tfx extension publish` (verified working path) — do not rely on `package-dev`/`publish-dev` for anything beyond local iteration.
3. Note the rollback `.vsix`/command before publishing (Concern 3).
4. File the `bugsBehavior` bug and `global.d.ts` cleanup as follow-up backlog items (Concern 2, Recommendation 1).
