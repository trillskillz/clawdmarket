# ClawdMarket routing-layer master plan

**Source of truth for future routing-layer work.** Updated 2026-10-02 after PR #238 (`f05ad18`), production contract 1.49. This plan implements the user's original phase 0–16 vision in dependency order. The existing marketplace and settlement system remain authoritative. Before starting a batch, read this file and the affected code/tests; after completing it, update the status and evidence here. Do not mark a milestone done because its schema or endpoint exists if the full transition cannot yet run safely.

## Current position

The production release through contract 1.49 passed required CI, Vercel deploy, alias checks, readiness, and read-only payment reserve preflight. PR #235 restored public pending registrations and agent account joins to live activity; PR #236 added the provider protocol, operator snapshot, privacy guards, and stale-notification handling. PR #237 added buyer-visible failure reconciliation and bounded backed-completion and provider-failure planning signals. PR #238 added uncorrected verification and confirmed buyer-refund outcome signals plus distinct-buyer and owner-link guards for planning evidence. There has been **no live-money end-to-end route canary**. On 2026-10-02 local time, public production readiness returned ready with DB ready and MPP/EVM rails; the machine manifest and OpenAPI reported contract 1.49, and 10 of 50 recent activity events were agent registrations. Public route metrics showed zero plans and zero autonomous GMV, and the services API returned zero listed reusable services. The admin routing endpoint returned 401 without operator credentials. Public APIs cannot confirm routing flag values, outbox depth, cron delivery, or legacy owner-value classification. An authorized operator session and real buyer/provider setup are still prerequisites.

| Original phases | Status | What is real today |
| --- | --- | --- |
| 0 baseline and safety audit | Done; refresh per area | [Baseline audit](docs/ROUTING_LAYER_BASELINE_AUDIT_2026-09-29.md), migration/predeploy/build/smoke gates, production readiness and rail preflight. |
| 1 public privacy, reusable services, pricing, rail selection, readiness | Mostly done | Public owner data removed from DTOs; canonical pricing/capability arrays; reusable definitions/orders with atomic capacity; `auto` rails and readiness. Legacy `owner_address` classification is unfinished. |
| 2 routing | Partial | Plans, deterministic score components, stale-provider checks, one unpaid checkout, pre-checkout fallback, owned inspection/cancel, funding-linked states. No buyer-authorized automatic funding or end-to-end orchestration. |
| 3 capabilities and 4 reputation | Partial | Canonical aliases, backed accepted-completion evidence, distinct eligible buyer breadth, and capped recent provider-decline, lease-expiry, verification-failure, and confirmed buyer-refund signals in route ranking. No independent skill quality score or broader negative outcome model. |
| 5 verification and 6 delivery/artifacts | Partial | Delivery endpoint is authoritative; structured schema and source-list checks persist evidence; buyer review controls release. No private multi-artifact store, sandboxed code checks, source freshness/content validation, or independent semantic proof. |
| 7 instant mode | Not started | Existing platform MPP and contracted settlement exist; no metered instant service execution lifecycle. |
| 8 spend policy and 9 failover | Partial | Buyer/agent/organization ceilings and pre-checkout fallback are enforced. Retry budget and funded failover are not; a cancelled external checkout may still be paid late. |
| 10 A2A and 11 MCP | Read-only routing | Both expose shared planning/inspection. Neither can spend; MCP Tasks and write authorization remain. |
| 12 contract, 13 SDK, 14 metrics | Partial | Production machine contract 1.49, TypeScript route client, evidenced assisted-route metrics. Python client and true autonomous GMV are absent. |
| 15 workflows and 16 enterprise | Foundations only | Bounded workflow plans; organizations, teams, read-only service accounts, immutable audit, and agent budget attribution. No child execution or delegated purchasing authority. |

The live buyer flow is still: plan → reserve **unpaid** order → caller funds → provider receives a signed pointer or polls → provider starts/delivers → buyer accepts → existing settlement. It does **not** yet satisfy “give ClawdMarket an objective and receive a verified, settled result without manually composing marketplace calls.”

## Execution order: finish the single-provider economic loop first

Each item is a shippable, testable milestone. Work in this order unless a fresh audit reveals a blocking dependency. Do not let later interoperability, enterprise, UI, or instant-mode work displace P0 safety and actual contracted-work completion.

### P0.1 — Establish the release and security baseline for automatic work

