# Production Readiness Report

**Date**: 2026-08-09
**Path**: `.maister/tasks/development/2026-08-08-speed-up-task-creation` (implementation touches `src/scripts/*.ts`)
**Target**: production (Azure DevOps Marketplace extension, published via `grunt package-release`)
**Status**: With Concerns

## Project-Type Scoping

This is a stateless, backend-less browser extension: no server process, no database, no CI/CD pipeline (confirmed project-wide constraint, `.maister/docs/project/tech-stack.md`). Standard SaaS/service checks that don't apply to this architecture — connection pooling, rate limiting, CORS/HTTPS enforcement, graceful shutdown/SIGTERM, migrations, staging environment, circuit breakers — are marked **N/A** rather than scored as gaps. The assessment below focuses on what production readiness actually means for this artifact: correctness of the one new network dependency, error handling, no secrets/regressions, and clean packaging.

## Executive Summary
- **Recommendation**: GO WITH MITIGATIONS
- **Overall Readiness**: 85%
- **Deployment Risk**: Medium (single, well-isolated, well-documented unknown)
- **Blockers**: 1  Concerns: 2  Recommendations: 2

## Category Breakdown
| Category | Score | Status |
|----------|-------|--------|
| Configuration | 100% | N/A — no env config; version bumps correctly out of scope for this task |
| Monitoring | N/A | No server-side monitoring applicable; console logging only, appropriate for the platform |
| Resilience | 80% | Concern — one uncaught-fetch-shape risk, otherwise solid |
| Performance | 100% | Goal of the task itself — caching, keepalive, parallel dispatch all implemented as specified |
| Security | 90% | Concern — no explicit request timeout |
| Deployment | 90% | Blocker — REST endpoint shape not live-verified |

## Blockers (Must Fix)

### 1. Keepalive fetch REST endpoint/api-version is not live-verified
**Location**: `src/scripts/keepaliveFetchClient.ts:7-19`

The `createWorkItem`/`updateWorkItem` transport was rewritten from the SDK's wrapped REST client to a raw `fetch()` call, because `fetch(..., { keepalive: true })` is required to survive the dialog/tab-close race that motivated this whole task (Success Criterion 4). The URL shape (`PATCH {collection}{project}/_apis/wit/workitems/${type}?api-version=7.1`) and headers were derived from Microsoft's public REST API documentation, **not from a live network capture against a real Azure DevOps org** — that capability was unavailable during implementation (spec Core Requirement 9), and the operator explicitly chose to proceed rather than block on it.

This is correctly and clearly flagged in three places:
- Code comment directly above `buildWorkItemsUrl` (`keepaliveFetchClient.ts:10-19`), stating it "MUST be confirmed against a real network capture before production use."
- `implementation/spec.md:81,126` (component design and dedicated "REST shape verification" section).
- `implementation/work-log.md:9-10,85,120,132` — flagged repeatedly, including as "the single most important outstanding item from this implementation run" and "the single biggest risk in this implementation."

