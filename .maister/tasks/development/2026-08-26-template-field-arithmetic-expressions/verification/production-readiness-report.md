# Production Readiness Report

## TL;DR
The arithmetic-expressions feature is code-complete, fully tested (95/95 Jest tests, `tsc --noEmit` clean, `npx grunt build` clean), and introduces no eval/`new Function`, no secrets, and no shipped dependency vulnerabilities (`npm audit --omit=dev` → 0). As a stateless client-side .vsix with no backend, most server-oriented readiness categories (health checks, connection pooling, CORS, rate limiting) are not applicable. The one real gap is that Success Criterion 8's live-Azure-DevOps-org verification (real field-type coercion, `localStorage` cache invalidation) has not been run — this project already has a private (`public: false`) dev-publish channel (`grunt publish-dev`) built for exactly this purpose. **Recommendation: GO WITH MITIGATIONS** — run the manual checklist through the private dev channel before `publish-release`.

## Key Decisions
- No blockers raised for the missing server-side controls (health endpoint, connection pooling, rate limiting, CORS) — inapplicable architecture (stateless browser extension, no backend/database), not a gap.
- Manual live-org verification treated as a concern gating the *public* release step, not the code, because a private/unlisted dev-publish path (`configs/dev.json`, `public: false`) already exists to close it before `publish-release`.
- Pre-existing devDependency vulnerabilities (23, per work-log) treated as a low-priority note, not a blocker — `npm audit --omit=dev` confirms 0 vulnerabilities in what actually ships (RequireJS only bundles `scripts/**` compiled output; jest/ts-jest/etc. never reach `build/scripts/app.js`).

## Open Questions / Risks
- Integer-typed ADO fields (e.g. `Microsoft.VSTS.Common.Priority`) reject non-integer expression results with HTTP 400, surfacing the whole template as `Failed` rather than `Warnings` — documented in README/overview but unverified against a live org.
- `localStorage` template cache (4h TTL) can serve stale template text during manual testing if not cleared first — documented as a tip, but easy to forget and silently test against the wrong template body.
- No error-tracking/telemetry service (Sentry-equivalent) exists anywhere in this project; this is a pre-existing condition, not introduced by this feature, but worth a forward-looking mention.

---

**Date**: 2026-08-30
**Path**: `.maister/tasks/development/2026-08-26-template-field-arithmetic-expressions`
**Target**: production (Azure DevOps Marketplace extension — stateless browser extension, no backend/database, distributed as `.vsix`)
**Status**: With Concerns

## Executive Summary
- **Recommendation**: GO WITH MITIGATIONS
- **Overall Readiness**: 88%
- **Deployment Risk**: Low
- **Blockers**: 0  Concerns: 3  Recommendations: 3

## Category Breakdown
| Category | Score | Status | Notes |
|----------|-------|--------|-------|
| Configuration | 100% | Ready | No secrets/env vars needed; both manifests + lockfile verified at `1.3.0` |
| Monitoring | 75% | Concern | Console-based logging only (pre-existing pattern, consistently extended); no error-tracking service project-wide |
| Resilience | 95% | Ready | Typed error boundary, graceful field-skip degradation, no unhandled-promise regressions |
| Performance | 90% | Ready | N/A for most checks (no server); cache-staleness interaction documented |
| Security | 90% | Ready | Allowlisted evaluator, no `eval`/`new Function`, prototype-pollution-safe lookups, 0 vulnerabilities in shipped surface |
| Deployment | 75% | Concern | Build/version gates all pass; live-org manual checklist (Success Criterion 8) not executed |

## Blockers (Must Fix)
None. No defect was found that should stop merging or building this code.

## Concerns (Should Fix)
1. **Live-org manual verification not performed** (Success Criterion 8, `spec.md` Open Questions/Risks, `work-log.md` "Open items")
   - Location: no live Azure DevOps org available in this environment.
   - Issue: Real ADO field-type coercion (Double vs. Integer rejection), the "expression on a required field → child rejected as Failed" path, and `localStorage` cache invalidation have only been exercised through mocked `WorkItemFields` objects in Jest, not against a real org's REST API.
   - Recommendation: Before `grunt publish-release`, run `grunt publish-dev` (uses `configs/dev.json`, `"public": false` — an unlisted build of the same extension id) against a real test org and walk the four scenarios in spec Success Criterion 8: Double-field expression, Integer-field expression producing a non-integer (expect `Failed`), expression referencing an unset parent field (expect child created + dialog warning), and a plain `{System.Title}` placeholder (expect unchanged behavior). This is exactly what the existing dev-publish channel is for.

