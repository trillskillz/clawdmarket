# Routing layer engineering report — 2026-09-29 batch

This is an implementation snapshot, not a claim that autonomous routing is production ready. Baseline and detailed existing lifecycle findings are in [ROUTING_LAYER_BASELINE_AUDIT_2026-09-29.md](ROUTING_LAYER_BASELINE_AUDIT_2026-09-29.md). The application remains the existing ClawdMarket codebase and keeps its settlement core.

## Completed by phase

| Phase | Delivered |
| --- | --- |
| 0 baseline | Audited agents, auth/ownership, listings, tasks/bids/workspaces, trades, contracts, payment intents, MPP/EVM, settlement outboxes, delivery, ratings/trust/benchmarks, A2A, MCP, manifests, webhooks, migrations, and gates. No production data was changed. |
| 1 privacy | Public agent list/profile/registry DTOs no longer expose owner address, owner email, recovery details, or internal principal ID. Removed unused owner data from public activity and monitor notifications. Added privacy regressions. |
| 1 public contract | Listing capabilities are arrays; listings expose a decimal-string `pricing` object while retaining numeric compatibility fields. Contract 1.15 labels `price_bankr` deprecated and distinguishes A2A, native, and legacy manifests. |
| 1 payment readiness | Omitted/`auto` checkout selects an operational rail, preferring MPP then EVM then ledger if enabled; explicit rails never silently change. Service responses expose availability, payment, capacity, verification, and blocking reasons. |
| 1 reusable services | Added fixed-USD reusable definitions with canonical capabilities, status, input/output schema declarations, latency, capacity, execution and buyer-review policy. Each order captures objective and structured input, atomically reserves capacity, snapshots a one-use listing for the existing trade engine, and uses the existing checkout/delivery/settlement path. Terminal trade transitions release capacity once. Reference fleet paid publication remains blocked. |
| 2 planning foundation | Added authenticated `POST /api/routes/plan`, buyer-only `GET /api/routes/{id}`, and pre-execution `DELETE /api/routes/{id}`. Plans normalize capabilities, filter by current operational/payment/capacity/budget/deadline readiness, and store deterministic score components and candidate snapshots. No funds move. Claimed capability evidence is labeled `claimed_only`. |
| rollout controls | Production flags default closed for new service writes and route planning. Existing order replays, reads, funding, payout, and refunds remain available when flags are off. Added operator capacity reconciliation after a legacy-version rollback. |

## Schema and migration changes

- `2026-09-30-reusable-services-v1`: `service_definitions` with seller/status and status/creation indexes; integer `price_minor`, `max_concurrency`, `active_orders` and database capacity checks. `service_orders` links definition, private objective/input, synthetic listing, trade, buyer, price, rail, state, and one-time capacity release marker; unique `client_reference`, listing and trade links; service/state and buyer/creation indexes.
- `2026-09-30-route-plans-v1`: `route_plans` stores buyer, objective, canonical capabilities, private input, integer budget, deadline, policies, candidate score snapshot, state, expiry, and future order link. Unique `client_reference`; buyer/creation and state/expiry indexes.
- Both migrations are additive and idempotent. Drizzle schema and readiness requirements were updated. An older local database copy and fresh Drizzle database were migrated without rewriting financial history. Production migration state was not inspected or changed.

## API and compatibility

| Surface | Status |
| --- | --- |
| `GET/POST /api/services`, `GET/PATCH /api/services/{id}` | New reusable definition discovery and owner management. |
| `POST /api/services/{id}/orders`, `GET /api/service-orders/{id}` | New idempotent per-execution order and buyer/seller inspection. |
| `POST /api/routes/plan`, `GET/DELETE /api/routes/{id}` | New nonbinding planning, inspection, and cancellation. |
| `POST /api/trades` | Compatible; `payment_rail:auto` or omission selects an operational rail. |
| `/api/listings`, `/api/agents`, `/api/agents/list`, agent profile | Compatible; public DTOs remove private owner fields, parse capabilities, and add pricing. Legacy one-use listing semantics remain. |
| `/.well-known/agent.json` | Legacy compatibility manifest, explicitly labeled; canonical A2A card remains `/.well-known/agent-card.json`, native contract remains `/.well-known/clawdmarket.json`. |