**Assessment**: this is a legitimate blocker, not a documentation gap. If the URL path, `api-version`, or header shape is wrong, every work-item create/link call fails outright in production — a correctness failure, not a degradation. The public-docs-derived shape is plausible (it matches the well-known Azure DevOps WIT REST API convention used elsewhere in Microsoft's docs), but "plausible" is not sufficient confirmation for a change to the extension's only write path.

**How to fix**: before publishing this build, open the extension against a real Azure DevOps org, trigger a work-item creation with devtools' Network tab open, and diff the captured request (URL, `api-version`, headers, response shape) against `keepaliveFetchClient.ts`. This is already an explicit, scheduled step in the project's own pending checklist (`work-log.md:132`) — it has not yet been executed as of this report. Should take under 15 minutes once org access is available.

## Concerns (Should Fix)

### 1. No explicit timeout on the keepalive fetch call
**Location**: `src/scripts/keepaliveFetchClient.ts:31-39`

`fetch()` has no `AbortSignal`/timeout wired in, so a hung request blocks that template's create/link outcome indefinitely (the surrounding `Promise` never settles, so `Promise.all` in `orchestrator.ts` never resolves for that batch). This is **not a regression** — the original SDK-wrapped `witClient.createWorkItem`/`updateWorkItem` calls it replaces had no explicit timeout either — but it's worth tightening given this path now also carries `keepalive: true` semantics, where a network-layer hang could be visually indistinguishable from "task still processing" for the user. Given the browser-extension context (no SLA, single user, dismissable dialog), this is a should-fix rather than a blocker.

**How to fix**: wrap the `fetch` call with `AbortController` + a `setTimeout` (e.g. 30s), rejecting with a clear timeout error that `sendPatch`'s existing catch/logging path already handles.

### 2. `getRelatedWorkItems` has no rejection handler on its REST call
**Location**: `src/scripts/workItemCreation.ts:36`

`witClient.getWorkItem(...).then(function (result) {...})` (used only for the `ToAllOtherChilds` link-rule branch) has no second/catch handler, so a failed lookup becomes an unhandled promise rejection (console noise, no functional impact since it's already fire-and-forget). Confirmed pre-existing behavior carried over from `app.ts`, not introduced by this task — flagged here for completeness since it sits in a file this task modified, but it's optional cleanup, not a regression.

## Recommendations (Nice to Have)

1. **Cache write failure is silently swallowed via the outer promise catch, not handled explicitly.** `templateCache.ts:writeCacheEntry` calls `localStorage.setItem` with no try/catch; in `orchestrator.ts:getCachedTeamSettings` a `QuotaExceededError` (rare, but real in long-lived browser sessions/private-mode Safari) would propagate up through `AddTasks`'s existing top-level `.catch` and report the whole batch as failed rather than just skipping the cache write and proceeding with the fetched data. Low likelihood, but an explicit try/catch around the `setItem` call (log-and-continue) would make a rare failure mode degrade gracefully instead of aborting task creation.
2. **Structured/leveled logging is minimal** (`logInfo`/`logError` wrapping `console.log`/`console.error` with a fixed prefix) — appropriate for a browser extension with no aggregation backend; no change needed unless the team later wants to correlate logs across a session.

## Verified Clean

- **No hardcoded secrets/config**: grep across `src/scripts/*.ts` for API keys, passwords, secrets, and inline tokens found nothing; the bearer token flows exclusively through `authTokenProvider.ts` → `VSS.getAccessToken()` and is never logged (`sendPatch`'s `logInfo` call logs only the target URL, not the `Authorization` header).
- **No version bumps**: confirmed `package.json` (1.1.17) and `vss-extension.json` (1.1.16) are unchanged by this task's diff (`git diff HEAD` shows only `src/scripts/app.ts` modified plus new untracked `.ts` files; version bump is explicitly out of scope per `spec.md:94,147` and correctly treated as a separate release step).
- **Dependency audit clean**: `npm audit --production` — 0 vulnerabilities across all severities.
- **No circular imports / clean compile**: `tsc -p tsconfig.json` exits 0 per work-log; import-DAG audited by the implementation team.
- **Error-handling discipline**: every new create/link/template-fetch promise chain in `workItemCreation.ts` and `orchestrator.ts` resolves rather than rejects on failure (`{ succeeded: false }` outcomes), so a single template or work item failing never crashes the batch — failures are aggregated and surfaced via the completion dialog instead. This matches the project's error-handling standard (graceful degradation for non-critical failures).
- **No config/build-tooling drift**: `gruntfile.js`, `tsconfig.json`, `toolbar.html`, `vss-extension.json` all confirmed unchanged by this task.

## Next Steps

1. **Before shipping**: capture the live REST request shape for `createWorkItem`/`updateWorkItem` against a real Azure DevOps org and reconcile with `keepaliveFetchClient.ts` (Blocker #1). This is the one gating item.
2. **Before shipping**: re-walk the TDD Green Gate manual reproduction (`implementation/tdd-red-gate.md`) — close the dialog before the first response returns, confirm partial creates still land via `keepalive: true` — already tracked as a separate blocking item in `work-log.md:133`.
3. Optional, non-blocking: add a request timeout to `keepaliveFetchClient.ts` (Concern #1) and a try/catch around `templateCache.ts`'s `localStorage.setItem` (Recommendation #1).
4. Once the live REST shape is confirmed, proceed with the normal release step (version bump + `grunt package-release`), which is correctly scoped outside this task.

---

## Structured Result

```yaml
status: "with_concerns"
recommendation: "GO_WITH_MITIGATIONS"
report_path: ".maister/tasks/development/2026-08-08-speed-up-task-creation/verification/production-readiness-report.md"

overall_readiness: 85
deployment_risk: "medium"

categories:
  configuration: { score: 100, status: "not_applicable_no_gaps" }
  monitoring: { score: 100, status: "not_applicable_no_gaps" }
  resilience: { score: 80, status: "with_concerns" }
  performance: { score: 100, status: "ready" }
  security: { score: 90, status: "with_concerns" }
  deployment: { score: 90, status: "blocked" }

issues:
  - source: "production_readiness"
    severity: "critical"
    category: "deployment"
    description: "keepaliveFetchClient.ts's REST endpoint URL/api-version is derived from public Microsoft docs, not a live network capture against a real Azure DevOps org"
    location: "src/scripts/keepaliveFetchClient.ts:7-19"
    fixable: true
    suggestion: "Capture the live createWorkItem/updateWorkItem request via devtools network tab against a real org and reconcile with the current implementation before publishing"
  - source: "production_readiness"
    severity: "warning"
    category: "resilience"
    description: "No explicit timeout on the keepalive fetch call; a hung request blocks that template's outcome indefinitely"
    location: "src/scripts/keepaliveFetchClient.ts:31-39"
    fixable: true
    suggestion: "Wrap the fetch call with AbortController + a ~30s timeout, rejecting into the existing catch/logging path"
  - source: "production_readiness"
    severity: "warning"
    category: "resilience"
    description: "getRelatedWorkItems's witClient.getWorkItem call has no rejection handler (pre-existing, unhandled promise rejection on lookup failure)"
    location: "src/scripts/workItemCreation.ts:36"
    fixable: true
    suggestion: "Add a second .then() handler or .catch() to log and continue"
  - source: "production_readiness"
    severity: "info"
    category: "resilience"
    description: "templateCache.ts's writeCacheEntry has no try/catch around localStorage.setItem; a QuotaExceededError would abort the whole batch via the outer catch rather than degrading gracefully"
    location: "src/scripts/templateCache.ts:47-53"
    fixable: true
    suggestion: "Wrap setItem in try/catch, log-and-continue on failure"

issue_counts:
  critical: 1
  warning: 2
  info: 1
```
