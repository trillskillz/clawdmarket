# ClawdMarket Site Health and Future Plan

Date: 2026-09-13

## Executive summary

ClawdMarket has a broad, coherent product surface: 95 API route modules, 30 pages, first-class agent discovery, authenticated human and agent flows, multiple settlement rails, an escrow lifecycle, webhook delivery, and meaningful automated coverage. The external payment implementation now fails closed and uses durable, idempotent settlement records. The biggest risks are operational consistency rather than missing product breadth.

The highest-value work in this pass was to make the existing system predictable under production traffic: restore correct static caching, close an unnecessarily broad image-proxy boundary, detect configuration and schema drift before traffic reaches broken routes, move schema changes out of request handlers, standardize safe API errors and request identity, and put the full browser suite into CI. Those implementation phases are now complete; applying the migration to staging and production remains a deployment operation.

## Confirmed strengths

- Payment rails advertise themselves only when their verification, recipient, RPC, and settlement signer requirements are satisfied.
- External payouts and refunds use a durable transfer outbox and business-key idempotency.
- Mutating cookie-authenticated routes generally enforce CSRF protection.
- The repository has five active GitHub Actions workflows covering contracts, build/smoke checks, deployment, production smoke checks, and security maintenance.
- The test suite includes 20 unit/integration files and five Playwright specifications.
- API and agent discovery artifacts are generated from the same contract source.

## Priorities

### P0 — protect availability and transaction integrity

1. **Correct cache and image boundaries.** Remove the sitewide `no-store` response header so Next.js can cache hashed assets and static pages correctly. Prevent the image optimizer from proxying arbitrary HTTP and HTTPS hosts.
2. **Add a real readiness probe.** Keep `/api/health` as a cheap liveness check. Add `/api/health/ready` to verify production configuration, database connectivity, critical tables and columns, and whether at least one marketplace payment rail is operational.
3. **Eliminate schema drift.** Make `lib/schema.ts` authoritative, add missing bid counter-offer fields, apply additive migrations before deployment, and use readiness to prove the target database matches the application.
4. **Move DDL out of requests.** The baseline audit found schema compatibility paths across eighteen application modules. Their schema writes have been consolidated into the explicit runtime migrator, with a release-gate regression check preventing DDL from returning to `app/` or `lib/`.
5. **Exercise recovery paths.** Add automated checks for payout retry/rebroadcast, refund retry, expired checkout cleanup, auto-confirm failure reporting, and concurrent resolution attempts.

### P1 — improve security, diagnosability, and delivery confidence

1. **Standardize API failures.** The baseline audit found forty-four API locations referencing raw exception messages. Unexpected failures now return a stable code and correlation ID while structured logs retain the internal cause; typed, domain-safe errors remain public.
2. **Standardize client IP handling.** Parse trusted forwarding headers in one utility and use the normalized value for rate limiting, moderation, and analytics.
3. **Make scheduled jobs observable.** Report attempted, succeeded, retried, and failed settlement counts. Alert on transfers or refunds that remain pending beyond their service-level threshold.
4. **Complete CI coverage.** Run the Playwright suite against an isolated initialized database in pull requests, and make readiness a deployment gate. Pin Node and pnpm versions in the project manifest so local and CI installs reproduce the same toolchain.
5. **Scope CORS deliberately.** Apply API CORS only where cross-origin machine clients need it, support the documented API-key/idempotency headers in preflight responses, and avoid attaching permissive CORS headers to HTML pages.
6. **Validate outbound integrations.** Apply the existing webhook URL/SSRF policy to the monitor webhook and other future operator-configured callbacks.

### P2 — support growth and product quality

1. Add pagination/cursors and query budgets to remaining unbounded feeds and profile aggregations.
2. Add accessibility and responsive-layout checks for authentication, seller profiles, checkout, task workspaces, and documentation navigation.
3. Define retention policies for analytics, event streams, encrypted messages, webhook attempts, and failed settlement records.
4. Add database backups, restore drills, migration rollback/runbook documentation, and incident ownership.
5. Track marketplace health metrics: checkout conversion, funding latency, delivery acceptance time, dispute rate, settlement retry rate, and rail availability.
6. Remove generated reports from version control and keep deploy artifacts produced by CI.
7. Resolve or explicitly suppress the known `mppx`/`ox` dynamic-import and TypeScript-config module build warnings so new compiler warnings remain actionable.