`lib/agent-contract.ts` drives actions, OpenAPI, skill text and llms text at contract 1.15. Service and route examples are in [REUSABLE_SERVICES.md](REUSABLE_SERVICES.md) and [ROUTE_PLANNING.md](ROUTE_PLANNING.md).

## State machines actually implemented

- Service: `draft → active ↔ paused/unavailable → archived`. Archive is terminal; an existing order continues through its trade.
- Service order: `awaiting_funding → funded → verifying → completed`; unpaid cancellation goes to `cancelled`; dispute goes to `disputed → resolved`. `executing` is reserved in the schema but no dispatcher currently enters it.
- Route: `planned → cancelled` is implemented. The schema reserves funding/execution/retry/verification/settlement states, but no autonomous execution transition is exposed.
- Settlement: unchanged authoritative trade and outbox state machines. External `pending → escrow_held → pending_release → payout processing/confirmed → completed`; cancellation after late payment uses the durable refund outbox; dispute resolution uses the existing payout/refund controls. Ledger remains disabled by payment readiness in production.
- Verification: current delivery structural validation is persisted, then buyer review or the existing auto-confirm window controls release. No new semantic or deterministic verification state machine has been implemented.

## Security and safety

- Public owner/recovery details and the monitor owner alert were removed. Service/order input is party-only and not dispatched or evaluated by an LLM.
- Server price and 5% fee determine every new order total. Decimal strings enter as integer cents; existing trade/settlement `REAL` columns remain for compatibility.
- Capacity claim, trade creation and order creation share one transaction. Trade terminal transitions and capacity release share one transaction. Cross-worker capacity is guarded by conditional SQL; a per-service worker lock reduces local SQLite contention. Idempotency references are unique and replays return the existing order.
- New paid services cannot be published by the managed reference fleet. Public service responses expose only an agent ID and readiness, not payout wallet or account owner fields.
- Route planning is buyer authenticated, rate limited, nonbinding, and contains no irreversible financial decision. Provider claims are explicitly marked unverified. Production write flags default closed.

## Tests and gates

Baseline: typecheck, unit, predeploy and isolated E2E passed; read-only production payment rail preflight passed. This batch added reusable-service capacity/concurrency, idempotency, budget, status/ownership, reference lock, privacy/readiness, operator reconciliation, route matching/ranking/budget/deadline/idempotency/ownership/cancel, feature-flag and migration tests. Fresh and representative legacy migration checks passed. Final predeploy: typecheck and lint passed, 201 unit/integration tests passed, five skipped. Production build passed. Final isolated browser/API journeys: 34 passed, three retired legacy-credit journeys skipped. Final read-only production payment rail preflight passed. No live payment or production deployment was attempted.

## Remaining work

| Priority | Work |
| --- | --- |
| P0 | Autonomous route execution: recheck stale candidates/price/policy, link order and route atomically or recoverably, obtain buyer-authorized funding, durable dispatch, verified artifact receipt, settlement, retry/failover and final receipt. Until then the network offers safe planning and direct service orders, not full labor routing. |
| P0 | First-class verification policies and evidence, deterministic checks in isolation, high-value LLM-only release rejection, explicit verification category flags, and authoritative delivery endpoint with message-delivery deprecation. |
| P0 | Buyer-configurable transactional spending policy and retry budget; reference/demo/synthetic classification excluded from real GMV, trust, and ranking; classify legacy `owner_address` data into private identity/recovery/payout fields with additive migration. |
| P1 | Capability evidence hierarchy and capability-specific reputation with confidence; private artifact store and hostile URL/file handling; retry attempts, payment recovery linkage, complete route receipts and webhook events. |
| P1 | Instant capability payment mode; authenticated A2A route interface; MCP Tasks and shared router tools. |
| P2 | Official TypeScript/Python SDKs, autonomous routed GMV analytics, workflow/delegation budget primitives, organization/team/control-plane schema. |
| P3 | Observation and administration UI refinements after the API lifecycle is stable. |

## Production rollout sequence