- [ ] Check production routing flags, current migration ledger, outbox/cron health, and actual route/service usage without exposing secrets. Admin-only `/api/admin/routing/health` is deployed and returns these aggregates, but production inspection needs an authorized operator session. Publicly observable usage after release: zero route plans, zero autonomous GMV, zero listed reusable services; admin endpoint returns 401 anonymously. Record the private operator snapshot when credentials are available.
- [x] Recheck public agent, listing, receipt, A2A, MCP, manifest, and artifact DTOs for ownership/recovery/credential leakage. Contract 1.41 closes private/archived genome and trust reads and allowlists lineage versions, improvements, and benchmark history. Privacy regressions cover private, public, and archived reads. Listing and agent directory DTOs omit legacy owner values; public receipts expose delivery hashes rather than artifact bytes; A2A/MCP use authenticated owner or agent-scoped snapshots and discovery manifests contain no credentials. Production legacy `owner_address` classification awaits operator data access; add a migration only if stored values require it. No historical email or financial history is rewritten.
- [x] Add a controlled, low-value **buyer-authorized** route canary plan covering checkout, funding, work-order access, delivery, review, payout, receipt, capacity release, and idempotent replay. [Runbook](docs/ROUTE_CANARY_RUNBOOK.md). The live canary remains pending an authorized buyer/provider/payment setup.

**Done when:** production flags and money/dispatch health are known; privacy regression checks pass; at least one real, backed route lifecycle has been observed or the precise external prerequisite is recorded. A canary is evidence, not a substitute for the missing automation below.

### P0.2 — Define an executable service protocol and durable provider attempt

- [x] Validate order input against the service's declared input schema before capacity/payment reservation. Contract 1.38 uses the existing bounded top-level JSON object subset, filters planning candidates, checks again at reservation, and retains empty-schema compatibility. No migration or settlement mutation.
- [x] Add an opt-in execution contract for providers: supported mode, authenticated work retrieval, idempotent dispatch/attempt ID, explicit acceptance/decline, heartbeat or lease, and delivery correlation. Production contract 1.41; a real provider canary remains pending. Keep the signed `work_order.ready` event as a pointer and polling fallback.
- Existing `reference_fleet_execution_runs` leases operate only for managed reference agents and task-backed trades; they do not execute a paid reusable service order. Inspect that isolation before adapting the lease pattern to opt-in providers.
- [ ] Persist dispatch state, attempts, leases, acknowledgments, failures, and deadlines; derive route/order state from authoritative transitions. Prevent duplicate dispatch from creating duplicate economic orders or deliveries. Detect timeout without treating a webhook HTTP 200 as proof of work. Production contract 1.41 persists suppressed stale work notices separately from successful and failed deliveries; the worker rechecks current trade/order/attempt state before sending, and replay cannot notify a newly subscribed webhook after an attempt ends. The operator snapshot includes aggregate missing-attempt, overdue-lease, and terminal-active-attempt signals. Production contracts 1.42–1.43 add owned route and service-order provider-attempt visibility for missing, declined, and expired funded work, with automatic retry explicitly disabled, and point failed funded work to the existing buyer/seller dispute action. Integration coverage shows an expired attempt freezing escrow and advancing the order and route to disputed without releasing capacity. Provider decline/lease expiry still retain funds pending operator resolution; the live provider canary remains open.
- [ ] Make readiness exclude services whose declared mode cannot actually execute. Tests now cover a reopened database connection, abandoned worker claim, webhook replay, stale notice after decline or terminal resolution, concurrent acceptance, atomic rollback on failed start, funded cancellation rejection, and provider silence. A real opt-in provider canary remains open.

**Done when:** one opt-in provider can receive a funded order, acknowledge it, and submit a correlated delivery through a restart-safe path. No code from the provider runs on the application host.

### P0.3 — Make provider selection evidence-aware before autonomous purchase

- [ ] Separate claimed, observed, benchmarked, and economically backed capability evidence. Production contract 1.44 distinguishes claims from economically backed buyer-accepted completions in route candidates, reports per-capability counts with unmeasured quality, and caps their ranking contribution. Production contract 1.45 adds a service-scoped, 90-day, capped penalty for funded provider declines and lease expiries, excluding self trades and reference trade IDs. Production contract 1.46 adds uncorrected deterministic verification failures from funded trades, deduplicated per trade; a later committed corrected delivery removes that signal. Production contract 1.47 adds finalized full buyer refunds with ledger or confirmed external transfer proof, and supersedes earlier failure signals for that trade. Production contract 1.48 caps positive score contribution by distinct eligible buyer accounts and excludes current owner-linked trades when reading completion evidence. Production contract 1.49 applies the same current-owner exclusion to all negative planning signals. Open disputes, processing refunds, and splits do not count as buyer refunds. Independent benchmarks, broader dispute outcome analysis, verified buyer independence, and stronger circular-trade defenses remain open.
- [ ] Rank with stored, inspectable components for capability fit, reliability, confidence, price, latency, availability, deadline, verification, and policy. Keep unrated providers visibly low confidence; do not turn a prior into measured trust.
- [ ] Recheck all evidence and readiness at reservation/funding time. Let buyers require approved or verified providers; make provider claims insufficient by themselves for automatic spending.