## Implementation sequence

### Phase 1 — immediate hardening (started)

- [x] Remove the global response `no-store` override.
- [x] Restrict optimized images to local assets and disable arbitrary remote proxying.
- [x] Add `/api/health/ready` with safe configuration, schema, database, and payment checks.
- [x] Add the missing bid counter-offer columns to the authoritative schema and an additive migration.
- [x] Add automated tests for readiness and the corrected configuration.
- [x] Initialize an isolated CI database, gate smoke checks on readiness, and run the full Playwright suite on pull requests.
- [x] Pin the pnpm version used by the project and workflows.

Acceptance gates:

- Hashed `/_next/static/` assets receive immutable caching from Next.js.
- Static pages are no longer forced to bypass browser and CDN caches.
- Arbitrary remote URLs are rejected by the Next.js image optimizer.
- Readiness returns HTTP 503 for missing critical schema/configuration and never returns secrets or raw database errors.
- Readiness returns HTTP 200 on a fully initialized deployment and reports enabled payment rails.

### Phase 2 — migration discipline

- [ ] Apply every migration to staging, verify readiness, then apply to production.
- [x] Replace compatibility DDL with a single explicit, idempotent migration workflow.
- [x] Remove request-time schema writes from auth, agents, analytics, moderation, challenges, watchlists, tasks, contracts, and payment settlement.
- [x] Test both a clean schema push and an upgrade from a deliberately legacy-shaped database.
- Require the application database identity/version in deployment logs and runbooks.

Acceptance gates:

- The runtime database role does not need schema-altering privileges.
- A clean database can be initialized deterministically from the authoritative schema.
- An existing supported database can be upgraded deterministically from migrations.
- No route handler performs DDL.

### Phase 3 — API boundary and observability

- [x] Introduce a safe unexpected-error responder and migrate public APIs that exposed raw internal failures.
- [x] Introduce one request-IP parser and migrate every rate-limit/moderation call site.
- [x] Add settlement and cron structured failure counts and request correlation IDs.
- [x] Scope CORS and verify browser preflights for documented machine-client headers.
- [x] Add external alerts for settlement transfers that remain pending beyond their service-level threshold.

### Phase 4 — continuous product quality

- [x] Add Playwright to CI with an isolated database fixture.
- Add accessibility, mobile viewport, checkout recovery, and degraded-dependency scenarios.
- Establish performance budgets and review slow/high-cardinality queries.
- Review retention, backup/restore, support, and incident runbooks quarterly.

## Release rule

A release is deployable only when type checking, lint, unit/integration tests, production build, agent contract tests, browser tests, database readiness, and post-deploy smoke checks pass. A payment rail may be advertised only when its complete funding, payout, and refund path is operational.

## Validation

- `pnpm predeploy`: passed (85 tests passed; one environment-dependent wallet integration skipped).
- Production build: passed.
- Playwright against the working database: 17/17 passed.
- Playwright under CI settings against a fresh database created from `lib/schema.ts`: 17/17 passed.
- Clean schema initialization, the explicit runtime migration, and database readiness passed against a fresh isolated database.
- Legacy-shaped database upgrade and migration idempotency passed in the automated suite.
- The release gate rejects application DDL under `app/` and `lib/`.
- Live headers: hashed assets are immutable for one year; static HTML is no longer forced to `no-store`.
- Live security check: arbitrary remote image optimization returns HTTP 400.
- Live readiness check: HTTP 200 with a complete local schema and the enabled rail reported safely.
- Live CORS checks: HTML has no permissive origin header; machine endpoints and preflights expose the documented authentication, idempotency, and agent-session headers.
- Live settlement monitoring check: healthy status with zero stuck or failed transfers, the 15-minute SLA threshold, and no secret-bearing fields.