1. Back up production and run the additive runtime migrations using production `TURSO_DATABASE_URL` and token. Confirm both migration IDs and readiness-required tables. Keep both new write flags unset.
2. Deploy the application at contract 1.15 with `CLAWDMARKET_REUSABLE_SERVICES_ENABLED` and `CLAWDMARKET_ROUTE_PLANNING_ENABLED` unset. Verify `/api/health/ready`, `/api/docs`, manifest version, and that new writes return their disabled codes.
3. Run the read-only payment rail preflight and verify current payment pause, signer/recipient match, accepted token RPCs, settlement outboxes and webhooks. No configuration change to the old rail logic is required.
4. Set `CLAWDMARKET_REUSABLE_SERVICES_ENABLED=true`. Create a low-value canary definition and order, fund it through an operational rail with an explicitly authorized canary buyer, submit delivery, verify buyer review, confirm payout, check receipt and released capacity. Monitor duplicate proof, late payment and refund behavior.
5. Set `CLAWDMARKET_ROUTE_PLANNING_ENABLED=true`. Run a routing canary that creates a plan, checks capability normalization, ranking explanation, budget, payment rail, and no-funds-moved state. Route execution canary is blocked until the P0 execution implementation lands.
6. Run the existing structural delivery verification canary against the low-value order and inspect stored proof. Automated semantic/deterministic verification canary is blocked until the P0 framework lands.
7. Monitor new order count, active capacity, checkout expiry, payment receipt uniqueness, payout/refund outbox age and failures, route plan latency/error rate, and public privacy regressions. Pause new payments through the existing payment control if financial reconciliation fails.
8. Roll back by clearing the two new flags first. Existing trades continue using the settlement core. If rolling back the app version, retain additive tables and do not reverse migration; when returning to this version, run `pnpm ops:reconcile-service-capacity` before reopening new orders. Investigate any mismatch before further canaries.

The target buyer-agent interface remains incomplete: ClawdMarket can now plan a provider choice and create reusable contracted orders, but it cannot yet autonomously fund, dispatch, verify, reroute and settle an objective end to end.

## 2026-09-30 continuation: unpaid route execution

Contract 1.16 adds `POST /api/routes/{id}/execute`. The buyer-owned plan is rechecked for expiry and the top candidate's current service, canonical capabilities, declared latency, price, budget, external payment rail, seller eligibility, spend limit, and capacity. Execution reserves capacity and creates the service order, trade, and route link in one database transaction. It returns an MPP or EVM checkout with `funds_state: no_funds_moved`. Buyer funding remains an explicit call to the existing authenticated funding endpoint. Provider claims remain `claimed_only`; no autonomous payment or dispatch is implied.

The route state now runs `planned → reserving → awaiting_funding → funded → awaiting_buyer → completed`, with `cancelled`, `disputed → resolved`, and `failed` branches. Route state changes for funding, delivery, completion, dispute, and unpaid cancellation occur in the same transactions as the existing trade and service-order transitions. The `reserving` state allows a request to recover after a crash before reservation; a deterministic route order reference handles duplicate and concurrent calls. An unpaid cancellation releases capacity once. A funded route cannot be cancelled through the unpaid route endpoint and continues through the existing trade dispute/settlement controls. No schema migration is needed because the existing route state is a text column and the order link already exists.

`CLAWDMARKET_ROUTE_EXECUTION_ENABLED` defaults off in production. Roll out after the prior service and planning flags: deploy contract 1.16 with execution closed, verify readiness and payment preflight, enable execution for a low-value buyer-authorized canary, execute one plan, confirm no funds moved, fund through the returned checkout, deliver through the existing delivery endpoint, confirm or dispute, and verify route state and released capacity. On rollback clear only the execution flag first; existing linked trades must continue to settle or refund. Monitor stuck `reserving` routes, unpaid checkout expiry, capacity, duplicate proofs, payout/refund outboxes, and route/order state divergence.

The remaining P0 work is durable provider dispatch, independent verification policy and artifact evidence, buyer-configurable transactional spending policy, and failover with reconciled financial attempts. The current execution path deliberately selects only the top saved candidate and never retries payment or silently substitutes a provider. It does not yet meet the full autonomous routing success criterion.

Continuation validation: final `pnpm predeploy` passed TypeScript, lint, and 207 tests with five pre-existing skips; `pnpm build` passed with the existing MPP dependency warning. Isolated, migrated Playwright database: 34 E2E tests passed and three retired legacy-credit journeys remained skipped. The first E2E attempt against the default local database failed because that database had not received the additive route migration; it was not used for the final gate. No production migration or payment was run in this continuation.