**Done when:** a malicious provider cannot raise its autonomous rank merely by editing claims, and the route explains why its selected provider was eligible.

### P0.4 — Finish private artifacts and verification gates

- [ ] Add a private multi-artifact model with content hash, size, media type, provenance, ownership, retention, and trade/order/route linkage. Store artifact bytes outside public DTOs; enforce authorization on retrieval.
- [ ] Enforce size/MIME/timeouts, redirect and private-IP blocking, safe URL resolution, and sandboxed processing. Never execute seller code on the main app host.
- [ ] Extend versioned verification results to deterministic schema, hash, structured assertions, source count/recency and claim/source links; add isolated code test/static-analysis adapters where supported. Explicitly distinguish URL existence from semantic truth.
- [ ] Define settlement gates: required deterministic checks must pass; buyer acceptance or an explicitly approved independent verifier is needed for semantic claims. An evaluator model alone cannot release high-value funds. Persist failure evidence and allow corrected delivery without duplicate settlement.

**Done when:** an artifact-bearing order can be verified, fail safely, be corrected, and reach a clear accepted/rejected state with auditable evidence and no private artifact leak.

### P0.5 — Authorize and fund autonomous execution safely

- [ ] Introduce an explicit buyer mandate or prepaid/session authority for router payment; possession of an `agent:read` key or a plan is not spending authorization. Bind mandate to buyer, max aggregate amount, rail/token/chain, capabilities/providers, expiry, retries, verification, and idempotency reference.
- [ ] Enforce buyer, deployment, and organization limits transactionally at **every** financial reservation and retry. Implement `max_retry_budget`; add needed trust/confidence, destination/private-data, chain/token, and latency constraints before allowing those policies in automatic routes. Approval thresholds continue to fail closed until an approval workflow exists.
- [ ] Reuse existing MPP/EVM proofs, intents, escrow, payout/refund outboxes, and recovery. Never infer payment failure from a timeout or trust client totals. Persist the route step before external side effects and reconcile after a crash.

**Done when:** a mandate-bounded route can choose an operational rail and fund exactly one selected order through retries/timeouts; a duplicate request cannot increase exposure. A no-mandate request plans only.

### P0.6 — Orchestrate verification, settlement, and receipt

- [ ] Make the route state machine drive funded dispatch → execution → delivery → verification → buyer/approved verifier decision → existing settlement → receipt. Persist each transition and stable error/funds state.
- [ ] Release capacity exactly once at terminal settlement/cancellation/resolution. Do not report `completed` until payout/ledger settlement is authoritative. Preserve buyer dispute rights and delayed-confirmation handling.
- [ ] Generate a route receipt linking objective hash, selected provider, attempts, pricing, rail, artifact hashes, verification categories, buyer decision, financial receipt, and settlement status without private input or ownership data.

**Done when:** an authorized single-provider objective reaches a backed receipt with no manual marketplace composition and survives duplicate requests and worker restarts.

### P0.7 — Add funded retry and failover only after reconciliation

- [ ] Extend route attempts to link every economic order, payment intent/receipt, refund, capacity slot, and exclusion reason. Distinguish provider, verification, payment, infrastructure, and buyer-policy failures.
- [ ] Before provider B, prove provider A's payment is absent or fully reconciled/refunded, or use a policy-authorized separate reserve within the aggregate retry budget. A cancelled MPP/EVM checkout alone is **not** proof that payment cannot arrive late.
- [ ] Enforce max attempts, total retry spend, deadline, provider exclusion, and fallback capability thresholds. Test delayed payment after cancellation, double confirmation, concurrent workers, refund/payout collisions, and crash recovery.

**Done when:** provider A can fail and provider B can finish without double payment, double capacity, or an unaccounted late refund. Otherwise fail closed with an inspectable funds state.

### P0.8 — Prove production behavior and honest metrics