2. **No error-tracking/telemetry service** (project-wide, not introduced by this feature)
   - Location: `src/scripts/logging.ts` — `logInfo`/`logError` wrap `console.log`/`console.error` only.
   - Issue: Field-skip failures, template-fetch failures, and link failures are only visible via the browser console (F12) and the one-shot completion dialog; nothing is aggregated or alerted on across users/installs.
   - Recommendation: Out of scope for this task (no error-tracking infra exists anywhere in the codebase), but worth a roadmap line if the team wants visibility into how often expressions fail in the wild across all installs, not just the console of the user who hit it.

3. **`localStorage` template cache can mask verification results**
   - Location: template cache noted in `spec.md` ("Templates are cached in `localStorage` for 4 h").
   - Issue: If the manual live-org checklist (Concern 1) is run without first clearing `linkedTasksAutomation.templateCache.*`, edits to the test template may not be picked up, producing a false pass/fail.
   - Recommendation: Already documented as a tip in `README.md`/`src/overview.md` — just flagging it as a step-1 prerequisite when Concern 1 is actioned.

## Recommendations (Nice to Have)
1. **Friendlier reason for exponent-style literals** — `=1e3` currently yields `unexpected token 'e3' at index 1`, which is spec-conformant but not obviously actionable to a template author who assumed exponent notation was supported. Noted as a follow-up in `work-log.md` Group 6.
2. **`npm audit` on devDependencies** — 23 pre-existing transitive vulnerabilities in devDependencies (build tooling: grunt/tfx-cli/etc.) were flagged during implementation as out of scope. They do not reach the shipped bundle (`npm audit --omit=dev` → 0 vulnerabilities, confirmed independently below), so there is no runtime exposure, but a periodic `npm audit fix`/dependency refresh on the dev toolchain would reduce local-build/supply-chain risk over time.
3. **`tech-stack.md` stale wording** — `work-log.md` Group 7 notes the "JavaScript ~100% / planned TypeScript migration / Type Checking: None" section was deliberately left out of scope for this task even though it's now inaccurate (TypeScript is in active use with `strict: true`). Recommend a follow-up docs pass.

## Independent Verification Performed
All of the following were re-run directly against the working tree (not merely taken from `work-log.md`) as part of this check:
- `npx tsc --noEmit -p tsconfig.test.json` (from `src/`) → exit 0.
- `npm test` (from `src/`) → 4 suites / 95 tests passed, 0 failed.
- `grep -nE '\beval\s*\(|new\s+Function\b' src/scripts/expressionEvaluator.ts` → no matches.
- `npx grunt build` → succeeds; `build/scripts/app.js` (70,352 bytes) contains all 15 expected `define('scripts/...')` modules including `expressionEvaluator`; the only `test(`-shaped matches in the bundle are `RegExp.prototype.test(...)` calls (e.g. `isDigit`'s `/[0-9]/.test(character)`), not Jest test code — no test code leaked into the production bundle.
- `diff README.md src/overview.md` → byte-identical, as required by R19/Success Criterion 6.
- `src/package.json`, `src/vss-extension.json`, `src/package-lock.json` (root + `packages[""]`) all read `"version": "1.3.0"`.
- `npm audit --omit=dev` (from `src/`) → **0 vulnerabilities** in the dependency set that actually ships (production build only pulls from `scripts/**` compiled TypeScript via the RequireJS optimizer; jest/ts-jest/@types/jest are devDependencies never bundled).
- Read `src/scripts/expressionEvaluator.ts`, `templateBuilder.ts`, `workItemCreation.ts`, `progressDialogController.ts`, `templateFilters.ts`, `logging.ts` in full — confirmed: the evaluator never throws to its caller (single `try/catch` boundary mapping to `{ok:false,reason}`), the allowlist lookup (`SUPPORTED_FUNCTIONS`) is guarded with `Object.prototype.hasOwnProperty.call` to keep inherited members like `constructor` off the table, and `resolveField`'s direct `currentWorkItem[name]` lookup is safe against `__proto__`/`constructor` field-reference names (they resolve to non-number/non-numeric-string values and fail with `... is not numeric`, not a write path — no prototype-pollution vector).
- Confirmed the private dev-publish channel: `src/configs/dev.json` sets `"public": false` on the same extension `id`; `grunt publish-dev` in `gruntfile.js` runs `tfx extension publish` against that override file, giving the team an unlisted build to verify against a real org before `grunt publish-release` (which uses `configs/release.json`, `"public": true`).

## Next Steps
1. Run `grunt publish-dev` and execute the four-scenario manual checklist from spec Success Criterion 8 against a real Azure DevOps org, clearing `linkedTasksAutomation.templateCache.*` first.
2. On a clean pass, run `grunt publish-release` for the public `1.3.0` Marketplace release.
3. Optionally, file a follow-up roadmap item for the stale `tech-stack.md` wording and the `=1e3` error-message friendliness (both already called out in `work-log.md`).