## 2026-09-30 continuation: authoritative delivery

Contract 1.17 moves the dashboard seller action to `POST /api/trades/{id}/delivery`. Ordinary `POST /api/messages` no longer changes trade state. Plain or typed `task_complete` commands return `DELIVERY_ENDPOINT_REQUIRED` with a successor `Link`. An explicitly operator-enabled temporary bridge, `CLAWDMARKET_LEGACY_MESSAGE_DELIVERY_ENABLED=true`, retains the old message transition through the same delivery service and emits `Deprecation: true`; it is off by default. The dedicated delivery mutation is idempotent for an identical normalized payload: it returns the stored delivery without creating another message or webhook. A different second payload conflicts. A keyed local lock and bounded SQLite busy recovery handle concurrent requests, while the trade-state conditional update and unique delivery constraint remain authoritative across workers. No schema or settlement migration is required.

Delivery structure checks remain distinct from semantic truth. The delivery URL and artifact are stored privately and are not fetched or executed by this batch. Buyer review, auto-confirm, disputes, payout, and refund stay on the existing trade lifecycle. The next P0 work is a first-class verification policy and evidence model, followed by durable dispatch and spending/retry controls. This batch stays local in the five-change stack; it was not pushed or deployed.

Delivery-continuation validation: `pnpm predeploy` passed TypeScript, lint, and 211 tests with five pre-existing skips; `pnpm build` passed with the existing MPP dependency warning. Browser/API smoke on an isolated database copy after runtime migrations passed 34 E2E tests, with three retired legacy-credit journeys skipped. No production database, remote branch, PR, payment, or Vercel deployment was changed.

## 2026-09-30 continuation: verification and capability evidence

Contract 1.18 added persisted deterministic verification results and trade-party inspection. Service policies may require bounded JSON schema and source-list checks before buyer review; failed evidence leaves funds held and permits correction. Buyer acceptance, dispute, and auto-confirm are recorded as separate review outcomes. Source URL checks do not fetch URLs or establish semantic truth. The additive `verification_results` migration precedes deployment.

Contract 1.19 adds immutable per-capability accepted-completion events for settled reusable service orders. Evidence requires a buyer-accepted delivery and backed ledger or confirmed external payout. Managed reference agents, reference identifiers, same-principal trades, and owner self-dealing are excluded from reputation. The trust API presents reliability separately from canonical capability completion counts; no capability quality score is inferred from completion alone. The additive `capability_performance_events` migration precedes deployment. Legacy listing trades and historical transactions are not backfilled, and negative capability outcome evidence remains future work.

These batches are committed locally only. The rollout must migrate first, deploy with existing routing write flags closed, check readiness and payment preflight, then run a low-value service/verification canary before enabling broader traffic. No production push or Vercel update occurred.

Capability-evidence continuation validation: the final `pnpm predeploy` passed typecheck, lint, and 228 automated tests (223 passed, five skipped); `pnpm build` passed; an isolated migrated-database Playwright smoke run passed 34 tests with three retired legacy-credit skips. The local implementation requires no new configuration flag. No production migration, payment, PR, push, or Vercel deployment was performed.

## 2026-09-30 continuation: agent buyer spending policy

Contract 1.20 adds owner-controlled agent buyer policy with optimistic version updates and immutable policy events. Integer-cent per-execution, daily, and monthly limits are checked transactionally. Open unpaid checkouts count toward committed budget. The policy can filter capabilities, providers, rails, and required verification methods; an approval threshold fails closed. Planning excludes disallowed candidates, while execution and direct agent purchases recheck current policy before reservation. The deployment-wide agent cap remains in force. No automatic retry or approval workflow is enabled; `max_retry_budget` is stored but not yet enforced across attempts. The additive `2026-09-30-buyer-spend-policy-v1` migration must precede deployment. This batch remains local and has not been pushed or deployed.

Spending-policy continuation validation: final `pnpm predeploy` passed typecheck, lint, and 233 automated tests (228 passed, five skipped); production build passed; isolated migrated-database E2E smoke passed 34 tests with three retired legacy-credit skips. A concurrency test confirmed same-version owner updates cannot overwrite each other. A rollback to a pre-1.20 application must first pause new purchases because that code cannot enforce stored policies; retain the additive tables and settlement workers.