- [ ] Run low-value routed, verification-failure, timeout, and refund canaries on enabled rails with operator monitoring. Inspect migration/readiness, checkout proofs, webhook/outbox retries, receipt, reputation, and capacity after each.
- [ ] Count **autonomously routed GMV** only when the route received an objective, selected and dispatched a provider, received delivery, verified or explicitly accepted it, and backed settlement. Keep manual, demo, reference, test, and synthetic transactions separate.
- [ ] Add route funnel, latency, provider utilization, verification pass, retry recovery, dispute/refund, and origin metrics; alert on stuck states, outbox age, double-exposure invariants, and privacy regressions.

**P0 exit criterion:** a buyer agent submits objective, budget, deadline, verification, and a bounded spending mandate; ClawdMarket selects, funds, dispatches, monitors, verifies, settles, and returns artifacts plus a receipt without the buyer naming a provider. Required failure paths reconcile money before another attempt.

## After P0: interoperability and scale

| Priority/order | Original phases | Deliverable and gate |
| --- | --- | --- |
| P1.1 | 7 | Instant capability calls with a separate metered/session payment lifecycle and receipt. Do not put tiny calls through treasury escrow by default; prove metering and duplicate-call billing safety. |
| P1.2 | 10 | A2A `route_work`, `inspect_route`, `cancel_route` and durable tasks backed by the canonical router. Add authenticated write authority and spend-policy checks; preserve the read-only card and compatibility manifest. |
| P1.3 | 11 | Upgrade MCP protocol/transport to a Tasks-capable version, then expose shared router operations and authorization-bound task handles, result retrieval, and cancellation. Keep current discovery tools compatible. |
| P1.4 | 12–13 | Validate OpenAPI, skill.md, llms.txt, manifests, A2A, MCP, SDK examples, lifecycle states, auth, rails, and deprecations from shared definitions. Finish TypeScript funding/artifact/webhook recovery APIs and a minimal Python client with typed financial errors. |
| P1.5 | 3–5, 14 | Broaden capability hierarchy, independent benchmarks, confidence calibration, verifier adapters, and reputation quality evidence after real outcomes exist. Protect against Sybil and circular-trade inflation. |
| P2.1 | 15 | Execute bounded DAG nodes with inherited budgets, depth/child/runtime limits, dependency artifacts, verification gates, and aggregate financial reconciliation. Keep decomposition from recursively spending without a hard mandate. |
| P2.2 | 16 | Add organization purchasing roles, approval workflow, private providers, departmental controls, and service-account spend authority only after P0 policy/mandate isolation is proven. |
| P3 | Website/control plane | Improve observation, administration, discovery, manual override, and incident tooling over the same router state; avoid a separate UI economic lifecycle. |

## Rules for every future batch and release

1. Read this plan plus the current implementation and tests for the touched area. Keep existing auth and settlement invariants, additive migrations, idempotency, and explicit state machines. Update machine-readable contracts with behavior changes.
2. Implement the highest uncompleted P0 milestone first. A milestone may take several commits; do not substitute a placeholder or a read-only endpoint for its stated acceptance gate. Record any dependency that changes the order here.
3. After each logical change, run focused tests and typecheck; before release run `pnpm predeploy`, production build, migration replay on representative legacy data, and isolated browser smoke. Add tests for financial/authorization transitions and crash/replay races.
4. Follow the user's **five-change stack** cadence for pushing a PR to production. Keep intermediate commits local, then open one reviewable PR, wait for required CI, merge, let the migration-first Vercel workflow deploy, and verify production smoke/readiness/payment preflight. A preview deployment is not production. Do not treat a successful deploy as a live-money canary.
5. Keep production flags closed until their canary and prerequisite checks pass. Pause new routes on financial uncertainty while existing settlement/refund workers continue. Roll back application/flags without dropping additive tables or rewriting financial history.
6. Update the checkboxes, contract version, deployment evidence, remaining blockers, and next milestone in this file after each release. The detailed historical implementation log remains [the engineering report](docs/ROUTING_LAYER_ENGINEERING_REPORT_2026-09-29.md); this file controls what to do next.

**Next implementation batch:** Inspect the production operator snapshot and legacy owner-value classification with authorized access. Run a real opt-in provider canary only with an authorized buyer, provider, and approved payment setup. Continue P0.2 timeout/cancellation reconciliation and P0.3 independent benchmark and broader dispute evidence without automatic funded failover; do not start automatic funding before P0.3–P0.5 gates are met.
