# ClawdMarket routing-layer master plan

**Source of truth for future routing-layer work.** Updated 2026-10-09 after the ten-part release PR #251 and its production correction PR #252 (`44544ce`), production contract **1.90**. Continue routing in dependency order. The existing marketplace and settlement system remain authoritative. Read this file and affected code/tests before each batch; record acceptance evidence after it. A schema or endpoint alone does not complete an economic milestone.

## Current position

**Publishing instruction:** The ten substantive parts are released: MCP routing Tasks (1.81), payment proofs/sitewide backed balance (1.82), TypeScript/Python recovery clients (1.83), current-backed capability proof discovery (1.84), private peer benchmark recovery (1.85), capability hierarchy discovery (1.86), versioned private benchmark observations (1.87), bounded backed-cycle exclusions (1.88), isolated Python verification (1.89), and current-backed buyer reputation (1.90). The next batch remains local until **ten substantive acceptance-complete parts** pass. Its counter starts at **0/10**; release records, audits and intermediate workflow foundations do not increment it. Old/unnecessary PRs retain their recorded exemption. No live wallet spending, top-up or global rollout flag change is authorized.

**Latest release:** [PR #251](https://github.com/trillskillz/clawdmarket/pull/251) and [PR #252](https://github.com/trillskillz/clawdmarket/pull/252) are merged. The corrected production SHA is `44544ce1b4aebf9e4a99cb45db9140d92017230a`. Migration-first [deployment 37890272617](https://github.com/trillskillz/clawdmarket/actions/runs/37890272617) passed release/reserve gates, all 52 migration IDs, four read-only production Turso query-compilation checks and both domain aliases. Same-SHA [production smoke 37890762121](https://github.com/trillskillz/clawdmarket/actions/runs/37890762121), [main CI 37890272553](https://github.com/trillskillz/clawdmarket/actions/runs/37890272553), Agent Contract and payment monitor passed. Independent read-only production Chromium checks at 1440/390 px passed: contract 1.90, readiness ready, both recorded MPP payment proofs with Tempo labels, sitewide backed account credit, payout-ready marketplace default, coherent backed reputation, registrations first in a bounded unique Live feed, and no horizontal overflow. The first release's remote-parser failure was rolled back and corrected; detailed incident evidence below preserves that history.

**Next:** P2.1 bounded workflow execution. Local contract **1.91** now implements exact owner-reviewed frozen DAG/contracts; atomic parent/node financial reservations and stable child execution/recovery references are next. Full child execution, dependency artifact grants, atomic fee-inclusive reservations, common deadlines, crash recovery and aggregate financial reconciliation must meet the audit's acceptance gate before counting a completed part. Independent provider participation, production benchmark quality/calibration, paid production canaries and semantic proof retain their external prerequisites. Global routing writes remain closed.

PR #245 (`df5434e`) delivers one usable outcome: a provider-operated worker completes a funded leased order across process restart using its original attempt, private saved output, and exact delivery receipt. All required CI passed on final head `094775c`. Initial deployment `37081504540` and production smoke `37081790749` passed. The user explicitly authorized the configured canary seller and wallets; live run `37081892752` completed one $0.02 Base USDC checkout, provider process restart, schema-checked correlated delivery and idempotent replay, buyer review, confirmed $0.02 seller payout, and capacity release. Handler execution ran on the provider/workflow machine, outside the application. This controlled account pair remains excluded from independent provider evidence and autonomous GMV.

Temporary scoped IDs were removed from both GitHub and Vercel. Closure deployment `37081995899`, final production smoke `37082311711`, and payment monitor `37082386305` passed on `df5434ef3455011cbab0558ec326832062efc0ef`. Current production environment inspection found none of the three global enable flags or two scoped canary IDs; GitHub production scoped variables were also absent. Readiness is ready with Base and Tempo rails healthy, native contract remains 1.62, and service discovery returns zero active definitions. Public route metrics now show two plans/executions, zero accepted independent settlements, and zero assisted/autonomous GMV. Earlier contract 1.62 fixes and the Next.js 16.3.6 security patch remain in production.

Protected post-live audit `37082040543` confirmed 33 migrations, two archived services, two completed routes/orders, two delivered attempts, zero provider/deadline/webhook/settlement anomalies, and a successful webhook heartbeat one minute old. Its aggregate owner inventory counted 211 agents: 161 blank, 16 email-like, 32 valid EVM addresses, and two short opaque values. All 15 authoritative owner links still belong to blank legacy values; email agreement is zero and both shared-wallet groups have incomplete links. These historical values were not rewritten. The inventory is a post-live snapshot before final smoke registration. Independent provider completion, automatic buyer funding, private artifact expansion, and complete orchestration remain open. Future releases follow demonstrable outcomes rather than a count of commits.

| Original phases | Status | What is real today |
| --- | --- | --- |
| 0 baseline and safety audit | Done; refresh per area | [Baseline audit](docs/ROUTING_LAYER_BASELINE_AUDIT_2026-09-29.md), migration/predeploy/build/smoke gates, production readiness and rail preflight. |
| 1 public privacy, reusable services, pricing, rail selection, readiness | Mostly done | Public owner data removed from DTOs; canonical pricing/capability arrays; reusable definitions/orders with atomic capacity; `auto` rails and readiness. Legacy `owner_address` classification is unfinished. |
| 2 routing | Partial | Plans, deterministic score components, stale-provider checks, one unpaid checkout, pre-checkout fallback, owned inspection/cancel, funding-linked states. Production still requires caller funding/composition; local 1.75 adds mandate-bound EVM/Tempo funding and explicit-decision orchestration with backed receipts. |
| 3 capabilities and 4 reputation | Partial | Canonical aliases, backed accepted-completion evidence, distinct eligible buyer breadth, and capped recent provider-decline, lease-expiry, verification-failure, and confirmed buyer-refund signals in route ranking. No independent skill quality score or broader negative outcome model. |
| 5 verification and 6 delivery/artifacts | Partial | Delivery endpoint is authoritative; structured schema and source-list checks persist evidence; buyer review controls release. Private encrypted multi-artifacts are released. Released contracts 1.65–1.67 add agreed assertions, declared source date/claim-link checks, explicit buyer acceptance and externally isolated finite JavaScript tests/syntax checks. Remote isolation is authenticated attestation; independent semantic proof remains unverified. |
| 7 instant mode | Implemented; production writes closed | Contract 1.79: separate prepaid deposited-credit sessions, bounded external-provider calls, schema acceptance, atomic unit settlement/receipts, uncharged failure/expiry and exactly-once billing/refunds. Whole cents, no Tempo payment channels or token/time metering. |
| 8 spend policy and 9 failover | Partial | Buyer/agent/organization ceilings and pre-checkout fallback are enforced. Released 1.76 supports approved fallback only after exact confirmed original refunds, with gross retry budgets and the original objective deadline; cancelled unpaid checkout remains uncertain. |
| 10 A2A and 11 MCP | Released; production writes closed | Released 1.80 supports scoped owner-mandate-bound A2A tasks with closed production writes. Released 1.81 adds experimental MCP 2025-11-25 routing Tasks, private handles, resumable terminal results and safe pre-checkout cancellation over the shared router. MCP writes also default closed. |
| 12 contract, 13 SDK, 14 metrics | Recovery clients released; metrics partial | Production machine contract 1.90, TypeScript/Python recovery clients with checked shared definitions, evidenced assisted-route metrics. True autonomous production GMV remains unproven. |
| 15 workflows and 16 enterprise | Foundations only | Bounded workflow plans; organizations, teams, read-only service accounts, immutable audit, and agent budget attribution. No child execution or delegated purchasing authority. |

The live buyer flow is still: plan → reserve **unpaid** order → caller funds → provider receives a signed pointer or polls → provider starts/delivers → buyer accepts → existing settlement. It does **not** yet satisfy “give ClawdMarket an objective and receive a verified, settled result without manually composing marketplace calls.”

## Execution order: finish the single-provider economic loop first

Each item is a shippable, testable milestone. Work in this order unless a fresh audit reveals a blocking dependency. Do not let later interoperability, enterprise, UI, or instant-mode work displace P0 safety and actual contracted-work completion.

### P0.1 — Establish the release and security baseline for automatic work

- [x] Check production routing flags, current migration ledger, outbox/cron health, and actual route/service usage without exposing secrets. Protected audit `37079205538` on 2026-10-02 confirmed 33 migrations; no failed, overdue, or stuck webhook/settlement work; a recent successful webhook heartbeat; and no acknowledgment, lease, missing-attempt, terminal-attempt, or delivery-deadline anomalies. Current Vercel production environment inspection found all three sitewide enable flags and both scoped canary IDs absent. Public metrics still show one controlled plan/execution, zero assisted/autonomous GMV, and zero active reusable services. The admin HTTP endpoint requires a separate authorized operator login; the protected workflow supplies the aggregate snapshot.
- [x] Recheck public agent, listing, receipt, A2A, MCP, manifest, and artifact DTOs for ownership/recovery/credential leakage. Contract 1.41 closes private/archived genome and trust reads and allowlists lineage versions, improvements, and benchmark history. Privacy regressions cover private, public, and archived reads. Listing and agent directory DTOs omit legacy owner values; public receipts expose delivery hashes rather than artifact bytes; A2A/MCP use authenticated owner or agent-scoped snapshots and discovery manifests contain no credentials. Protected contract 1.56 inspection found 158 blank, 16 email-like, 32 valid EVM addresses, and two short opaque `owner_address` values among 208 agents. Two wallets are shared by four agents. Contract 1.57 audit `37071309299` found no authoritative links for the 18 nonblank, nonwallet records or the 32 EVM records; none of the email-like values agrees with owner_email and both shared-wallet groups have incomplete links. Retain historical values and require the existing verified ownership flow; do not infer owners or migrate these records from aggregate evidence.
- [x] Add a controlled, low-value **buyer-authorized** route canary plan covering checkout, funding, work-order access, delivery, review, payout, receipt, capacity release, and idempotent replay. [Runbook](docs/ROUTE_CANARY_RUNBOOK.md). A controlled, authorized Base route canary completed under contract 1.54; an independent provider canary remains pending.

**Done when:** production flags and money/dispatch health are known; privacy regression checks pass; at least one real, backed route lifecycle has been observed or the precise external prerequisite is recorded. A canary is evidence, not a substitute for the missing automation below.

### P0.2 — Define an executable service protocol and durable provider attempt

- [x] Validate order input against the service's declared input schema before capacity/payment reservation. Contract 1.38 uses the existing bounded top-level JSON object subset, filters planning candidates, checks again at reservation, and retains empty-schema compatibility. No migration or settlement mutation.
- [x] Add an opt-in execution contract for providers: supported mode, authenticated work retrieval, idempotent dispatch/attempt ID, explicit acceptance/decline, heartbeat or lease, and delivery correlation. Production contract 1.41; a controlled account-pair provider canary passed under contract 1.54, while independent provider execution remains pending. Keep the signed `work_order.ready` event as a pointer and polling fallback.
- Existing `reference_fleet_execution_runs` leases operate only for managed reference agents and task-backed trades; they do not execute a paid reusable service order. Inspect that isolation before adapting the lease pattern to opt-in providers.
- [x] Persist dispatch state, attempts, leases, acknowledgments, failures, and deadlines; derive route/order state from authoritative transitions. Prevent duplicate dispatch from creating duplicate economic orders or deliveries. Detect timeout without treating a webhook HTTP 200 as proof of work. Production contract 1.41 persists suppressed stale work notices separately from successful and failed deliveries; the worker rechecks current trade/order/attempt state before sending, and replay cannot notify a newly subscribed webhook after an attempt ends. The operator snapshot includes aggregate missing-attempt, overdue-lease, and terminal-active-attempt signals. Production contracts 1.42–1.43 add owned route and service-order provider-attempt visibility for missing, declined, and expired funded work, with automatic retry explicitly disabled, and point failed funded work to the existing buyer/seller dispute action. Production contract 1.50 makes direct unpaid trade cancellation race-safe, idempotent, and explicit about late-payment exposure. Production contract 1.51 closes a live provider attempt when a dispute or terminal order transition stops work, while preserving a lease already overdue as provider expiry; interrupted work does not count as provider failure. Production contract 1.52 routes a verified payment through cancelled-trade refund reconciliation when cancellation wins after the funding endpoint read a pending snapshot. Production contract 1.53 makes concurrent same-proof late-payment recording idempotent while rejecting a different proof. Integration coverage shows an expired attempt freezing escrow and advancing the order and route to disputed without releasing capacity. Provider decline/lease expiry still retain funds pending operator resolution; contract 1.55 adds actionable delivery-deadline attention in owned views and aggregate operator audit without moving funds or starting another provider. **Production contract 1.62 includes the contract 1.59 acknowledgment change: it persists queued acknowledgment deadlines, rejects late actions, records timeout once, suppresses stale notices, and exposes private and aggregate timeout attention.** Timely disputes interrupt queued work; overdue disputes preserve acknowledgment timeout. These observations hold money and capacity. An independent provider canary remains open.
- [x] Make readiness exclude services whose declared mode cannot actually execute. **Released in production contract 1.62 via PR #244; independent provider evidence remains pending.** Discovery, planning, saved-route execution, and direct reservation share supported `contracted`/provider-protocol/schema/verification checks. Reservation binds the checked fields in its capacity update; malformed stored contracts fail closed and pre-checkout fallback stays available. Tests now cover a reopened database connection, abandoned worker claim, webhook replay, stale notice after decline or terminal resolution, concurrent acceptance, atomic rollback on failed start, funded cancellation rejection, and provider silence. An independent opt-in provider canary remains open.

**Released recovery update (implemented in 1.60; production 1.62):** Provider acceptance, decline, and heartbeat now retry transient database contention in fresh transactions, preserving atomic rollback and the saved acknowledgment deadline. Every retry rechecks current trade/order/attempt state and time; another worker's accepted result replays, while decline, dispute, and expired acknowledgment/lease deadlines fail closed. Persistent contention returns private `WORK_ATTEMPT_UNAVAILABLE` (503, `retryable: true`) for the same attempt ID/action. Business and unrelated database errors are not retried. This recovery change is released; independent provider evidence remains open.

**Done when:** one opt-in provider can receive a funded order, acknowledge it, and submit a correlated delivery through a restart-safe path. No code from the provider runs on the application host.

### P0.3 — Make provider selection evidence-aware before autonomous purchase

- [ ] Separate claimed, observed, benchmarked, and economically backed capability evidence. Production contract 1.44 distinguishes claims from economically backed buyer-accepted completions in route candidates, reports per-capability counts with unmeasured quality, and caps their ranking contribution. Production contract 1.45 adds a service-scoped, 90-day, capped penalty for funded provider declines and lease expiries, excluding self trades and reference trade IDs. Production contract 1.46 adds uncorrected deterministic verification failures from funded trades, deduplicated per trade; a later committed corrected delivery removes that signal. Production contract 1.47 adds finalized full buyer refunds with ledger or confirmed external transfer proof, and supersedes earlier failure signals for that trade. Production contract 1.48 caps positive score contribution by distinct eligible buyer accounts and excludes current owner-linked trades when reading completion evidence. Production contract 1.49 applies the same current-owner exclusion to all negative planning signals. Open disputes, processing refunds, and splits do not count as buyer refunds. Independent benchmarks, broader dispute outcome analysis, verified buyer independence, and stronger circular-trade defenses remain open.
- [x] Rank with stored, inspectable components for capability fit, reliability, confidence, price, latency, availability, deadline, verification, and policy. Keep unrated providers visibly low confidence; do not turn a prior into measured trust.
- [x] Recheck completion evidence and execution readiness at reservation/funding time. Contract 1.63 lets buyers require approved providers or minimum economically backed completions/buyer accounts. Claims cannot satisfy backed thresholds; candidates expose unmeasured quality and unverified independence. Automatic spending authority and independently verified skill remain separate gates.

**Released reservation update (implemented in 1.61; production 1.62):** Direct service orders and saved route execution now enforce any saved policy by authenticated buyer ID inside the reservation transaction even when no agent identity exists. Account buyers receive provider/capability/rail/verification/approval and per-execution/daily/monthly checks; registered agents retain deployment and organization limits. Full fee-inclusive totals and unreconciled cancelled external checkouts count against exposure. Exact existing checkout replay remains recoverable after policy changes. Route eligibility snapshot binding is released in 1.62; evidence/funding rechecks, independent verification, and automatic spending gates remain open.

**Released eligibility update (production contract 1.62):** Reservation now rechecks saved route capabilities, requested verification/source minimum, and latency/deadline against its service snapshot inside the transaction. The capacity write binds seller identity, capabilities, and nullable latency alongside the existing contract/price fields. A provider identity change after route preflight is rejected; bounded fallback remains available only before checkout. Malformed capability records are excluded from planning/execution. Evidence/funding rechecks, independent verification, and autonomous purchase authority remain open.

**Done when:** a malicious provider cannot raise its autonomous rank merely by editing claims, and the route explains why its selected provider was eligible.

### P0.4 — Finish private artifacts and verification gates

- [x] Add a private multi-artifact model with content hash, size, media type, provenance, ownership, retention, and trade/order/route linkage. Store artifact bytes outside public DTOs; enforce authorization on retrieval.
- [x] Local implementation enforces bounded size/MIME/streaming timeouts, fixed-origin authenticated artifact retrieval without redirects, and external sandboxed processing. Remote delivery/source/provenance URLs are never fetched, so arbitrary URL resolution, redirects and private-IP fetching are unsupported. Seller code never runs on the application host. Real isolation tests cover host files, secret environment, reachable host loopback, runtime/output/native-memory limits and fail-closed resource controls; paid production proof remains deferred.
- [x] Local contracts 1.65–1.67 implement schema/hash/assertions/declared source count/date/link checks and external adapters for finite JavaScript function cases and syntax checking only. Policies and authenticated reports bind hashes and required checks. URL form and declared metadata are not existence, provenance or semantic truth; isolation is not observed by the app.
- [x] Local contracts 1.66–1.67 enforce saved required checks and explicit buyer acceptance before existing ledger/external settlement for opt-in orders. Verifier reports cannot release funds or substitute for buyer acceptance. Failure/correction/replay preserve escrow, disputes and one settlement; legacy null snapshots preserve historical terms. Independent semantic-verifier release remains unsupported.

**Done when:** an artifact-bearing order can be verified, fail safely, be corrected, and reach a clear accepted/rejected state with auditable evidence and no private artifact leak.

### P0.5 — Authorize and fund autonomous execution safely

- [x] Introduce an explicit buyer mandate or prepaid/session authority for router payment; possession of an `agent:read` key or a plan is not spending authorization. Bind mandate to buyer, max aggregate amount, rail/token/chain, capabilities/providers, expiry, retries, verification, and idempotency reference.
- [x] Enforce buyer, deployment, and organization limits transactionally at **every** financial reservation and retry. Implement `max_retry_budget`; add needed trust/confidence, destination/private-data, chain/token, and latency constraints before allowing those policies in automatic routes. Approval thresholds continue to fail closed until an approval workflow exists.
- [x] Reuse existing MPP/EVM proofs, intents, escrow, payout/refund outboxes, and recovery. Never infer payment failure from a timeout or trust client totals. Persist the route step before external side effects and reconcile after a crash.

**Local implementation acceptance completed:** Owner-granted immutable single-attempt mandates, existing policy ceilings, EVM/Tempo buyer workers, exact claims, reserves and original-payment crash recovery are tested. Retry budgets remain zero and unsupported approval/automatic retry authority fails closed until P0.7. Paid production proof and global rollout remain deferred.

**Done when:** a mandate-bounded route can choose an operational rail and fund exactly one selected order through retries/timeouts; a duplicate request cannot increase exposure. A no-mandate request plans only.

### P0.6 — Orchestrate verification, settlement, and receipt

- [x] Make the route state machine drive funded dispatch → execution → delivery → verification → buyer/approved verifier decision → existing settlement → receipt. Persist each transition and stable error/funds state.
- [x] Release capacity exactly once at terminal settlement/cancellation/resolution. Do not report `completed` until payout/ledger settlement is authoritative. Preserve buyer dispute rights and delayed-confirmation handling.
- [x] Generate a route receipt linking objective hash, selected provider, attempts, pricing, rail, artifact hashes, verification categories, buyer decision, financial receipt, and settlement status without private input or ownership data.

**Done when:** an authorized single-provider objective reaches a backed receipt with no manual marketplace composition and survives duplicate requests and worker restarts.

### P0.7 — Add funded retry and failover only after reconciliation

- [x] Extend route attempts to link every economic order, payment intent/receipt, refund, capacity slot, and exclusion reason. Distinguish provider, verification, payment, infrastructure, and buyer-policy failures.
- [x] Before provider B, prove provider A's payment is absent or fully reconciled/refunded, or use a policy-authorized separate reserve within the aggregate retry budget. A cancelled MPP/EVM checkout alone is **not** proof that payment cannot arrive late.
- [x] Enforce max attempts, total retry spend, deadline, provider exclusion, and fallback capability thresholds. Test delayed payment after cancellation, double confirmation, concurrent workers, refund/payout collisions, and crash recovery.

**Done when:** provider A can fail and provider B can finish without double payment, double capacity, or an unaccounted late refund. Otherwise fail closed with an inspectable funds state.

### P0.8 — Prove production behavior and honest metrics

- [ ] Run low-value routed, verification-failure, timeout, and refund canaries on enabled rails with operator monitoring. Inspect migration/readiness, checkout proofs, webhook/outbox retries, receipt, reputation, and capacity after each.
- [x] Count **autonomously routed GMV** only when the route received an objective, selected and dispatched a provider, received delivery, verified or explicitly accepted it, and backed settlement. Keep manual, demo, reference, test, and synthetic transactions separate. Local contract 1.77 requires durable original claims, the first registered-agent acceptance, receipt/origin agreement and confirmed backed settlement. This implements the measure; production automation proof and independent participation remain separately open.
- [x] Add route funnel, latency, declared provider utilization, verification observations, retry recovery, all-attempt dispute/refund, and authenticated origin metrics. Local 1.77 includes aggregate privacy and contradictory financial evidence checks.
- [x] Alert on stuck states, outbox age and double-exposure invariants; pause only new routing commitments on financial uncertainty while reconciliation continues. Local contract 1.78 persists routing-only controls/events, enforces admission in reservation and send authority, monitors financial health in authenticated webhook cron, and requires spaced healthy samples before automatic database reopening. Environment holds and closed rollout flags remain authoritative. Private fixed-code aggregate alerts feed operator inspection and the existing hourly monitor; original proof, dispatch, review, payout/refund and capacity recovery remain available. Required privacy and financial regression gates pass. Production monitoring and paid failure proof remain deferred.

**P0 exit criterion:** a buyer agent submits objective, budget, deadline, verification, and a bounded spending mandate; ClawdMarket selects, funds, dispatches, monitors, verifies, settles, and returns artifacts plus a receipt without the buyer naming a provider. Required failure paths reconcile money before another attempt.

## After P0: interoperability and scale

| Priority/order | Original phases | Deliverable and gate |
| --- | --- | --- |
| P1.1 | 7 | **Complete locally (1.79; part 9/10).** Separate prepaid deposited-credit sessions and successful-call unit metering with atomic receipts; failures/expiry are uncharged and concurrent/restarted duplicate billing is safe. No contracted trade or per-call treasury escrow. Production closed; cents only, no Tempo channels or organization agents. See [instant lifecycle](docs/INSTANT_EXECUTION.md). |
| P1.2 | 10 | **Complete locally (1.80).** A2A `route_work`, `inspect_route`, `cancel_route` and durable tasks backed by the canonical router. Add authenticated write authority and spend-policy checks; preserve the read-only card and compatibility manifest. |
| P1.3 | 11 | **Complete locally (1.81; new batch part 1/10).** MCP 2025-11-25 Streamable HTTP, authenticated shared-router routing Tasks, durable private handles/results, cursor resumption and safe cancellation before checkout. Legacy discovery/payment clients remain compatible. Production writes default closed. |
| P1.4 | 12–13 | **Complete locally (1.83; new batch part 3/10).** Shared generated operation/auth/scope/lifecycle/rail/deprecation metadata, TypeScript funding/artifact/webhook recovery and a usable minimal Python client with typed financial errors. Predeploy refuses contract drift; both clients recover original routes against the actual app. |
| P1.5 | 3–5, 14 | **Partial; released in 1.90.** Current-backed work discovery, honest unmeasured capability confidence, evaluator-bound private peer benchmark recovery, explicit hierarchy discovery, immutable versioned/private server-checked JSON benchmark observations, bounded backed-cycle exclusions, external isolated Python tests and current-backed buyer reputation with bounded owner-principal feedback are complete. Independent production benchmark quality, confidence calibration and broader reputation quality evidence remain unfinished. Unknown-owner independence and cycles beyond four principals remain unresolved. Continue independent local work on P2.1 bounded workflow execution. |
| P2.1 | 15 | Execute bounded DAG nodes with inherited budgets, depth/child/runtime limits, dependency artifacts, verification gates, and aggregate financial reconciliation. Keep decomposition from recursively spending without a hard mandate. |
| P2.2 | 16 | Add organization purchasing roles, approval workflow, private providers, departmental controls, and service-account spend authority only after P0 policy/mandate isolation is proven. |
| P3 | Website/control plane | Improve observation, administration, discovery, manual override, and incident tooling over the same router state; avoid a separate UI economic lifecycle. |

## Rules for every future batch and release

1. Read this plan plus the current implementation and tests for the touched area. Keep existing auth and settlement invariants, additive migrations, idempotency, and explicit state machines. Update machine-readable contracts with behavior changes.
2. Implement the highest uncompleted P0 milestone first. A milestone may take several commits; do not substitute a placeholder or a read-only endpoint for its stated acceptance gate. Record any dependency that changes the order here.
3. After each logical change, run focused tests and typecheck; before release run `pnpm predeploy`, production build, migration replay on representative legacy data, and isolated browser smoke. Add tests for financial/authorization transitions and crash/replay races.
4. Follow the user's **ten completed substantive plan parts in one PR** instruction of 2026-10-02, with the 2026-10-04 explicit GitHub feature-branch push exception recorded below. Save acceptance-complete capabilities locally with supporting implementation/tests/contracts/diagnostics/documentation; do not push or open a PR until at least ten parts pass. Commit count, documentation and version bumps are not plan parts. Wait for required CI, merge, use the migration-first Vercel workflow, and verify production smoke/readiness/payment preflight. A deployment alone is not proof of a completed paid lifecycle.
5. Keep production flags closed until their canary and prerequisite checks pass. Pause new routes on financial uncertainty while existing settlement/refund workers continue. Roll back application/flags without dropping additive tables or rewriting financial history.
6. Update the checkboxes, contract version, deployment evidence, remaining blockers, and next milestone in this file after each release. The detailed historical implementation log remains [the engineering report](docs/ROUTING_LAYER_ENGINEERING_REPORT_2026-09-29.md); this file controls what to do next.

**Controlled canary evidence (contract 1.54):** PR #240 merged as `e1083ed`; deploy `37030394652` passed. Protected preflight `37030985041` passed and identified the approved buyer and seller. The scoped-ID deployment `37031172485` passed. Routed Base canary `37031631341` passed with one $0.11 checkout, one leased provider attempt, idempotent plan/reservation/acceptance/delivery, buyer confirmation, $0.10 seller payout, and released capacity. Separate Tempo MPP canary `37031771916` passed with a verified 0.001 pathUSD paid MCP receipt. Public route metrics showed one plan and execution, zero accepted settled routes and zero GMV because this controlled transaction does not qualify as independent evidence. The service catalog returned zero active definitions. Scoped IDs were removed from GitHub production variables and Vercel production configuration; closure deployment `37031917921` passed, production readiness returned ready, and the public service directory returned zero active definitions.

**Provider completion outcome:** Implemented and paid controlled lifecycle passed through PR #245: a provider-operated Node worker retrieves a funded work order, accepts its saved attempt, maintains its lease, durably saves exact private output, resumes delivery after process restart, and leaves review/settlement to the existing buyer APIs. The authorized configured seller/wallets completed one $0.02 checkout, process restart, schema-checked correlated delivery, buyer review, confirmed $0.02 payout, and capacity release in run `37081892752`. The result is controlled evidence and remains excluded from independent completion and autonomous GMV. Final closure evidence is recorded below.

**Previous outcome — released in contract 1.63:** Completed the usable P0.3 evidence gate: explicit buyer evidence/approved-provider requirements, inspectable eligibility and confidence, and authoritative eligibility checks at checkout and funding without inventing spending authority. Bundle the implementation and supporting tests/docs into one PR. Provider claims must not satisfy a requirement for observed or backed evidence. Independent provider participation remains a separate external proof gate; preserve closed rollout until its prerequisites pass. Automatic funding, private artifact expansion, and orchestration follow their existing P0 dependencies.

**Contract 1.55 release:** Funded `leased_v1` work now marks an overdue delivery deadline as requiring attention in the buyer route, buyer/seller order, and seller work-order views. Missing, declined, and expired attempts keep their priority; overdue observation still cannot move escrow or authorize a retry. Operator health and the protected database preflight count funded overdue route deadlines. A read-only `route-operator-audit` mode permits post-canary inspection without requiring another $0.11 buyer balance. The route canary cancels an unpaid reservation if it fails before wallet send starts and preserves a potentially broadcast payment for reconciliation. Focused tests and typecheck passed. Full `pnpm predeploy` passed 289 tests (284 passed, five skipped), production build passed, a copied legacy database migrated twice with 32 migration IDs and integrity `ok`, and five isolated Chromium smoke cases passed. PR #241 merged as `d09a577`; production deploy `37040438765` passed, readiness returned ready, and OpenAPI reported contract 1.55. Protected operator audit `37040942850` passed with 32 migrations, one archived service, one completed route/order and delivered attempt, zero overdue delivery deadlines, zero provider-attempt anomalies, zero failed/overdue webhook or settlement work, and a recent successful webhook heartbeat. No new live payment was made for this release.

**Contract 1.56 release:** Five changes add private aggregate classification, count case-insensitive duplicate EVM owner wallets without printing values, fail closed on ambiguous verified MPP payer identity, align the capped Base canary guard with contract 1.56, and record the prior release evidence. `pnpm predeploy` passed 291 tests (286 passed, five skipped), SDK build, lint, and typecheck; `pnpm build` passed with the existing MPP bundler warning. A copied local legacy database migrated twice with 32 IDs and SQLite integrity `ok`; five isolated Chromium smoke cases passed. PR #242 merged as `dfd618c`; production deploy `37043569657` passed with readiness ready and OpenAPI contract 1.56. Protected audit `37044036762` passed and counted 208 owner values: 158 blank, 16 email-like, 32 valid EVM addresses, two short opaque values, and two duplicate-wallet groups covering four agents. Provider, webhook, and settlement anomaly counts were zero. No payment or production data changed in this release.

**Contract 1.57 release:** The protected owner inventory now counts authoritative `agent_owners` links by coarse category, email-like legacy values that agree with `owner_email`, and shared EVM wallets with multiple linked accounts or incomplete links. No raw value, user ID, or agent ID enters the output. Verified MPP payer identity also requires an exact wallet string and one active, unarchived agent match. Focused privacy and identity tests and typecheck passed. This five-change stack passed `pnpm predeploy` (291 tests: 286 passed, five skipped), production build, copied legacy migration replay (32 IDs, SQLite integrity `ok`), and five isolated Chromium smoke cases. PR #243 merged as `c51b9ee`; deployment `37064224139`, production smoke `37064670553`, and payment monitor `37070631728` passed. Production readiness returned ready, the machine manifest reported 1.57, the service directory had zero active definitions, and assisted/autonomous GMV remained zero. Read-only protected audit `37071309299` passed the settlement reserve preflight and found 32 migrations, one archived service, one completed route/order and delivered attempt, zero provider or outbox anomalies, and a successful webhook heartbeat three minutes old. Its 209-record inventory found 159 blank, 16 email-like, 32 EVM, and two short opaque values. All 15 authoritative links belong to blank records; the nonwallet legacy records and EVM records have zero links. Email agreement is zero and both duplicate-wallet groups have incomplete links. Preserve those values and use verified ownership recovery rather than inferred migration. No payment, legacy value, or ownership link changed.


**First local batch (contract 1.58; change 1 of the next five-change stack):** Service contract readiness is shared across discovery, route planning, saved-route eligibility checks, and direct reservation. Only supported contracted execution and manual/leased provider protocols are eligible. Unsupported or malformed verification policies and required output schemas block checkout; discovery reports `execution_mode_ready` and explicit reasons instead of failing on malformed stored JSON. Capacity reservation compares execution mode, provider protocol, input/output schemas, and verification policy with the checked snapshot. Existing checkout replays remain available after a definition becomes unsupported. A stale saved contract can fall back only before creating an economic order.

Validation: focused route/service/contract coverage passed, including unsupported-mode and malformed-policy/output rejection, changed saved plans, a contract mutation immediately before reservation, concurrent pre-checkout fallback, and existing checkout replay. Full `pnpm predeploy` passed typecheck, SDK build, lint, and 295 tests (290 passed, five skipped). The production build passed with the existing MPP bundler warning. A read-only local database copy migrated twice with 32 migration IDs and SQLite integrity `ok`; five Chromium smoke checks passed against a separate fresh disposable database. Checks used Node 24; the sandbox blocked child processes, so the complete test/build/browser gates were rerun with the required process access. No schema or settlement transition changed. This batch is local on `feat/provider-execution-readiness`; production remains 1.57 and the next production PR awaits the five-change cadence.


**Second local batch (contract 1.59; change 2 of the next five-change stack):** Each newly funded opt-in provider attempt persists a ten-minute `acknowledgment_due_at` with its original creation time. Dispatch replay preserves the ID and deadline. The additive `2026-10-02-provider-acknowledgment-deadline-v1` migration backfills legacy deadlines from `created_at + 600` seconds without changing attempt state or historical timestamps; rollback writes without the field use the same fallback. Late acknowledgment fails closed, while accepted work continues under its separate lease. The authenticated observer records `acknowledgment_timed_out` once, keeps order/route state funded and holds escrow and capacity. Queued timeout does not enter the existing accepted-lease-expiry ranking signal.

Private route, buyer/seller order, and seller work-order views show the deadline and overdue attention before cron. Stale queued notices are suppressed before sending, and dispatch replay cannot notify a new subscription after the deadline. The webhook cron reports `expired_provider_acknowledgments` separately from leases; operator snapshots and the protected preflight count overdue and timed-out funded work awaiting reconciliation. Dispute interrupts timely queued work and preserves an already overdue acknowledgment failure. Conditional observer updates cannot overwrite acceptance committed by another connection. OpenAPI, generated manifests/agent documentation, human guides, the TypeScript provider state, and the capped canary version guard now describe contract 1.59.

Validation: 37 focused timeout, privacy, concurrency, service, operator, and migration cases passed. Full `pnpm predeploy` passed typecheck, SDK build, lint, and 302 tests (297 passed, five skipped). Production build passed with the existing MPP bundler warning. A read-only local legacy database copy migrated twice with 33 migration IDs and SQLite integrity `ok`; all five Chromium smoke checks passed against a separate fresh disposable database, including machine contract 1.59. Work remains local on `feat/provider-execution-readiness`; production remains contract 1.57. The independent provider canary, failure/refund canaries, and automatic funding gates remain open.


**Third local batch (contract 1.60; change 3 of the next five-change stack):** Provider action transactions recover transient SQLite contention with up to six attempts and bounded backoff. Each attempt reads authoritative funding, order/attempt state, and current deadlines again. Acceptance and its linked order/route execution updates roll back together; retry preserves the original queued acknowledgment deadline and stable attempt ID. Already committed acceptance or decline replays idempotently. Exhausted contention returns private `WORK_ATTEMPT_UNAVAILABLE` (503) with `retryable: true` and `state: see_trade`. No money, capacity, or settlement transition changes; infrastructure contention does not become provider-failure evidence.

Validation: 35 focused provider/service cases passed; full `pnpm predeploy` passed typecheck, SDK build, lint, and 306 tests (301 passed, five skipped). The recovery cases inject contention after actual database writes to prove rollback, exhaust the bound and recover the same request, commit acceptance/decline/dispute through another database connection, and expire acknowledgment or heartbeat deadlines before retry. Authorization/state errors and unrelated database failures are not retried. Production build passed with the existing MPP bundler warning. A read-only local legacy copy migrated twice with 33 migration IDs and SQLite integrity `ok`; all five isolated Chromium smoke checks passed with machine contract 1.60. No new migration or live payment. Work remains local on `feat/provider-execution-readiness`; production remains 1.57. The next local work is P0.3 transactional buyer-policy and route-eligibility rechecks identified above; the independent provider canary remains externally gated.


**Fourth local batch (contract 1.61; change 4 of the next five-change stack):** Service reservation enforces any saved buyer policy for principals without an agent identity in the same transaction as capacity, listing, trade, order, and route linkage. Registered agents continue through their existing deployment/buyer-policy checks. Account reservations check provider, capability, rail, verification, approval threshold, and per-execution/daily/monthly budgets against fee-inclusive totals and current checkout exposure. Failures roll back capacity with no economic order. Existing checkout replay precedes policy enforcement, returning its stable order/trade even after policy tightens. Policy configuration remains the existing linked-owner agent API; no new account editor, spending mandate, payment authority, or settlement transition.

Validation: 27 focused buyer-policy/route/reservation cases passed; the completed suite adds seven account reservation cases, including ten policy rejection scenarios, exact spend boundaries, concurrent daily/monthly reservations at different services, a policy committed through another connection after validation, exposure committed by another worker after rollback, saved route policy changes/recovery, and cancelled checkout exposure. Full `pnpm predeploy` passed typecheck, SDK build, lint, and 313 tests (308 passed, five skipped). Production build passed with the existing MPP bundler warning. A read-only legacy copy migrated twice with 33 IDs and SQLite integrity `ok`; all five isolated Chromium smoke checks passed with machine contract 1.61. No new migration or live payment. Work remains local on `feat/provider-execution-readiness`; production remains 1.57. Next implement the route eligibility rechecks above as the fifth meaningful change before opening the production PR.


**Fifth local batch (contract 1.62; now released with the complete stack):** Execution preflight and transactional reservation share route compatibility checks. Reservation reads saved capabilities, requested verification/source minimum, and deadline, rejects incompatible service snapshots, and binds seller identity/capabilities/nullable latency in the capacity update. An internal expected seller ID prevents replacement after preflight. Provider rejection records an ineligible attempt and permits bounded fallback only before checkout; exact existing checkout replay preserves the original trade. Malformed capability JSON/shape is excluded from planning and execution. No financial state transition or new migration.

**Release dependency checkpoint:** PR #244 contains the five routing changes. Its publish audit reported critical Next.js advisory [GHSA-vcvr-r3jv-pc5j](https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j) against installed 16.3.5. An additional P0.1 release-baseline patch updates Next.js and matching lint configuration to the official patched 16.3.6 without changing contract 1.62. Audited image routes use React text with fixed styles and a static PNG; no attacker-controlled SVG pattern from the advisory was found. This is not evidence of a confirmed application exploit. The patched dependency graph passed `pnpm predeploy` (317 tests: 312 passed, five skipped), typecheck, SDK build, lint, production build, and all five isolated Chromium smoke cases. Required CI and production verification were pending at this historical checkpoint; the release evidence below records their completion.

Validation: 45 focused route/service cases passed, including provider changes through another connection after preflight, changes immediately before the transaction, both nullable latency transitions, insufficient verification/source count, single-attempt rejection, concurrent fallback, direct reservation snapshot changes, and existing checkout replay. Full `pnpm predeploy` passed typecheck, SDK build, lint, and 317 tests (312 passed, five skipped). Production build passed with the existing MPP bundler warning. A read-only legacy copy migrated twice with 33 IDs and SQLite integrity `ok`; all five isolated Chromium smoke checks passed with machine contract 1.62. At this local checkpoint, `origin/main` was the production 1.57 base and all five meaningful changes were ready for one PR. Release evidence follows; independent provider evidence remains pending.


**Contract 1.62 release:** [PR #244](https://github.com/trillskillz/clawdmarket/pull/244) merged as `c5fceff9edb5ec7c95278430224de0945f4cd090` after all four required checks passed on final head `bf26f83`: build/browser smoke `37078421251`, contract/build `37078421213`, and both CodeQL analyses `37078418629`. The final Next.js 16.3.6 dependency graph passed local `pnpm predeploy` (317 tests: 312 passed, five skipped), typecheck, SDK build, lint, production build, and five isolated Chromium smoke cases. The copied legacy database migration replay passed twice with 33 IDs and SQLite integrity `ok`. [Deployment `37078816646`](https://github.com/trillskillz/clawdmarket/actions/runs/37078816646) applied the additive acknowledgment migration before building/publishing and passed authenticated alias checks. [Production smoke `37079169243`](https://github.com/trillskillz/clawdmarket/actions/runs/37079169243), [payment monitor `37079203680`](https://github.com/trillskillz/clawdmarket/actions/runs/37079203680), and [read-only protected audit `37079205538`](https://github.com/trillskillz/clawdmarket/actions/runs/37079205538) all passed on that exact merged SHA.

Production readiness was ready, OpenAPI/native manifest reported 1.62, and the audit confirmed 33 migrations, one archived service, one completed route/order and delivered attempt, zero provider/deadline/outbox anomalies, and a successful webhook heartbeat two minutes old. Current production environment names contained none of the three global enable flags or two scoped canary IDs. Public services returned zero active definitions; the existing one plan/execution and zero assisted/autonomous GMV were unchanged. GitHub's open-alert inspection no longer included the critical Next.js advisory; five medium dependency alerts remain for separate baseline review. No new live payment, historical owner-value rewrite, or ownership-link change was made. The protected owner inventory counted 210 records (160 blank, 16 email-like, 32 EVM, two short opaque); owner linkage and collision findings remain unchanged.

**Historical next work after contract 1.62 (superseded by the milestone below):** P0.2 independent opt-in provider completion still requires a consenting provider and separately authorized buyer. Preserve the closed rollout and existing escrow/capacity holds until that evidence is available. Continue the P0.3 evidence and funding-time eligibility audit in a fresh implementation stack; acknowledgment timeout reliability evidence remains separate from accepted lease expiry, and claims alone cannot authorize automatic spending. Independent verification, explicit buyer funding authority, and funded failover remain unfinished. This release-record update is bookkeeping and does not count as a new meaningful implementation change.


**Provider completion implementation checkpoint (before required CI and live acceptance):** The user replaced commit-count releases with outcome-based releases and authorized the configured canary seller/wallets on 2026-10-02. The provider-operated Linux/Node worker fetches one funded work order, accepts its saved leased attempt, renews the lease, saves exact private output with fsync/atomic replacement, and resumes the same delivery after process restart or lost response. Kernel locking prevents concurrent workers sharing the journal and releases on SIGKILL. Provider side effects must use the stable attempt ID for idempotency; computation before output persistence can repeat after a crash. The worker runs on the provider/workflow machine and never funds, reviews, or settles a trade. APIs and machine contract remain 1.62.

Eight real-API integration cases passed, covering separate-process restart, lost acceptance/delivery responses, post-settlement exact replay, interrupted heartbeats, expired deadlines, identity/auth rejection, competing processes, and SIGKILL recovery. Full `pnpm predeploy` passed 325 tests (320 passed, five skipped), typecheck, SDK build, and lint. Production build, all five isolated Chromium smoke checks, and copied legacy migration replay passed (33 IDs, integrity `ok`). The live wallet preflight found a balance below the old $0.11 cap but sufficient for $0.02, so the controlled runner now uses a fixed $0.02 checkout/payout under the existing fee rules and authorization, schema verification, explicit buyer review, and separate provider processes. Required CI, live restart/delivery/payout, flag closure, and post-run audit must pass before recording the outcome complete. See [provider operation](docs/PROVIDER_WORKER.md) and [the canary runbook](docs/ROUTE_CANARY_RUNBOOK.md).


**Provider completion outcome — released and paid controlled proof complete:** [PR #245](https://github.com/trillskillz/clawdmarket/pull/245) merged as `df5434ef3455011cbab0558ec326832062efc0ef` after all required checks passed on head `094775ceab844fe0582ba4fed6fac93451a29726`: build/browser `37081161310`, contract/build `37081161282`, and both CodeQL analyses `37081159962`. Local predeploy passed 325 tests (320 passed, five skipped), typecheck, SDK build, and lint. Production build, five isolated Chromium smoke checks, and twice-replayed copied legacy migration passed (33 IDs, integrity `ok`). Server APIs, financial state machines, and machine contract remain unchanged at 1.62.

[Deployment `37081504540`](https://github.com/trillskillz/clawdmarket/actions/runs/37081504540), smoke `37081790749`, lower-cap protected wallet/provider preflight `37081538955`, and payment monitor `37081872511` passed. [Authorized live canary `37081892752`](https://github.com/trillskillz/clawdmarket/actions/runs/37081892752) proved one $0.02 Base checkout, original saved attempt acceptance, private durable output, provider process exit/restart, correlated delivery, exact receipt replay, schema verification with semantic verification explicitly false, buyer acceptance, confirmed $0.02 seller wallet increase, completed route/order, and released capacity. No second payment was sent. The service was archived. Private identifiers and the payment proof remain in private operations evidence; this report includes aggregate outcomes only.

Both scoped IDs were removed from GitHub production variables and Vercel production configuration. [Closure deployment `37081995899`](https://github.com/trillskillz/clawdmarket/actions/runs/37081995899), [final production smoke `37082311711`](https://github.com/trillskillz/clawdmarket/actions/runs/37082311711), and [final payment monitor `37082386305`](https://github.com/trillskillz/clawdmarket/actions/runs/37082386305) passed on the exact merged SHA. Final environment-name inspection confirmed global flags and scoped IDs absent. Public readiness was ready, contract 1.62 remained stable, service discovery had zero active definitions, and metrics counted two plans/executions with zero independent accepted settlements or assisted/autonomous GMV.

[Protected post-live audit `37082040543`](https://github.com/trillskillz/clawdmarket/actions/runs/37082040543) found 33 migrations, two archived services, two completed routes/orders and delivered attempts, no acknowledgment/lease/deadline/missing-attempt anomalies, no failed/overdue/stuck outbox work, and a successful webhook heartbeat one minute old. Independent provider participation and autonomous end-to-end execution are not established by the controlled canary. The next release must deliver the buyer's evidence requirement and authoritative eligibility at checkout/funding as one capability. Keep this release-record commit local for inclusion with that milestone; it does not justify a separate PR or deployment.


### Buyer provider evidence outcome — contract 1.63, local validation complete

Implemented as one capability on `feat/buyer-provider-evidence`: route/service request and owner policy can require approved providers, economically backed accepted completions and distinct eligible buyer accounts. Request and policy requirements intersect. Candidates expose counts, satisfied requirements, unmeasured quality/confidence and unverified independence. Evidence reads recheck economic proof, buyer-reviewed delivery and current ownership exclusions rather than treating claims as trust.

Reservation enforces requirements transactionally. New EVM intents and unpaid MPP challenges refuse changed eligibility; recovery remains available for existing intents/proofs. Verified funding rechecks current provider contract, public status, payout readiness, route compatibility and buyer requirements/policy. Eligibility rejection commits the original verified receipt with cancellation and capacity release, creates no dispatch and uses the existing full buyer-refund outbox. A duplicate proof rolls back the entire attempted cancellation. Pending refund preparation errors preserve proof/outbox and resume the same payment.

New orders persist a versioned execution contract and request requirements. Work-order reads, dispatch, seller start, webhook gating, delivery verification and future capability events use agreed terms; routes credit only requested capabilities. Null historical snapshots explicitly retain legacy behavior; corrupt recorded snapshots fail closed. Migration 34 is additive, and legacy replay changed no financial records.

Validation: `pnpm predeploy` passed 342 tests (337 passed, five skipped), typecheck, SDK build and lint. Production build passed with the existing MPP/ox bundler warning. A disposable read-only legacy backup migrated twice with 34 IDs and SQLite integrity `ok`; hashes of all original trade, transaction, receipt, transfer and wallet records were unchanged. Isolated Chromium suite passed 34 journeys with three skips, including all five core smoke cases and contract 1.63. Required CI, merge, migration-first production deployment and authorized controlled live verification remain pending at this local checkpoint. Global rollout stays closed. Independent verification, verified buyer independence, automatic funding mandates, private artifacts and funded failover remain open.


### Buyer provider evidence outcome — released and controlled paid proof complete

[PR #246](https://github.com/trillskillz/clawdmarket/pull/246) merged as `937ee4837b6e49122c464ea9acfa6c91ba3c9aa2`. Required checks passed on final head `e9d4e74e621bd0545fa43c4db38ca8b36d8e73d2`: build/browser `37092686645`, contract/build `37092686713`, both CodeQL analyses `37092685247`. Local validation remains 342 cases (337 passed, five skipped), SDK/typecheck/lint/build, 34 Chromium journeys (three skipped), and twice-replayed migration 34 with unchanged financial-row hashes and integrity `ok`.

[Initial deployment `37092896735`](https://github.com/trillskillz/clawdmarket/actions/runs/37092896735) applied migration 34 before building/publishing; smoke `37093145039` passed. Read-only wallet/provider preflight `37092629408` passed. The user-authorized configured pair completed [live run `37093208922`](https://github.com/trillskillz/clawdmarket/actions/runs/37093208922): an unsatisfied backed threshold failed without checkout or money movement, then explicit seller approval and the agreed leased contract were saved for one $0.02 Base payment, provider durable-output exit/restart, correlated schema-checked delivery/replay, buyer decision, confirmed $0.02 seller payout and capacity release. No second payment occurred. The canary service was archived. Private identifiers/proof are retained only in private operations evidence. Controlled work does not establish independent provider evidence, semantic quality or autonomous GMV.

Both scoped IDs were removed from GitHub production variables and Vercel production configuration. [Closure deployment `37093344391`](https://github.com/trillskillz/clawdmarket/actions/runs/37093344391), final smoke `37093594985` and payment monitor `37093664478` passed on the same merged SHA. Environment-name checks found none of the three global flags or two scoped IDs. Final public checks reported ready schema/rails, contract 1.63, zero active services, three plans/executions, zero accepted backed settlements and zero assisted/autonomous GMV. Protected audit `37093431679` found 34 migrations, three archived services, three completed routes/orders, three delivered attempts, no acknowledgment/lease/deadline/missing-attempt anomalies, no failed/overdue/stuck outbox work and a fresh successful webhook heartbeat.

**Previous outcome — private artifact delivery and retrieval (P0.4, contract 1.64):** An authenticated seller can attach multiple bounded private artifacts to one funded order; the buyer can retrieve them with integrity/provenance metadata and required verification before the existing acceptance/settlement decision. Bundle private persistence, authorization, size/media/retention limits, verification linkage, API/SDK/contract documentation and failure-path tests into one capability PR. Keep artifact bytes out of public DTOs and seller code off the app host. Independent opt-in provider proof, benchmarked/semantic quality and verified buyer independence remain open external or later evidence gates; preserve closed rollout. Explicit automatic funding mandates follow P0.5. This release record stays local for inclusion with the next capability; it does not justify another PR.


## 2026-10-02 — Private artifact delivery and retrieval (contract 1.64)

Implemented the next P0.4 outcome as one release bundle: additive migration 35 separates private immutable metadata from encrypted bytes; artifacts link to the original trade parties, service order, route and successful delivery. Authenticated seller uploads require funded work and, for leased work, its accepted active attempt. Exact client-reference replay recovers after delivery/settlement without adding bytes or granting new work. Fresh bounded transaction retries handle contention (503 ARTIFACT_STORAGE_BUSY permits the same reference/body after exhaustion). Cross-connection transactions enforce eight artifacts, 64 KiB each and 256 KiB per trade, including failed output. Canonical base64, SHA-256, safe filenames, supported media/UTF-8/JSON/PDF signature validation, bounded streamed request reads and ten-second deadlines are enforced before storage. URLs are recorded claims only: no fetch, redirect, private-IP resolution or provider code execution occurs. Opaque/PDF files are downloads only; bounded JSON is the sole file verification parser.

Buyer and seller list private metadata and retrieve attachment-only bytes with private/no-store, credential variation, nosniff and sandbox headers. Retrieval verifies the encrypted identity, size and hash and rejects ciphertext swaps or metadata corruption without returning bytes. Provenance remains provider-declared and explicitly unverified. Retention is at least 90 days from upload, holding unfinished/disputed trades. The existing authenticated cron deletes expired terminal-trade payloads in bounded transactions while retaining metadata and evidence; expired retrieval returns 410. Keep the configured chat encryption secret stable or re-encrypt payloads before rotation; artifact encryption uses a separate domain.

Deliveries attach distinct immutable artifact IDs and optionally select one private JSON object for the agreed saved schema/source-list checks. Required checks plus file identity/hash/size are rechecked before opening existing buyer review; private JSON is not copied into artifact_json, messages or verification evidence. Invalid checks record failure without consuming the active attempt or advancing escrow. Corrected output can succeed. Integrity-failure diagnostics retain historical failures independently of a later passed check on repaired storage. Actual buyer confirmation releases the existing escrow once; buyer dispute records disputed review and freezes release. Exact delivery replay still works after settlement. The provider worker journals output before upload, resumes stable attempt/index references after uncertain responses, records each receipt and submits the same final body without recomputation. SDK upload/list/delivery/download helpers and contract 1.64 document the whole flow; SDK downloads independently enforce size/hash and use the configured origin. Operator preflight now requires 35 migrations and reports aggregate missing payload/purge anomalies without private content.

Local validation: final predeploy passed 352 tests (347 passed, five skipped), typecheck, SDK build and lint. Production build passed with the existing MPP/ox warning. The real authenticated API/DB tests cover ownership, CSRF, cross-trade denial, byte/media/hash limits, independent-process quota contention, failed/corrected JSON, private retrieval, tamper evidence, terminal replay, retention hold/purge, explicit acceptance and dispute with unchanged settlement APIs. Worker tests cover prepared restart and an upload response lost after storage, with one computation and two attachments. Read-only legacy backup migrated twice to 35 IDs, integrity ok, and hashes of all original financial rows unchanged. Isolated Chromium suite passed 34 journeys with three skips, including the artifact contract and unauthorized access checks. Required CI/merge/deployment remain pending at this checkpoint.

Live prerequisite: protected read-only wallet/provider preflight [37094952617](https://github.com/trillskillz/clawdmarket/actions/runs/37094952617) found buyer Base USDC 0.005573, below the existing 0.02 canary requirement. It stopped before checkout/payment; no new funded live artifact order was attempted. Do not top up from another wallet or retry payment without an authorized source and fresh preflight. Global rollout remains closed. This implementation is controlled/local proof, not independent provider or autonomous GMV evidence.

Remaining P0.4: bounded structured assertions, source recency/claim links, isolated code/static-analysis adapters where supported, and explicit semantic/independent-verifier acceptance contracts. Existing auto-confirm behavior remains unchanged and records skipped review rather than buyer acceptance. Do not mark all P0.4 complete or claim hash/schema/source-list checks prove truth. The next usable outcome is an agreed, versioned assertion/source-evidence contract that can fail, correct and remain inspectable on private JSON before review; bundle its API/SDK/docs/tests in one PR. Automatic funding mandates still follow P0.5.

The contract 1.64 canary is ready to check two private attachments, buyer download hash/size/linkage/private headers, anonymous denial and selected JSON verification before its existing confirmation/payout step. Its real provider handler passed local worker integration against the saved output schema. The paid production artifact run remains pending solely on the recorded buyer funding prerequisite.


## User-approved follow-up — Funded artifact canary, then global rollout

User instruction on 2026-10-02: use whichever configured wallet can cover the required funds; if none is usable, save the work for later. A later user instruction supersedes wallet spending: preserve sufficient funds for normal site payments and do not use more. No transfer, top-up or paid canary is authorized now; renewed explicit spending authorization is required before resuming this funded task. Preserve escrow and settlement reserves; use the existing $0.02 Base run and its original proof/reference recovery, not a larger payment, a swap/bridge or repeat payment after an uncertain result.

- [ ] After renewed explicit spending authorization, obtain usable signing access for a suitably funded configured source, or a funded existing buyer wallet. The protected buyer preflight measured 0.005573 USDC with adequate ETH. Read-only configured wallet inspection found treasury 0.02 USDC / 0.000100205551108468 ETH and seller payout 0.24 USDC / 0.000000609901032321 ETH. These balances are not proof of unencumbered funds. Local production exports contained no readable wallet signer values, and the process environment had no wallet keys; the buyer signer is restricted to the protected canary workflow. No transfer was made. Check current balances, gas and liabilities again before funding.
- [ ] Use the existing temporary canary identities, deploy scoped access at the released SHA, and run `payment-canary.yml` mode `run-routed-base` once after fresh preflight. Contract 1.64 exercises provider restart, two private attachments, buyer retrieval/hash/size/authorization, required JSON verification, explicit buyer confirmation and the existing payout/capacity release. Reconcile the original trade/proof if uncertain.
- [ ] After successful funded verification and operator/payment-health checks, enable the three global service/planning/execution flags at the same released SHA, remove temporary canary identities, deploy and verify global availability. The user's instruction explicitly authorizes this rollout follow-up; do not ask for the same approval again. Workflow/automatic spending mandates remain outside these three flags. Controlled canary evidence remains excluded from independent provider and autonomous GMV evidence.

**Saved for later:** funded live artifact verification and global rollout require renewed explicit spending authorization plus usable signing access/funding. The user has instructed no more wallet spending; retain all balances for normal site payments. Finish the artifact release independently; keep global flags closed until the funded check can complete. No bookkeeping-only PR is needed. The next code outcome remains the P0.4 bounded assertion/source-evidence contract.

## Artifact release — protected merge checkpoint

PR [#247](https://github.com/trillskillz/clawdmarket/pull/247) merged as `f0aa80effbe9879369d30c6b2d951927bd91445e` from exact final head `ddaad149796e03de9f9c2bb38e0e4c472fa0a8e9`. Required final-head checks passed: build/browser `37095989390`, contract/build `37095989311`, and both CodeQL analyses `37095986840`. The CI quota test now exercises bounded client recovery with the same reference/body after the documented 503 response; it still asserts exact deduplication and the final byte/count quota. Migration-first production deployment `37096343743` is in progress. This release record remains local for inclusion in the next capability.


## Latest user constraint — Local work, no additional PRs

The user instructed "do not push PR" after #247 merged. All subsequent work must remain local; do not push, create another PR, or merge more changes without explicit renewed publishing authorization. The current release had already merged and its deployment was underway. Remaining release/payment verification is read-only with respect to funds, and no additional wallet spending is authorized. The saved funding/global-rollout follow-up remains deferred.


## Latest clarified publishing cadence — 10 completed plan parts, one PR

The user clarified the publishing instruction: **10 completed plan parts, bundled into one PR**. Finish at least ten substantive plan parts locally, with their acceptance criteria and evidence, before any further remote push/PR. At that threshold, one bundled PR containing all the parts, tests/contracts/diagnostics/docs is authorized. Do not count commits, test cases, file edits or bookkeeping as plan parts. This overrides earlier release cadence and the temporary blanket no-PR instruction.

**Current next batch: 7/10 completed plan parts (local).** PR #247 was already merged/deployed before this instruction and belongs to the previous batch. Release evidence and saved TODOs do not increment the counter. Current local branch `feat/tempo-buyer-authority` starts from released main `420fc89`; P0.4 verification, P0.5 buyer funding, P0.6 orchestration and P0.7 confirmed-refund failover are acceptance-complete within their supported adapters. Next is P0.8 route metrics/monitoring; paid production canaries and independent provider evidence remain externally gated. External participation and funded production proof remain separate prerequisites. Preserve the independent instruction **do not use more wallet funds**: no additional transfer, top-up or paid canary without renewed explicit spending authorization. Funded verification/global rollout is saved for later. Read-only site payment-health checks are permitted.


## Artifact release — production verification complete

Production deploy [37096343743](https://github.com/trillskillz/clawdmarket/actions/runs/37096343743) succeeded on released SHA `f0aa80effbe9879369d30c6b2d951927bd91445e`, including additive migration before build/publish and alias verification. Automatic same-SHA production smoke [37096609448](https://github.com/trillskillz/clawdmarket/actions/runs/37096609448) passed. Read-only protected audit [37096705559](https://github.com/trillskillz/clawdmarket/actions/runs/37096705559) passed: 35 migrations; three archived services, three completed routes/orders and three delivered attempts; zero private artifacts (no new paid artifact run); zero missing/purged-payload/overdue-retention anomalies; all provider/deadline/missing-attempt/terminal anomalies zero; settlement failed/stuck and webhook retrying/failed/overdue all zero; worker heartbeat succeeded four minutes earlier. Settlement gas reserve checks passed without a transfer.

Public verification returned readiness ready, complete database, healthy Base (8453) and Tempo (4217) RPCs, contract 1.64 and both artifact API paths. Anonymous artifact inventory/download both returned 401. No active reusable services are listed; assisted/autonomous GMV remains zero. No additional transfer, top-up or paid canary occurred and no global rollout flags were enabled. Funded artifact proof/global rollout stays deferred under the user's no-more-wallet-spending instruction. All subsequent edits are local, the next 10-part batch remains 0/10, and no further PR/push is authorized before ten acceptance-complete parts. This release evidence is local bookkeeping and does not count as a plan part.


## Local batch part 1/10 — Bounded assertions and declared source evidence (1.65)

Acceptance complete locally: services and route requests agree on strict version-1 assertions and source-evidence contracts bounded to 8 KiB. Exact offered assertion rules and stronger source count/age/link requirements are enforced by shared planning/reservation checks. Saved execution snapshots preserve agreed checks even after service edits. Literal field equality/membership/number/length comparisons never evaluate paths, regex or code. Structured source records have bounded unique IDs/URLs, real UTC dates, server-time recency and nonfuture checks; bounded claims link only to known source IDs. Legacy workspace source minima still apply. All metadata remains provider-declared: URLs are never fetched; semantic and provenance verification remain false.

Required checks rerun inside the transaction before review opens. Failed checks retain escrow and accepted attempts, record private-safe diagnostics, and allow correction. An identical future-dated body can later pass while retaining the original rejection; existing passing metadata attaches to the committed delivery rather than disappearing on a uniqueness conflict. Evidence contains public rule IDs/statuses, aggregate counters, server time and agreed-policy fingerprints, without private values, URLs, statements or declared dates. Buyer-only confirmation uses the existing settlement path once; legacy auto-confirm behavior is unchanged in this part. API categories, OpenAPI/agent contract, TypeScript types and provider/verification guides are aligned at local 1.65.

Validation: targeted delivery/policy tests 23/23 and route planning tests 17/17 passed. Full Node 24 `pnpm predeploy`: 358 cases, 353 passed, five skipped; typecheck, SDK build and lint passed. Production build passed with the pre-existing MPP/ox warning. No migration, deploy, remote push, live payment or wallet transfer occurred. This is one substantive completed part, not completion of all P0.4. Next: explicit semantic acceptance gates, preserving dispute rights and legacy orders, then externally isolated verifier adapters where supported. The funded live proof/global rollout remains saved for later under the no-spending constraint.


## Local batch part 2/10 — Explicit buyer acceptance gate (1.66)

Acceptance complete locally: an optional strict version-1 `acceptance: {mode: "explicit_buyer"}` contract is matched at planning/reservation and saved on the economic order. Definition edits cannot remove the gate; historical null snapshots retain legacy terms. Delivery enters review without an auto-confirm timer. Buyer confirmation requires passing required checks bound to the committed delivery/content hash. Account-balance finalization checks the buyer decision in its release transaction; external payout creation and queued transfer processing check before side effects. Missing evidence/corrupt snapshots fail closed with a stable private code. No deterministic score or evaluator can supply the explicit buyer decision. Buyer dispute rights and existing operator resolution/recovery remain authoritative.

Owned route/order/verification snapshots expose acceptance mode, review and attention. Cron holds explicit work and retires stale timers from older writers, avoiding repeated competition with ordinary payment maintenance. Actual API/DB tests exercise overdue holds, service edits, seller denial, tampered evidence, correction/confirmation, one ledger release/capacity release, blocked outbox creation/preparation, legacy skipped review, buyer disputes and corrupt saved contracts.

Validation: focused acceptance/privacy/payout tests passed; final gate adds four acceptance API cases and one policy case. Node 24 full `pnpm predeploy`: 363 cases, 358 passed, five skipped; SDK/typecheck/lint passed. Production build passed with the existing MPP/ox warning. No migration, live payment, wallet transfer, deploy or remote push. This is the second completed substantive part; independent verifier authority and externally isolated code/static checks remain unfinished. Isolation inventory found bubblewrap/user namespaces usable on the development machine; the Docker socket is inaccessible. Next work must use an explicit external verifier runner with resource/network/filesystem limits and honest report provenance, never execute provider code in the application process.


## Local batch part 3/10 — Buyer-approved external isolated checks (1.67)

Acceptance complete locally: immutable service/order policy binds a designated active verifier, canonical suite hash, supported JavaScript adapter and runtime. Current authoritative owner links exclude known buyer/seller shared ownership at planning, reservation, funding, private access and delivery; missing ownership fails closed. This does not prove real-world independence. Mandatory explicit buyer review prevents verifier/model-only release.

Buyer-created ten-minute grants bind one private code artifact and encrypted bounded suite; at most eight jobs per trade. Only the designated verifier receives active inputs. Reports bind code/suite/policy hashes and counts. Completion/revocation/expiry erases suite ciphertext; role/scoped-key restrictions, conflicts and exact report replay preserve privacy and recovery. The provider can pause after durable upload, then resume its original attempt/journal with the agreed report without recomputation. The external worker saves its exact report before submission and recovers a lost response without retrieving private input again. Additive migration 36 and aggregate operator diagnostics cover grant retention/expiry. API/OpenAPI/agent and TypeScript contracts plus operation guides align at 1.67.

The external runner uses bubblewrap namespaces and systemd scopes, no network/host home/secrets, read-only inputs, 128 MiB memory with zero swap, 32 tasks, one CPU quota, bounded runtime/output and whole-scope cleanup. A trusted launcher validates effective kernel controls before sandbox startup; there is no host execution fallback. Expected test outputs stay outside the untrusted sandbox. Supported checks are finite JSON function cases and syntax checking only; reports are authenticated remote attestation with app-observed isolation and semantic verification explicitly false.

Validation: final focused real-runner/API/provider suite 19/19 passed, including host-file/environment/loopback denial, native-memory/output/runtime limits, correction followed by explicit buyer review and one ledger release, revocation/expiry/owner changes/read-only credentials, actual provider pause/resume and uncertain report recovery. Node 24 full predeploy with real isolation enabled: 374 cases, 369 passed, five skipped; typecheck/SDK/lint passed. Production build passed with existing module-type/MPP bundler warnings. Migration test replays all 36 IDs twice over its legacy fixture. No deploy, GitHub push, wallet access, transfer or paid production run. Local batch is 3/10; paid canary/global rollout remains saved for later. Next: P0.5 buyer mandates/prepaid authority, preserving authoritative payment/escrow/recovery.


## P0.5 local checkpoint — Buyer mandate and atomic funding boundary (1.68; not counted)

Implemented immutable owner-created route payment mandates with private inspection/revocation, stable request references and saved objective/input/capability/verification/provider/deadline scope fingerprints. Terms bind aggregate/per-execution/retry ceilings, approved sellers, latency, selected-provider data sharing, expiry and one operational rail/chain/token/payer/treasury. Explicit buyer acceptance is required. Named route execution credentials now require payments:write; read-only keys cannot authorize or reserve. Once saved, mandate restrictions cannot be omitted at execution.

Economic reservation atomically commits one order, aggregate authority exposure and a unique durable funding step. Current owner/expiry, policy/evidence and payment terms are checked before new intent permission. Funding rechecks current deployment and immutable organization attribution budgets, without counting the same reservation twice. Matching verified funding records the original step/receipt once. Revoked/expired authority or mismatched payer retains a verified proof for existing cancellation/refund reconciliation; revocation never deletes an uncertain intent or resets exposure. Additive migration 37, private APIs, OpenAPI/agent contract, SDK types/methods and aggregate financial invariant diagnostics are implemented.

Validation at the checkpoint: final full predeploy passed 383 cases (378 passed, five skipped), with SDK/typecheck/lint and real verifier isolation enabled. The final eight mandate API cases passed, including successful funding persistence, payer mismatch, CSRF, ownership/scope checks, rollback, concurrency and revocation/late-proof recovery. Focused routing/migration/auth/SDK suite passed 32/32 before those final two cases. Production build passed with existing warnings. All payment fixtures use dummy accounts and trusted/mock proof boundaries; this is not live chain evidence.

Remaining acceptance work: buyer-operated EVM/MPP worker with reserve/gas enforcement, durable exact signed transactions/credentials before submission, shared-wallet concurrency controls, uncertain-submission and process-restart recovery, and full worker-to-existing-funding API integration. P0.5 is not done; local completed-part counter stays **3/10**. No push/deploy or additional wallet spending. See [buyer mandate operation](docs/BUYER_PAYMENT_MANDATES.md).

## P0.5 local checkpoint — Immutable EVM transaction claim and private buyer journal (1.69; not counted)

The buyer-only `POST /api/trades/{id}/fund/evm/claim` accepts bounded exact signed transaction bytes and the existing payer attribution signature. It recovers the signer and checks legacy/EIP-1559 chain/nonce/token/treasury, zero native value, exact ERC-20 transfer amount and maximum execution gas cost against the immutable mandate/intent. Current authority, checkout expiry, payment pause and existing service/buyer/deployment/organization eligibility are rechecked inside the claim transaction. The immutable claim and intent hash/signature commit together before buyer submission. The server never broadcasts or receives a signing key. Raw signed bytes are omitted from claim responses. API/SDK/machine contract and private operation docs describe these semantics.

Additive migration 38 enforces one claim per intent, permanent chain/payer/nonce uniqueness, and one unconfirmed claim per chain/payer across routes. Exact replay can only authorize the same bytes. Revocation, expiry and terminal state preserve the original claim while removing send permission; plain cancellation and uncertain HTTP/RPC outcomes never release its wallet hold. Only matching trusted verified-receipt persistence marks the claim confirmed, including late-proof refund reconciliation. Aggregate diagnostics detect claim/intent/scope/receipt inconsistencies and fail the protected release preflight without exposing identifiers. A claim whose private bytes are lost remains held for recovery rather than generating a replacement transaction.

Buyer reserve helpers account for outstanding uncertain authorizations. Private journal helpers enforce a 64 KiB bound, owner-only directory/file modes, no symlink reads, fsync of exact bytes, atomic replacement and directory sync. Callers must still hold the shared kernel wallet lock and validate journal scope. Execution gas bidding is capped; Base/OP data/operator fees are separate and cannot be represented as a hard immutable total-fee cap by this claim. Full fee preflight remains a worker prerequisite. The disposable schema helper now preserves partial-index conditions, matching the production migration instead of incorrectly locking confirmed wallets forever.

Validation: full Node 24 predeploy passed **389 cases (384 passed, five skipped)**, including real verifier isolation, typecheck, SDK build and lint. Final focused claim/journal/reserve/SDK tests passed **21/21** after the last immutable-claim field checks. Production build passed with existing module-type/MPP warnings. Migration replay applies all **38 IDs** twice over its legacy fixture. Tests use dummy signers, disposable databases and trusted/mock proof persistence; no live chain transaction is claimed as evidence. No wallet access, spending, deploy, push or PR.

Next: integrate these helpers and the server claim into the buyer-operated funding worker. Persist exact signed EVM bytes/MPP credentials before any external submission, enforce the shared wallet lock and reserve floors with all fee preflight, recover lost intent/claim/broadcast/funding responses using the original payment, and test actual worker processes/restarts against existing funding APIs. Audit MPP pull credentials before server broadcast, so revoked/expired authority cannot send a new payment during proof verification. P0.5 remains unfinished; completed plan parts remain **3/10**. Paid production proof/global rollout stays deferred under the user's no-spending instruction.

## P0.5 local checkpoint — Buyer-operated EVM funding and process recovery (1.70; not counted)

Implemented `scripts/buyer-worker.mjs` with privately pinned approval/mandate terms and one durable operation UUID per route payment. Additive migration 39 binds that operation to the original EVM intent; a lost intent response can recover the same operation, while legacy/manual or conflicting operations cannot be adopted. Operation-bound intents require the immutable signed claim before proof submission. The buyer-only SDK exposes canonical intent creation/inspection and funding verification without signing or broadcasting.

The worker fsyncs exact signed bytes and attribution proof before its claim, then fsyncs possible-submission state before RPC. A Linux kernel wallet lock and private active-payment journal serialize routes/origins sharing one chain/payer/state directory. Timeout, process death, revocation, rollout closure and pending confirmation retain the original hash/order/exposure. Only matching verified receipt persistence releases the local wallet hold; known transactions are not broadcast again. Plan-only approval performs only owned route inspection. Prepare-only saves exact bytes without claim/broadcast. Existing buyer acceptance, provider execution and settlement remain authoritative downstream.

Ethereum/Sepolia and Base/Optimism fee adapters validate chain identity, use pending balances, and enforce token/native reserve floors before claim and broadcast. OP preflight includes execution gas plus buffered current data/operator fee estimates; missing estimates fail closed. These controls cannot guarantee future rollup fees or serialize manual wallet activity outside the shared state. Closing production route execution removes fresh claim/send permission while retaining proof recovery. Private keys remain buyer-host environment inputs; they never enter application requests, journal, lock helper or output.

Validation: final Node 24 predeploy passed **401 cases (396 passed, five skipped)**, with typecheck, SDK build, lint and real external verifier isolation. Focused buyer-worker/claim/mandate/migration/SDK suite passed **30/30**. Actual local API/database and controlled JSON-RPC tests cover lost intent/claim/broadcast/funding responses, same-operation replay, an actual CLI process killed after claim commit, separate-process prepared restart, shared-wallet contention/SIGKILL release, delayed confirmation, revocation, closed rollout, legacy intent rejection and reserve/all-fee/wrong-chain guards. Production build passed with existing module-type/MPP warnings. Migration replay applies **39 IDs** twice. These are dummy-wallet tests, not live chain or independent provider proof. No wallet access, spending, deploy, GitHub push or PR.

Next: finish MPP/Tempo fee/reserve terms and buyer durable pull-credential recovery, with current authority checked before server broadcast and original on-chain hash retained for late-proof/refund reconciliation. P0.5 remains unfinished and the completed-part counter remains **3/10**. Orchestration (P0.6), funded retry (P0.7), paid production proof and global rollout remain pending; paid work is deferred under the user's no-spending instruction.

## Current priority release — navigation, cleanup and backed balances (2026-10-03)

The user moved this capability ahead of routing and explicitly authorized publishing the finished changes to GitHub and Vercel. This replaces the ten-part gate for this release. Historical no-spending/no-push statements above describe earlier checkpoints; preserve normal-site wallet reserves for the reauthorized minimal verification. Resume unfinished P0.5 after this release.

Implemented desktop/mobile Network navigation to Why ClawdMarket and Proofs; removed the unused genome endpoint and its randomized ghost scores while preserving required registration/lineage history and inbound redirects. Human and agent accounts now have separate integer USDC-backed prepaid credit, exact authenticated deposit proofs and globally unique shared payment receipts, idempotent agent funding, connected/configured wallet balance reads, credit purchase/escrow/settlement/dispute integration, scoped-agent and buyer/organization policy enforcement, SDK and native contract 1.72. Historical balances stay disabled; withdrawals are not implemented. Additive migration 40 and operator credit-conservation diagnostics accompany the implementation.

Validation: complete predeploy passed **424 cases (416 passed, eight skipped)** with typecheck/SDK/lint; real kernel-isolated verifier checks passed **2/2** separately. Desktop/mobile Network navigation and obsolete API checks passed **3/3**; desktop/mobile lost-wallet-response credit recovery passed **2/2**, with exactly one transfer request across reload and confirmation. Final build/browser and protected release outcomes are being recorded in the capability release evidence below. This release does not complete P0.5 or authorize global routing.

## P0.5 local checkpoint — MPP broadcast authority and recoverable chain proof (1.71; not counted)

Audited installed mppx 0.9.3's split validation/broadcast behavior. Marketplace signed pull credentials can broadcast during verification; a credential's presence cannot bypass current spending permission. The route now checks current checkout/deadline/payment pause/eligibility/rollout before accepting pull, and a marketplace-only SDK adapter rechecks current permission after validation at its broadcast boundary using the verified signer. Automatic mandate pull remains explicitly closed with `MPP_MANDATE_PULL_NOT_READY` pending durable Tempo credential/fee-token authority and wallet concurrency. Platform API MPP charging retains its existing adapter.

Manual marketplace challenges now bind the trade ID with its required canonical 32-byte memo. `Payment-Authorization` preserves account/agent authentication; legacy Payment-in-Authorization callers retain cookie/CSRF or agent-key identity. Bounded/malformed/conflicting credentials fail closed. The funding route records the SDK's verified canonical on-chain receipt hash and signer instead of a raw signed credential or unverified source string. Unknown RPC errors omit private signed authorization bytes from SDK/route logs.

Added optional buyer-only `{tx_hash, payer_address}` JSON proof recovery and SDK `verifyBuyerMppFunding`, with matching machine/OpenAPI/private operation docs. It reads the configured Tempo chain and checks canonical mined block, receipt success, actual payer, exact configured pathUSD/treasury/amount and trade-bound memo. It never broadcasts. This reconciles a receipt consumed by SDK deduplication before application commit, as well as expired/cancelled or policy-rejected paid checkouts. Matching late proof records one original receipt and queues one full refund through the existing outbox; it cannot dispatch a revoked order or create a replacement payment. The HTTP recovery request leaves transfer execution to the existing outbox worker.

Validation: final Node 24 predeploy passed **410 cases (405 passed, five skipped)**, including typecheck, SDK build, lint and real verifier isolation. Focused MPP/payment/mandate/SDK/contract suite passed **41/41**; final MPP/provider-eligibility regression suite passed **23/23**. Eight API cases use actual server SDK/route/database against a controlled dummy JSON-RPC endpoint, with no signing/broadcast RPC permitted: canonical challenges, actual receipt hash, legacy cookie/CSRF compatibility, forged/bounded/conflicting credentials, consumed-before-commit recovery, pending/wrong chain/payer/token/recipient/value/memo/reverted proofs, permission lost during simulation, cancelled/expired pulls, revoked mandate recovery, one refund and no provider dispatch. Production build passed with existing module-type/MPP warnings. No additive migration; ledger remains **39 IDs**. No real wallet access/spending, deploy, GitHub push or PR. Completed parts remain **3/10**.

Read-only production check on 2026-10-03: `/api/payments/config` returned 200 with new payments already **unpaused**, EVM/MPP trade payments configured, and internal credit disabled; `/api/health/ready` returned 200/ready. This establishes advertised availability, not a new funded settlement proof. The user reauthorized necessary wallet payment verification while preserving normal-site reserves. The newer priority instruction moved the implemented account-credit/navigation release ahead of this routing work; see its current-priority section.

Next: explicit Tempo fee-token/reserve terms, privately pinned durable exact pull credentials, server claims/shared-wallet concurrency, and unknown-submission/process-restart recovery through these guarded funding APIs. Manual MPP SDK deduplication is not the complete buyer worker protocol. P0.5 remains unfinished; then P0.6 orchestration and P0.7 reconciled funded retry. Global routing remains closed until acceptance gates and backed evidence are satisfied.

## Protected payment reserve preflight — 2026-10-03

Read-only run [37141148900](https://github.com/trillskillz/clawdmarket/actions/runs/37141148900) passed the settlement-gas-reserve step, then stopped before any wallet side effect: configured Base canary buyer has **0.005573 USDC**, below the **0.01 USDC** minimum, with **0.002753001248135033 ETH**. No funds were spent or moved. Save the new live deposit/credit purchase proof until a dedicated buyer has sufficient USDC beyond normal-site reserves; do not fund it from settlement/backing wallets. This follows the user's instruction to save an unfunded run for later.

## Final local release gates

Final production build passed. Complete Chromium browser/API matrix passed **39 tests, three retired legacy journeys skipped**. The matrix verifies actual HTTP empty-body route execution, exclusion of historical credit from spendable totals, desktop/mobile navigation, deposit recovery across a lost wallet response/reload with exactly one send, and existing onboarding/auth/dashboard/marketplace flows. Required predeploy remains **416 passed, eight skipped**; real isolation separately **2/2**. One capability PR contains the implementation, previous saved local work, native contract and migration. Global routing stays closed and P0.5 remains unfinished.

## P0.5 local checkpoint — Explicit Tempo fee authority and signed-byte inspection (1.73; not counted)

New MPP mandates require immutable fee-token address, fee-token reserve and maximum fee cost in integer token units. Initially payment and fees both use configured six-decimal pathUSD; swaps/sponsorship and mutable wallet fee preferences are excluded. Historical MPP records retain their original fingerprint and private inspection/recovery. The reserve helper subtracts principal, rounded maximum fee and uncertain outstanding amounts from one shared balance before checking both floors. Fee conversion matches the installed Viem Tempo implementation.

Exact signed Tempo inspection independently recovers the root secp256k1 signer and checks canonical unsponsored 0x76 bytes, chain, payer, regular nonce, explicit fee token, bounded validity, one zero-native transferWithMemo with exact treasury/amount/trade memo and rounded fee cap. Unsigned, sponsored, sender-injected, noncanonical, delegated-key and extra-call envelopes cannot gain permission. Expired original bytes remain inspectable for recovery; fresh send checks still belong to the server claim. No RPC or real wallet is used by these helpers. API/SDK/machine contract terms align at local 1.73.

Validation: 36 focused mandate/MPP/fee/SDK/contract cases plus two real dummy-signature inspection cases passed; typecheck, SDK build and focused lint passed. No migration or deployment for this checkpoint. Automatic MPP mandate pull remains closed, global routing stays closed, and P0.5/completed-part count remain unfinished (3/10). Next: immutable Tempo intent/claim records, current authority at server broadcast, shared-wallet holds, and durable buyer credential/process recovery through existing funding and refund APIs.

## P0.5 completed local outcome — Buyer EVM/Tempo funding and original-payment recovery (1.74; part 4/10)

A privately pinned owner mandate now funds exactly one selected order on either supported external rail through the existing payment/escrow APIs. No-mandate worker invocation only reads the plan. The Tempo worker saves one operation before intent reservation and fsyncs exact root-signed unsponsored 0x76 bytes, canonical hash and original challenge credential before claiming/submitting. Explicit same-token fee/reserve terms, independently recovered signatures, regular nonce attribution, shared Linux wallet locks, database wallet holds and current policy/mandate checks bound the payment. No remote signing, filling, sponsorship or swaps are accepted.

The guarded SDK transport rechecks authority after its final simulation immediately before exact RPC submission, records first submission before the effect and disables transport retries. Unknown responses and process death recover only the original transaction. A known pending transaction cannot cause another pull. SDK-consumed proof before application commit is recovered by hash. A late original payment after revoked authority enters one existing refund outbox. Only matching verified receipt persistence confirms a claim; cancellation and timeout retain uncertainty. Migration 41 adds immutable private Tempo intent/claim records; readiness requires these tables and operator diagnostics report aggregate anomalies. API/OpenAPI/agent skill/SDK/human payment docs agree on contract 1.74.

Validation: 61 focused financial/authorization/migration/SDK/contract cases passed, including 11 Tempo worker cases and actual SIGKILL/restart. Full Node 24 predeploy passed 445 cases (437 passed, eight skipped), typecheck, SDK build and lint. Production build passed with the existing MPP/ox warning. Actual Chromium/HTTP smoke passed 6/6 on a disposable local database, including owned plan/inspect/cancel, native contract 1.74, authentication/dashboard/webhooks and public discovery. The browser fixture exposed missing composite primary keys in the test-only schema helper; the helper now includes declared composite keys and the corrected browser fixture passed. Readiness/migration replay includes all 41 additive IDs.

This is the fourth substantive completed routing part in the current local batch; commits and evidence bookkeeping do not increment it. New routing work stays local until ten completed parts are bundled into one PR. No wallet access, live payment, transfer, push or deployment occurred. Paid credit/routing proofs remain saved for a sufficiently funded dedicated buyer, preserving site reserves. Next: P0.6 orchestration with hash-bound explicit buyer decisions, authoritative settlement, exactly-once capacity release and privacy-safe backed route receipts; then reconciled funded retry.


## P0.6 completed local outcome — Orchestration and backed private route receipts (1.75; part 5/10)

The buyer route worker now funds the selected checkout through the durable EVM/Tempo adapters and advances the existing funded dispatch, provider, verification, explicit buyer decision and settlement lifecycle. It retrieves private results and checks authenticated artifact byte counts/SHA256 before accepting the current delivery hash. Checked decisions are fsynced before submission; worker death or an unknown response reuses the original decision and payout outbox. Provider handlers remain outside the application. The shared existing trade confirmation transaction checks the expected delivery hash before committing acceptance. Observation cannot invent buyer approval. Delayed payouts remain settling with capacity held; terminal settlement releases capacity exactly once.

Migration 42 adds one immutable private receipt per route/trade. Completion requires original exact funding plus confirmed matching payout, current accepted delivery, terminal route/order and recorded capacity release. Fabricated completion flags return financial_uncertainty without a backed receipt. Receipt hashes link objective/input/result, selected service/protocol, attempts, price/fee/total, rail, artifacts, verification categories, decision and financial references without raw private contents or ownership addresses. Semantic/provenance/benchmark evidence and application-observed remote isolation remain explicitly unproven. Private route lifecycle/result APIs, scoped authorization, SDK/OpenAPI/agent/human docs and aggregate receipt diagnostics agree on native contract 1.75. See [buyer route orchestration](docs/BUYER_ROUTE_ORCHESTRATION.md).

Validation: full Node 24 predeploy passed 452 cases (444 passed, eight skipped), typecheck, SDK build and lint. The production build passed with existing MPP/ox warnings. Lifecycle cases exercise the actual buyer/provider/funding/verification/settlement handlers against a dummy loopback chain: complete artifact retrieval, corrupt artifact rejection before payout, duplicate completion, pending payout, lost acceptance response, real separate-process SIGKILL after settlement, exact receipt/capacity recovery, corrupted receipt diagnostics and forged completion without financial proof. Runtime migration replay includes 42 IDs. Actual isolated Chromium/HTTP smoke passes 6/6, including private route reads and no-funds observation. The browser checks use a separate cookie-free context for anonymous reads and accept Next's added max-age=0 header.

This completes substantive part five of the ten-part local routing batch. No wallet funds, transfer, push or deployment were used. Production remains 1.72; funded proofs and global rollout remain deferred. Continue P0.7: preserve prior economic attempts and prove their confirmed refund/reconciliation before any approved fallback checkout, with gross aggregate/retry budgets and durable recovery.


## P0.7 completed local outcome — Confirmed-refund funded failover (1.76; part 6/10)

An original mandate with multiple economic attempts and positive retry authority can now move the buyer route worker from a failed provider to a saved approved fallback after all prior money and capacity are reconciled. Existing dispute/refund authority remains authoritative. A retry requires exact original funding, terminal full-buyer refund/resolution, confirmed matching refund to the original payer from treasury, no seller-payout instruction, released capacity and confirmed wallet claims. Missing receipts, unpaid cancellation, timeout, split/seller resolution and pending/mismatched refunds fail closed. The existing full-buyer distribution returns seller principal and retains platform fees; cancelled late transfers return the entire verified checkout. All checkout amounts still consume cumulative gross aggregate/retry limits.

Migration 43 appends separate retry funding steps and a persisted objective deadline without rebuilding the original one-step table or changing payment history. Reservation repeats reconciliation, linkage, provider exclusion, every required capability/verification threshold, exact price, mandate/owner/current policy, economic attempt and saved-candidate ceilings, budgets and remaining deadline inside the existing capacity/order transaction. Funding rechecks current retry policy/deadline before send permission. The deadline retains original funding milliseconds and does not restart after fallback. Buyer/provider/route views and operator checks share it.

The route worker fsyncs the retry operation before reservation and archives the prior trade/decision. Funding journals and exact signed hashes remain separate for each operation and use the existing wallet lock; a route journal kernel lock prevents competing processes from replacing that operation. Process death and uncertain responses recover the saved operation/order/hash. A previous decision cannot accept fallback output. Private attempts and the final backed receipt now link economic orders, intent/receipt/refund/payout references, gross spend, capacity releases and failure categories. Aggregate audits detect retry proof/link corruption without exposing payment values. Buyer-only/scoped/CSRF-protected retry APIs, SDK, OpenAPI, generated agent skill and human docs agree on 1.76. See [funded failover](docs/FUNDED_ROUTE_FAILOVER.md).

Validation: full Node 24 predeploy passed 462 cases (454 passed, eight skipped), typecheck, SDK build and lint. Production build and six isolated Chromium/HTTP checks passed. Runtime migration replay includes all 43 IDs. Actual loopback-chain cases prove Base and Tempo provider failure → confirmed original refund → fresh approved fallback funding → external delivery → explicit hash-bound decision → one final confirmed payout/receipt. Tests include late original funding after cancellation, pending refund, repeated proof, wrong refund destination/amount, refund/payout collision, gross budget boundaries, current buyer policy, original deadline, concurrent retry APIs, competing buyer processes and a real SIGKILL after retry reservation. Capacity and original financial records remain exactly once. A build/type-generation race required ordered gates; final checks passed after the build finished.

This is substantive part six of the ten-part local routing batch. No push, deployment, wallet spending, transfer or top-up occurred. Production remains 1.72. P0.8 paid canaries and independent provider proof remain saved until their prerequisites are available; global routing stays closed. Continue useful P0.8 work now: honest durable automation evidence, route funnel/latency/utilization/verification/retry/refund/origin metrics and aggregate operator alerts. Do not mark P0.8 or the entire plan complete from local fixtures or publication alone.


## P0.8 completed local metrics outcome — Durable automation evidence and aggregates (1.77; part 7/10)

New plans persist authenticated channel and deployment cohort atomically. Client headers only suppress production attribution. The first explicit registered-agent acceptance records current delivery evidence inside the existing financial acceptance transaction, only with original durable wallet claims. Completed receipts carry that evidence; manual acceptance and completed replay cannot acquire it later. Public metrics v2 require original origin/decision/claim/receipt agreement, delivered leased work, exact confirmed external financial links and linked owners without known shared ownership. Controlled and historical origins remain excluded. This measures execution evidence; it does not claim independent identities or semantic truth.

Funnel and backed latency/capacity/verification aggregates remain distinct. Financial outcomes include every mandate-linked attempt, including original refunded providers; exact payment/refund destination, raw amount, token/chain/rail, terminal buyer disposition, capacity release and confirmed transfer are required. Malformed labels collapse to allowlisted unknown aggregates; no IDs, addresses, owners, keys or objective/result content enter public metrics. The TypeScript SDK includes metrics and optional receipt automation fields for legacy compatibility. [Metrics guide](docs/ROUTE_METRICS.md) describes the supported definitions.

Validation: full Node 24 predeploy passed 466 cases (458 passed, eight skipped), typecheck, SDK build and lint. Production build passed with existing MPP/ox warnings. Disposable migration replay passes 44 additive IDs. Isolated Chromium/HTTP smoke passes 6/6 for contract 1.77; the first run exposed an old `not_implemented` smoke expectation, which was updated to the new evidence-gated v2 contract. Real local buyer/provider/funding/refund/payout handlers prove positive eligibility and exclusions for shared ownership, missing first decisions, pending payouts, changed receipt evidence, retrospective production promotion and corrupt refund destinations. These use dummy loopback rails and are not live canary proof.

This is substantive local part seven. No push, deployment or wallet funds were used. P0.8 as a whole remains open: next implement durable routing-only financial admission controls and monitoring, then continue independent work through the plan while paid production canaries and independent provider participation remain gated. Production remains 1.72 and global routing stays closed.


## P0.8 completed local control outcome — Financial admission and monitoring (1.78; part 8/10)

Routing now has durable admission control separate from ordinary marketplace payment controls. Initial/fallback capacity/order transactions recheck the hold; fresh EVM/Tempo intents, exact claims and guarded Tempo broadcast authority honor it. Original checkout replay and verified hash/receipt recovery bypass only the routing hold. Current mandate/policy/deadline checks remain authoritative. Existing provider dispatch/delivery, explicit buyer decisions, payout/refund outboxes and exactly-once capacity release continue. No payment or settlement state machine was replaced.

Migration 45 adds private control/event tables, healthy observation progress and revision-bound operator history. Authenticated five-minute webhook cron inspects exact exposure/step/claim/retry/receipt/credit invariants plus stale claims, uncertain routed transfers and overdue missing receipts. Financial uncertainty or inspection failure persists a hold; missing control storage denies fresh authority without stopping reconciliation. Production also requires a recent, nonfuture observation. Automatic database reopening requires at least three healthy samples spaced 30 seconds apart over a continuous 120-second window; rapid calls, failures, stale history or future timestamps cannot satisfy it. Environment pause and closed rollout still win. Administrator GET/POST control uses account auth, strict bounded input, rate limiting, cookie CSRF, optimistic revision checks and private no-store responses; unhealthy/environment-held resume is rejected. Actor IDs remain only in the private event table.

Operator snapshots and the existing hourly monitor expose fixed aggregate alerts for financial incidents, admission holds, stuck reservations/expired checkouts/inactive authority, provider acknowledgment/lease/deadline anomalies, missing/terminal attempts, verification backlog, outbox failure/age and worker freshness. Monitor inspection failure is reported alongside ordinary payment checks. Routing notifications contain fixed codes/counts, with no account/operator IDs, hashes, private content, endpoints or stored error strings. Protected read-only preflight shares financial inspection without writing controls. Native manifest, OpenAPI, generated agent instructions and human/SDK guides agree on local 1.78. See [routing admission and monitoring](docs/ROUTING_ADMISSION_CONTROL.md).

Validation: final Node 24 predeploy passed **486 cases (478 passed, eight skipped)**, typecheck, SDK build and lint. Production build passed with the existing MPP/ox dependency and module-type warnings. A read-only backup of the existing local database migrated twice with **45 IDs** and SQLite integrity **ok**; a separate clean browser database was initialized and migrated. Actual isolated Chromium/HTTP routing and core smoke passed **6/6** on contract 1.78. Financial fixtures use dummy loopback rails, never live wallets. Cases cover a separate connection pausing after checkout preflight, transactional rollback/contended retry and retained events, concurrent admin revisions, CSRF/privacy, stale/future/missing monitors, failed inspection with continuing cron recovery, original stale Tempo claim/proof recovery, fresh EVM authority denial, a pause during final Tempo simulation, original paid proof recovery on both rails, provider delivery/review while held, pending payout/capacity recovery, and confirmed original refund with blocked fallback exposure. The full suite also retains existing crash, retry, financial and privacy gates.

This completes substantive local **part eight of ten**. No push, PR, deployment, live wallet spending, transfer or top-up occurred. Production remains 1.72. P0.8 as a whole is still open: paid routed/failure/timeout/refund canaries and independent provider proof require their saved external prerequisites. Preserve ordinary site reserves and closed global routing. Next independent local work follows **P1.1 metered instant execution** with a separate payment lifecycle and duplicate-call billing/receipt acceptance gates; it cannot substitute for outstanding P0 production proof. Bundle publishing only after the ten completed-part gate.


## P1.1 completed local outcome — Metered instant credit sessions (1.79; part 9/10)

Instant providers publish bounded offers under `/api/instant/services`; buyers explicitly prepay a provider-bound deposited-credit session with a saved reference, expected cent price, expiry and `schema_v1` automatic acceptance. Each asynchronous call holds one unit; only a selected-provider result satisfying the frozen output schema atomically moves that unit into provider credit and persists its private result/receipt. Session funding and refunds are idempotent; duplicate calls/results across concurrency and an application restart cannot bill twice. Provider worker tokens are saved before claim, stored only as digests and never exposed. A failed or expired call never redispatches or charges. Closing prevents fresh calls, cancels unclaimed work and returns unused budget after claimed work finishes or reaches its original deadline. Provider execution stays outside the web application.

Limits are explicit: whole cents, 1–100 cents per successful call, at most $100 prepaid per session, a one-hour maximum session, a 60-second maximum call deadline, 1,000 call records per session, bounded payloads and provider capacity. This is successful-call metering, not tokens/time/sub-cent billing or an MPP/Tempo channel implementation. Schema acceptance validates structure/types, not semantic quality; required buyer review or unsupported provider evidence rejects authority. Organization-assigned agents fail closed until instant organization attribution exists. Provider proceeds remain nonredeemable deposit-backed credit; this version has zero platform fee and does not enter contracted routed GMV.

Existing buyer and agent policies count full open session authority across UTC resets and conservatively count closed-session spend at closure. Historical wallets cannot fund it. New session/call authority checks financial admission and payment controls; exact replay, previously claimed results and unused-credit refunds survive holds and rollout closure. Production instant writes default closed behind their own explicit flag. Wallet reads expose prepaid/held session credit separately. The aggregate financial audit includes session balances in deposit-backed liabilities, reconciles unit holds, funding/refund/sale entries and receipts, and detects orphan/corrupt instant evidence. The protected retry cron reconciles bounded expired calls/sessions without stopping ordinary webhook/provider recovery on instant failure. Machine contract, OpenAPI, generated skill, TypeScript SDK, site API guide and [lifecycle guide](docs/INSTANT_EXECUTION.md) describe the same authority and acceptance boundaries.

Validation: Node 24 full predeploy passed **507 cases (499 passed, eight skipped)**, typecheck, SDK build and lint. A read-only copy of the legacy local database migrated twice with **46 IDs** and integrity **ok**. Cases cover concurrent funding/call/result/closure replay, fresh-process receipt recovery, schema/lease/privacy/CSRF/scope failures, failure/replacement/capacity/budget limits, original-deadline expiry and refunds during holds, contract edits, policy changes, agent ceilings, organization rejection, production rollout closure, accounting/receipt corruption and SDK uncertain-response recovery. The older quota fixture now loads the real additive session schema because quota totals include prepaid authority. Final production build passed with the existing MPP/ox dependency and module-type warnings. Isolated Chromium/HTTP checks passed **7/7**, including concurrent duplicate submissions, one result receipt, private reads, one unused-credit refund and buyer/provider wallet balances. Site docs and native discovery agree on 1.79. The final documentation/browser adjustments also passed focused lint. No live chain, wallet transfer, top-up, rollout enablement or production deployment occurred.

### Latest GitHub publishing instruction — 2026-10-04

The user explicitly requested: “once done with this push changes to github and then continue the plan.” Instant validation completed and the bundle was committed/pushed as `9ebf589` to [feat/routing-and-instant-execution](https://github.com/trillskillz/clawdmarket/tree/feat/routing-and-instant-execution). Continued into **P1.2 authenticated A2A routing writes and durable tasks**, completed below. This supersedes the earlier ten-completed-part gate for that GitHub push. It does not enable instant/global routing, fund production canaries or spend normal-site reserves. Paid P0 proof retains its saved external prerequisites. No production deployment is part of this feature-branch push.


## P1.2 completed local outcome — Authenticated A2A routing tasks (1.80; part 10/10)

The public A2A 1.0 card retains its three read-only skills and advertises authenticated extended discovery. GetExtendedAgentCard adds route_work/cancel_route only to active registered-agent bearer keys holding agent:read, marketplace:write and payments:write. The transport independently checks all scopes; account tokens and cookies cannot grant A2A authority. The legacy compatibility manifest is preserved. Fresh production writes default closed under CLAWDMARKET_A2A_ROUTING_WRITES_ENABLED, alongside existing route flags/admission. Original task reads, checkout recovery and canonical cancellation remain available during closure.

A fresh route_work objective records durable intent before calling the canonical planner, derives a stable route reference and returns INPUT_REQUIRED for linked-owner authorization. Continuation pins a valid saved canonical mandate and calls the existing execute handler, preserving current owner, provider, buyer/agent/organization policy, budget, deadline, attempt and atomic reservation checks. It reserves an unpaid checkout only. Buyer wallet funding, external provider execution, explicit delivery-hash acceptance, dispute/refund authority and settlement stay with their existing workers/APIs. The adapter never creates payment authority, signs, broadcasts, accepts output or replaces economic state machines.

Migration 47 adds retained route/task bindings and an immutable message namespace shared with read-only skills. Exact-message replay and a fresh application process recover the same task and route; changed input/context/route/mandate cannot replace its intent. Live GetTask/ListTasks refresh private canonical lifecycle and status instead of relying on an earlier completed snapshot. Completion requires current financial proof and the original backed receipt; private output is returned only to the owning agent. Cancellation of planned work is idempotent, funded work is rejected, and unpaid cancellation retains INPUT_REQUIRED/payment_unknown until the original payment is reconciled. Terminal tasks cannot reopen; exact saved-message replay returns current state and terminal next_action is none.

Limits are explicit: streamed JSON at most 16 KiB, ten sends/minute and sixty reads/cancellations/minute per agent, and at most 100 retained routing tasks per agent in this pilot. The fixed cap bounds live list refresh and exact status-filter totals without purging financial links. Read-only artifacts retain their seven-day window; message IDs cannot be reassigned after expiry. A2A ErrorInfo and typed SDK errors retain task/funds-state recovery metadata. Native manifest, OpenAPI, generated skill/llms text, SDK, site guide and [A2A guide](docs/A2A_ROUTING.md) agree on 1.80. The isolated Playwright server enables A2A for fixtures; production defaults are unchanged.

Validation: final Node 24 predeploy passed **519 cases (511 passed, eight skipped)**, typecheck, SDK build and lint. Final focused checks passed **41/41**, including the terminal-task/private-artifact adjustments, and final typecheck/focused lint passed. Production build passed with existing MPP/ox dependency and module-type warnings. A read-only legacy backup migrated twice with **47 IDs** and SQLite integrity **ok**. Actual isolated Chromium/HTTP smoke passed **8/8**, covering authenticated extended discovery, durable plan/replay, private task/route reads, live listing, canonical cancellation and the instant/core regressions. The financial test reserves through A2A, drives real buyer/provider handlers against a disposable loopback chain to one confirmed payout/private receipt, rejects funded cancellation, replays the original handle and refuses completion after payout proof is removed. Other cases cover concurrent authority replay, foreign-resource privacy, each missing scope, expired/revoked authority, current policy rejection, production closure, cursor/live timestamp filtering, retained-task limits and actual fresh-process recovery of a partially bound intent.

This completes substantive local **part ten of ten**, following the authorized part-nine GitHub push. No live wallet spending, top-up, production deployment, rollout enablement or new independent-provider proof occurred. Production remains 1.72 and the saved P0 paid acceptance prerequisites remain open. Next independent implementation is **P1.3 MCP Tasks**: the current initialize response still pins protocol 2024-11-05 and advertises discovery/tools only. Upgrade protocol/transport first, then add authenticated shared-router task submission, result retrieval and safe cancellation while preserving existing tool/payment compatibility.

## Prioritized activity update — publication gates complete locally

Public, unarchived registrations now appear whether active or awaiting activation, with profile links in the newest 50 recorded events. Registry and legacy agent-account queries retain up to 50 registrations with stable newest-insertion ordering; private/archived profiles and their improvement names remain hidden. The feed refreshes every five seconds independently of statistics/payment telemetry, so another panel's failure cannot prevent registrations appearing without a reload. The bounded scrolling feed is announced as an accessible live log.

The current routing PR's CodeQL finding was resolved by using the server-assigned durable task ID as the A2A route replay reference. The task remains saved before planning; fresh-process recovery reuses the same route without hashing an authenticated identity.

Validation: Node 24 predeploy passed **520 cases (512 passed, eight skipped)**, typecheck, SDK build and lint. Final focused A2A/activity checks passed **29/29**, and final registration ordering checks passed **11/11**. Production build passed. Isolated Chromium/HTTP smoke passed **10/10**, including actual owner-claim and autonomous registrations appearing without reload while both telemetry APIs return 503. Additive migration replay evidence remains 47 IDs with SQLite integrity ok; this update introduces no migration or financial transition. Commit/push, fresh required GitHub checks, merge, migration-first Vercel deployment and actual production verification follow before P1.3 implementation.


## 2026-10-08 — Live activity registration priority

PR #249 merged as `d9b62f7c5f816f87446c030cec87ebd6bb933e08`; migration-first Vercel deployment [37209338676](https://github.com/trillskillz/clawdmarket/actions/runs/37209338676) and production smoke [37209779948](https://github.com/trillskillz/clawdmarket/actions/runs/37209779948) passed. Current read-only production checks confirm registration events and healthy readiness with account credit, Base and Tempo enabled. Global routing/instant/A2A flags and wallet spending constraints remain unchanged.

The user's latest clarification prioritizes registrations at the top of Live activity. The newest ten public registrations (including legacy agent accounts) retain space even when fifty newer trade/rating/improvement events exist; remaining slots contain the latest other records, without duplication. Selected registrations sort first, newest first, followed by other events newest first. Privacy/archival filters, profile links, accessible live announcements and independent five-second refresh remain in effect.

Reviewed the remaining PR inventory: #231 conflicts with the now-released public surfaces, #200 removes legacy key recovery and has failed gates, and #163–173 are stale dependency proposals (several would downgrade released dependencies). Preserve the established exemption for old/unnecessary PRs rather than bundling them into this capability. P1.3 MCP Tasks remains the next independent plan milestone in the original checkout.

Validation: Node 24 `pnpm predeploy` passed **521 cases (513 passed, eight skipped)**, TypeScript, SDK build and lint. Production build passed with the existing MPP/ox dependency warning. Actual local Chromium/HTTP coverage passed: both owner-claim and autonomous registrations appeared as the first feed item without reload while telemetry returned 503. No migration or financial transition changed. Publish this capability through fresh GitHub gates and migration-first Vercel deployment, then continue the isolated P1.3 MCP implementation.


## New local batch part 1/10 — MCP routing Tasks (1.81)

Implements P1.3 as one capability: protocol negotiation preserves 2024-11-05/2025-03-26/2025-06-18 clients while 2025-11-25 exposes experimental Tasks. Authenticated task-augmented route_work persists intent before shared planning; get_route_task exposes private owner/funding/review steps, and continue_route binds canonical owner authority to exactly one unpaid checkout. MCP and A2A use separate retained task namespaces over the same router. The adapter cannot sign, broadcast, accept delivery or settle money. New MCP production writes default closed, independently of existing routing flags and financial admission. Exact replay, private reads and safe cancellation remain recoverable during closure.

Migration 48 retains task bindings/terminal protocol status and bounded result-stream cursors. Requested TTL is overridden with unlimited task retention and a 100-handle pilot cap. Lists are private, live and cursor-paged. Reads require agent:read; writes also require marketplace:write and payments:write. Streamed input is bounded to 16 KiB and per-agent quotas remain enforced. Only a plan without checkout can reach MCP terminal cancellation: once any checkout exists, refuse cancellation rather than hiding late-payment uncertainty. Current backed financial proof is required before private completed output is returned, even after a terminal protocol status has been saved.

Results wait for terminal state over SSE. Fifteen-second connections issue durable cursors retaining the original RPC ID, expire after fifteen minutes, and revalidate active authority before private output. Disconnect never cancels economic work. Browser Origin validation includes preflights; the shared proxy delegates MCP OPTIONS to its handler, and CORS accepts protocol/resumption headers. Legacy tool charges and authenticated free planning/inspection remain intact. Native manifest, OpenAPI extensions, generated skill/llms text, site guide and [MCP guide](docs/MCP_ROUTING_TASKS.md) describe the same lifecycle and recovery bounds.

Validation: Node 24 full predeploy passed **532 cases (524 passed, eight skipped)**, TypeScript, SDK build and lint. After the final browser-preflight fix, focused MCP/CORS coverage passed **22/22**, lint and the production build passed, and actual Next.js Chromium/HTTP coverage passed **6/6**, including Origin rejection, allowed protocol/resumption preflight headers, deferred SSE result and same-RPC-ID GET resumption after terminal cancellation. The official MCP SDK also creates, polls and automatically reconnects to results. Financial integration drives one canonical buyer/provider loop on a disposable loopback chain, checks original receipt/output/capacity release, and withholds output after payout proof is removed. A legacy backup migrated twice with **48 IDs**, SQLite integrity **ok**, and readiness/migration regressions passed **8/8**. No live wallet spending, new rollout flag or future-plan push occurred. The local branch includes the separately validated activity release after its merge.

**Publishing counter: 1/10 completed substantive parts after PR #250.** Keep this entire batch local until ten parts pass their acceptance gates. Next is P1.4: audit the remaining contract/TypeScript recovery gaps and add a minimal Python client with typed financial errors. Outstanding paid P0 canaries and independent provider evidence retain their external prerequisites.


## User priority — visible MPP payment proofs and backed account balance (1.82; local part 2/10)

The user clarified that successful tested MPP payments were missing from Proofs,
not that the recent Base trade receipts should be relabeled. Historical production
MCP canaries 37031771916 and 35904776952 each paid 0.001 pathUSD on Tempo. Their
public transaction hashes, exact recipient/asset/value, successful canonical
receipts and block timestamps were independently verified read-only on 2026-10-08.
`/proof` now shows these genuine platform payments above completed work, with MPP,
Tempo/pathUSD, transaction and test-evidence links. This history creates no trade
or financial ledger entry. Future SDK-verified paid MCP calls durably save their
payment receipt before tool execution, including tool errors; fake/pending
receipts are excluded. Historical and durable records deduplicate by hash.

Work cards and receipt details show the funding receipt's actual method, with
selected-rail fallback only when no receipt exists. Conflicting evidence cannot
claim verified work settlement. Completed credit purchases now expose their
recorded purchase, settlement and seller-credit evidence consistently.

Account balance means deposited USDC-backed `credit` across listings, task
workspaces, enabled reusable services and standalone milestone contracts. New
contracts reserve integer cents and fees atomically; per-milestone release,
refund, split, cancellation and expiry use the same reservation. Existing funded
wallet contracts retain their original path, while unbacked historical balances
cannot fund new ones. Payment holds, cookie CSRF, payment scopes, buyer/agent
ceilings and immutable organization attribution apply. Shared spend snapshots
include funded contracts. Task credit funding now immediately reports held
balance instead of an external checkout. Contract UI/config and public/native
payment documentation agree; contract is 1.82. The additive contract migration
is ID 49 and readiness checks its columns.

Validation: final Node 24 `pnpm predeploy` passed **542 cases (534 passed, eight
skipped)**, including typecheck, SDK build and lint. The production build passed.
Actual Chromium/HTTP checks passed **11/11** at 1440/390 px for both historic MPP
proofs, enabled balance contract funding with legacy ledger disabled, connected
wallet/deposit recovery and core flows. Additional rendered fixtures verified
MPP/EVM/credit labels, credit-backed badges and conflicting-receipt exclusion;
fixtures were removed. Migration replay passed **49 IDs**, SQLite integrity
**ok**. Financial fixtures verify concurrent funding, multiple milestone releases,
original cancellation/expiry refunds through payment holds, dispute splits,
legacy escrow completion, cross-contract escrow isolation, buyer/agent/organization
limits, durable MPP proof deduplication and a real server-SDK verified paid MCP
call without signing or broadcasting RPC. An initial quota fixture lacked the new
contract fields; it was corrected and the final full suite passed. One early
migration check also used the local development database's default target and
applied additive schema updates; remaining checks used explicit disposable
URLs. No production database mutation, new live payment, GitHub push, PR or Vercel
deployment occurred. This is **2/10**; keep the batch local until ten substantive
parts are complete. Next routing work remains P1.4 SDK/contract recovery parity
and the minimal Python client. Automatic route mandates retain external payment
terms; existing rollout flags remain unchanged.


## P1.4 — shared-contract recovery clients (1.83; local part 3/10)

TypeScript adds private webhook subscription/history/disable recovery and canonical
work-order/service-order inspection. Both funding rails retain original intents,
claims and hashes; HTTP 202 late refunds remain processing. API errors preserve
the full private payload, financial state and Retry-After. Artifact stream failures
remain typed and financially unknown; polling deadlines now bound in-flight fetches.
Webhook HMAC helpers authenticate exact raw bytes, with durable receiver delivery-ID
deduplication explicitly required because the signature has no signed expiry.

The stdlib-only Python 3.11+ client supports route/mandate/lifecycle/retry recovery,
both external funding rails, private artifacts/delivery and webhook recovery. It
refuses redirects, bounds reads, verifies artifact size/SHA256 and never retries
mutations, signs or broadcasts. It runs directly through PYTHONPATH; installation
metadata includes contract.json and py.typed. This environment has no pip, so a
wheel-install check was not performed. Both clients consume generated definitions
from the canonical agent contract. Predeploy checks drift and runs Python tests.
The compatibility identity schema/manifest now include backed credit; the MPP
descriptor shares the free routing-tool list. Generated skill/llms text describe
the same recovery bounds. Existing A2A/MCP lifecycle and write gates are preserved.

Validation: Node 24 full pnpm predeploy passed **550 cases (542 passed, eight
skipped)** plus **12 Python HTTP recovery cases**; SDK build, typecheck and lint
passed. The production build passed with existing dependency warnings. **Eleven
distinct Chromium/HTTP checks passed**, including both actual clients recovering
their original plans, private webhook reads and cancellation without checkout,
MCP Tasks, both MPP history proofs at 1440/390 px, backed-balance contract controls
and core smoke. Two stale hard-coded browser version expectations were replaced
with the canonical version and the final public-discovery recheck passed. The
legacy migration test replayed all **49 IDs** twice; the fresh browser database
was explicitly initialized/migrated separately. No production mutation, wallet
spend, push, PR, deployment or rollout flag change. Logs: /tmp/clawdmarket-sdk-
predeploy-final.log, sdk-build.log, sdk-python-final.log, sdk-browser.log and
sdk-browser-contract-final.log (all with the clawdmarket prefix).

**Publishing counter: 3/10.** Continue P1.5 locally. Initial audit found raw
capability-event counts could outlive their backing evidence, and basic format
challenges write :verified profile tags consumed by public discovery filters.
Next acceptance-complete capability should make public capability confidence and
proof filters derive from current backed completion evidence, while distinguishing
format checks from independently measured quality. Preserve historical records,
existing settlement and canonical capability matching. Independent benchmark
quality and paid production evidence remain separate gates; do not fabricate
evidence or count an audit as another completed part.


## P1.5 — current-backed capability proof discovery (1.84; local part 4/10)

Registry “With completed work proof” and compatibility verified=true filters now
share the same current-backed predicate as capability profiles and routing provider
requirements, including identical row/count filters. Exact delivery hash, completed
order/rail, external funding total and confirmed payout chain/token/business key/
amount are required. Credit requires exact purchase, buyer escrow release and
seller-credit entries. Legacy ledger escrow semantics remain explicit. No new RPC,
financial transition or historical event deletion occurs during discovery.

Known owner-linked buyers collapse to one breadth principal. Self/shared-owner,
direct reciprocal completed trades, reference providers and known nonproduction
route cohorts do not count. Unknown ownership and longer cycles remain unresolved;
buyer breadth does not prove independence. Repeat purchases cannot elevate
capability confidence above low while independent quality is unmeasured.

Basic format challenges no longer write :verified profile tags; historical tags
remain stored but confer no proof. Responses explicitly identify practice evidence,
null measured quality and no routing eligibility. Summary word counts are computed
from the actual text. Ownership and concurrent-submission checks remain enforced.
Canonical contract/OpenAPI/skill/llms and generated client metadata agree on 1.84.
See [capability evidence](docs/CAPABILITY_EVIDENCE.md).

Validation: Node 24 full predeploy passed **559 cases (551 passed, eight skipped)**
and **12 Python HTTP cases**, including SDK drift/build, typecheck and lint. Final
focused financial/auth/capability checks passed **53/53**. Final production build
passed. **Twelve distinct isolated Chromium/HTTP checks passed** across actual
client recovery, MCP Tasks, MPP proofs, backed balance and core smoke; the final
capability-proof case also passed at 1440/390 px without overflow. Representative
legacy migration replay passed twice with **49 IDs**; this part adds no migration.
Logs: /tmp/clawdmarket-capability-predeploy.log, capability-focused-checkpoint.log,
capability-build-final.log, capability-browser.log and capability-browser-final.log
(all with the clawdmarket prefix). No production mutation, wallet spending, push,
PR, deployment or rollout change.

**Publishing counter: 4/10.** The latest user priority is complete locally: the
marketplace defaults to “Hireable with payout wallet”, including its server-rendered
first page, client filtering and pagination. “All listed services” remains selectable.
The API and first-render rows/counts share their payout-readiness predicate. This
small default change is not a separate substantive part. Thirteen catalog/payout
integration cases, focused lint, production build and five actual Chromium/HTTP
checks passed, including a newly created listing excluded before payout setup,
visible after opting into all listings, and visible by default after payout setup.
MPP proof and backed-balance checks passed at 1440/390 px. Logs are under
/tmp/clawdmarket-ready-default-{tests-final,build,browser}.log. No publishing.
Continue P1.5: audit existing peer benchmark authorization/provenance before
adding independent benchmark quality. Hierarchy, independently evidenced benchmark
results, calibration and verifier adapters remain unfinished; no audit or label
alone counts as another completed capability.


## P1.5 — evaluator-bound peer benchmark recovery (1.85; local part 5/10)

Audit found that any active agent could score another agent's pending benchmark,
public lists serialized raw test materials, and peer scores wrote agent quality/
velocity caches. This capability replaces that path with attributable immutable
peer evaluations, private inspection and original-request recovery. It does not
claim to complete independent benchmark quality or the broader P1.5 milestone.

Creation binds its authenticated active creator as the only evaluator. A persisted
UUID client_reference recovers the original ID/state with the same canonical body;
changed reuse conflicts and other evaluators have separate reference namespaces.
Original creation recovery survives later target privacy/owner changes without
creating new authority. Only the original evaluator can score. Current self,
shared-owner, reference, inactive and archived participant checks are enforced in
the scoring transaction. Concurrent exact score replay returns the same immutable
result; altered score/output/notes conflicts. Database uniqueness and guarded
updates are authoritative across servers; local keyed locks reduce contention.

Public lists return allowlisted metadata for public active unarchived targets.
Input/output/rubric/notes, recovery references and evaluator bindings are omitted.
The new private detail endpoint requires the target, recorded evaluator or their
current linked owner; ownership transfer removes the former owner's read access.
Private responses are no-store, and inaccessible reads/scoring return 404. Named
mutations require agent:write. Legacy creators are not inferred from historical
scorers; unknown-author pending records cannot be adopted. Historical rows and
cached scores are retained without migration rewrites.

Peer scores no longer write agent benchmark/velocity aggregates, completion
proofs, marketplace trust or route ranking. Machine/profile/leaderboard/lineage
DTOs and the profile UI explicitly label historical scores as reported assertions,
with unverified independence and null measured quality. Legacy benchmark/velocity
sorts remain sorts of those labeled reported values. Native manifest/OpenAPI,
skill/llms actions, generated client metadata and human docs agree on contract
1.85. See [peer benchmark authority and privacy](docs/PEER_BENCHMARKS.md).

Validation: Node 24 predeploy passed **568 cases (560 passed, eight skipped)** plus
**12 Python HTTP cases**, SDK drift/build, typecheck and lint. Focused benchmark/
privacy/readiness/migration/contract checks passed **30/30**. Production build
passed. **Fourteen isolated Chromium/HTTP cases passed on a fresh local database**,
including actual peer creation/replay, private inspection, denied foreign scoring,
no quality inflation, marketplace default/all-listings/payout setup, both client
recoveries, MCP Tasks, MPP proofs and balance controls at 1440/390 px. The first
browser run exposed a stricter framework cache header and shared fixture quota;
the assertions/fixture registration identities were corrected without relaxing
production limits. Migration **50 IDs** replayed twice over legacy data, retaining
private inputs/scores/scorers while leaving unknown evaluator/reference fields null;
the unique index exists and SQLite integrity is ok. Logs are under
/tmp/clawdmarket-peer-{focused-checkpoint,predeploy,build,browser-final}.log,
peer-typecheck-final.log, peer-lint.log, peer-browser-schema.log and
peer-browser-migration-final.log (all with the clawdmarket prefix).

**Publishing counter: 5/10.** All work stays local; no push, PR, deployment, wallet
spending or global rollout change. Next local P1.5 capability is explicit capability
hierarchy discovery: distinguish navigation families from purchasable leaf IDs,
let agents/humans browse family descendants through canonical discovery, preserve
exact leaf capability/evidence/mandate matching at checkout and funding, and verify
private-profile, alias, pagination and false-inheritance boundaries. The current
flat category field and the legacy research alias are not an implemented hierarchy.
Independent benchmark definitions, trusted graders/attestations, calibrated quality,
additional verifier adapters and longer-cycle/unknown-owner independence remain
unfinished. Peer assertions cannot substitute for any of those acceptance gates.


## P1.5 — explicit capability hierarchy discovery (1.86; local part 6/10)

Humans can browse the registry by nine named capability families. Agents can read
`GET /api/capabilities/hierarchy`, resolve explicit family IDs separately from leaf
IDs, and filter public agent lists/search or reusable services by `family`. Keyword,
semantic, completed-work-proof and exact-service-capability filters compose with
family discovery. Rows and counts use identical predicates, bounded pages and
stable ID tie-breaks. Changing the family/search aborts old requests and hides
pending semantic results; late pages cannot append agents from the previous family.

Families classify the existing canonical leaves without changing the flat catalog.
`family:research` is a navigation family; the historical `research` alias remains
`web-research`. Stored claims match explicit known leaf IDs/labels/aliases after
case folding and trimming, including canonical spellings of those known terms.
Family claims, verified-tag suffixes, substrings, malformed JSON, scalar/object
claims and nonstring entries grant no descendant membership. Public visibility,
active status, archive checks and private owner/credential exclusions remain intact.
Unknown families and invalid pagination fail before searching.

Service definitions, route requirements and allowed/blocked spending capabilities
reject family IDs. Exact canonical leaf matching remains authoritative at planning,
reservation and funding; changing a provider to a sibling skill cannot fund or
execute the originally agreed work. An already verified late payment remains
recorded exactly once for refund recovery while the order is cancelled, dispatch
is suppressed and mandate exposure stays reserved. Accepted completion proof does
not inherit to siblings or family IDs. Independent quality remains unmeasured.
Native manifest/OpenAPI/skill/llms, generated client metadata and human docs agree
on contract 1.86. See [capability families](docs/CAPABILITY_HIERARCHY.md).

Validation: Node 24 final predeploy passed **575 cases (567 passed, eight skipped)**
plus **12 Python HTTP cases**, SDK drift/build, typecheck and lint. Production build
passed. **Seventeen isolated Chromium/HTTP checks passed on a fresh local database**,
including real family-filtered registrations in keyword/semantic modes at desktop
and 390 px, aborted stale pagination in both modes, marketplace payout-ready default/
all-listings/setup, peer privacy/recovery, MCP Tasks, both repository clients, and MPP
proofs/backed balance controls at 1440/390 px. Legacy migration replay passed twice
with **50 migration IDs**, preserving historical benchmark material and unknown
authorship; this part adds no migration. Logs: /tmp/clawdmarket-hierarchy-predeploy-final.log,
hierarchy-build.log, hierarchy-browser-final.log, hierarchy-focused-final.log,
hierarchy-browser-migration.log, hierarchy-registry-lint.log and
hierarchy-browser-lint.log (all with the clawdmarket prefix).

**Publishing counter: 6/10.** All work stays local; no push, PR, deployment, live
wallet spending or production rollout change. Next local P1.5 capability: versioned
benchmark definitions and attributable trusted grader results, with private test
material access, exact leaf/definition/result binding, recovery and authorization
boundaries. Peer assertions and controlled fixture graders cannot substitute for
independent production benchmark evidence. Calibration, additional verifier adapters,
unknown-owner independence and longer circular trading remain unfinished.


## P1.5 — versioned private benchmark observations (1.87; local part 7/10)

An admin publishes an immutable, exact canonical-leaf suite/version tied to one
explicitly allowlisted active registered grader. Public discovery returns bounded
version metadata and grader availability. The target agent opts in for itself with
an original UUID reference, retrieves inputs without expected answers, and submits
immutable output for every case. Only the designated grader receives private
expected answers after submission. The external CLI compares finite structural
JSON, journals its report before posting, and recovers the original run/hash after
lost replies or process death. The server independently recomputes every case,
rejecting inflated outcomes, missing cases and changed definition/submission hashes.
The only adapter is json_exact_v1; no target code executes on the application host.
See [versioned benchmark workflow](docs/TRUSTED_BENCHMARKS.md).

Definitions use salted encrypted envelopes; submissions bind run identity and hashes. Definition
versions, target references, normalized output and terminal reports are immutable;
exact request recovery grants no new private materials after revocation. Three
attempts per target/version, eight pending runs, ten-minute grants, bounded bodies,
private no-store responses and scoped named credentials constrain access. Current
owner changes, shared ownership, inactive/archived/reference participants, grader
configuration removal and retirement revoke unfinished grants. Current target
owners can read inputs; grader owners receive metadata only and cannot report
through account authority. Admin cookie writes require CSRF. Retirement retains its
actor/time. Completion, cancellation and authenticated cron expiry purge submitted
output. Separate migration 51 preserves historical peer rows and financial state.
Database uniqueness plus fresh bounded transactions protect concurrent recovery;
retryable storage contention requires inspecting/resuming the original request.

These are authenticated finite observations, not independent production skill,
calibrated quality, completion proof, trust, routing weight or payment authority.
Independence stays not_verified, measured_quality_score stays null and calibrated
stays false. No agent cache, settlement, spend authority or rollout is promoted.
The production grader allowlist remains unconfigured; fixture graders cannot
substitute for independent benchmark evidence or confidence calibration. Native
manifest, OpenAPI, skill/llms, human docs and generated clients agree on 1.87.

Validation: Node 24 full predeploy passed **590 cases (582 passed, eight existing
skips)** plus **12 Python HTTP cases**, SDK drift/build, typecheck and lint.
Production build passed. **Eighteen isolated Chromium/HTTP checks passed**, including
the external grader CLI, private input/output boundaries, immutable recovery and
unchanged public completed-work proof, plus prior family discovery, marketplace
payout defaults, MPP/backed balance, MCP Tasks and both recovery clients. A final
combined-payload boundary correction passed all **15 focused benchmark tests**,
including near-limit definition/submission grants, separate server process races,
SIGKILL after HTTP report commit, lost reply recovery, owner transfer and scoped
credentials; final lint/typecheck and built-app grader HTTP/browser recheck passed.
The legacy migration test replayed all **51 migrations twice**. Logs:
/tmp/clawdmarket-trusted-predeploy.log, trusted-build.log, trusted-browser.log,
trusted-browser-final.log, trusted-focused-final.log, trusted-contract-focused.log,
trusted-size-lint.log, trusted-size-typecheck.log and trusted-browser-migration.log
(all with the clawdmarket prefix).

**Publishing counter: 7/10.** Keep all work local until ten substantive parts pass;
no push, PR, deployment, live wallet spending or production rollout change. Next
local P1.5 capability: audit and implement bounded longer circular-trade exclusions
shared by directory proof, capability evidence and provider ranking. Verify known
owner groups, current financial backing, multi-party cycles, legitimate noncyclic
work, ownership changes and reservation/funding revalidation. This must filter
evidence without altering valid settlements or treating unknown owners as verified
independent buyers. Independent production benchmark data/calibration and additional
verifier adapters remain separate unfinished gates.


## P1.5 — bounded backed-cycle evidence exclusions (1.88; local part 8/10)

Completion evidence now excludes observed cycles of two to four current
authoritative owner/account principals, across capabilities and stored history.
Every edge requires the same current completed service order, exact accepted
delivery hash, eligible cohort and financial backing as ordinary completion proof.
Status-only reciprocal rows no longer suppress otherwise eligible work. Agent
aliases and purchases by their known owner account share a principal; legacy wallet
or email strings do not infer identity. Ownership and backing changes are rechecked
on each read. Unrelated eligible completions still count.

One shared predicate drives directory/search rows and totals, profile capability
counts, distinct buyer breadth and positive route evidence. Saved execution, direct
reservation and verified funding preserve their existing transactional eligibility
checks. A payment received after eligibility changes retains its original receipt
for refund recovery without dispatching work. Actual accepted settlements and saved
completion events remain intact; negative provider outcomes are unchanged.

The recursive walk deduplicates principal/depth states and allows 256 including
the seed. A 257th state excludes evidence rather than accepting a truncated search.
Indexed outgoing buyer/status probes precede completion lookup; one aggregate checks
return paths and exhaustion. Migration 52 adds only that nonunique trade index.
Native manifest, machine documentation and generated clients describe the exact
scope in contract 1.88. This does not establish independent buyers, measured skill
or fraud; unknown owners, cycles beyond four principals and broader collusion remain
unresolved. See [capability evidence](docs/CAPABILITY_EVIDENCE.md).

Validation: Node 24 full predeploy passed **601 cases (593 passed, eight existing
skips)** plus **12 Python HTTP cases**, SDK drift/build, typecheck and lint.
All **49 focused evidence, provider-policy, contract and migration cases passed**,
including mixed ledger/credit/EVM/MPP cycle backing, actual escrow release when a
cycle closes, concurrent ownership change before reservation, verified-funding
receipt retention, five-party scope limits, unrelated work, exhaustion boundaries
and indexed query-plan checks. The representative legacy database replayed all
**52 migrations twice**, preserving its original financial trade. Production build
passed. Eighteen prior Chromium/HTTP regressions passed; the new cycle case then
exposed long registered names overflowing mobile cards. The registry now wraps
those names. All five final rebuilt-app checks passed, covering the cycle, family
discovery and work proof on desktop/mobile. Logs: /tmp/clawdmarket-cycles-predeploy-final.log,
cycles-final-focused.log, cycles-build-final.log, cycles-browser.log and
cycles-browser-layout-final.log (all with the clawdmarket prefix).

**Publishing counter: 8/10.** Keep all work local until ten substantive parts pass;
no push, PR, deployment, live wallet spending or production rollout change. Next
local P1.5 capability: audit and add an additional bounded verifier adapter through
the existing private verification-job protocol. Preserve exact policy/result
binding, authorization, crash/replay recovery and the original buyer-acceptance and
settlement gates. Independent production benchmark data/calibration, independent
provider completion and semantic quality remain separate external evidence gates.


## P1.5 — external isolated Python verification (1.89; local part 9/10)

The new python_tests_v1 adapter invokes synchronous run(*args) in a fresh external
CPython interpreter for each agreed finite JSON case. Private text/plain .py
artifacts, strict suite/report hashes, current verifier ownership, ten-minute
grants and the original encrypted job/recovery protocol remain authoritative.
Registered agent_ UUID identifiers now work alongside legacy UUID verifier IDs.
One shared adapter allowlist drives policy, report validation, the external worker
and machine discovery. Passing Python reports appear as deterministic test
attestations, with explicit buyer acceptance still required before settlement.

The external interpreter uses -I -S -B under the existing namespaces, clear
environment, read-only inputs, network isolation and effective cgroup controls.
NaN, infinity, invalid/non-JSON output, missing entrypoints, unavailable imports,
timeout, output overflow and memory exhaustion fail. Expected answers are never
mounted in the sandbox. The application never executes Python, independently
observes the remote isolation or claims semantic truth. No new migration, financial
transition, independent quality score or rollout authority is added. Native
manifest, OpenAPI, skill/llms, human docs and generated clients agree on 1.89.
See [external isolated verification](docs/ISOLATED_VERIFICATION.md).

Validation: all **34 focused cases passed**, including real JavaScript and Python
isolation, exact frozen policy/report/media binding, private access, scopes, owner
changes, expiry/revocation, lost committed replies, corrected output and exactly-once
ledger settlement after buyer review. All **52 legacy migrations replayed twice**.
Full Node 24 predeploy with actual sandbox checks enabled passed **607 cases
(602 passed, five existing skips)** plus **12 Python HTTP client cases**, SDK
drift/build, typecheck and lint. Its first run exposed old tests assuming a fully
initialized database; the successful rerun used a fresh complete disposable schema.
Production build and all **20 Chromium/HTTP regressions passed**. The separate
Python CLI was SIGKILLed after its HTTP report committed but before reply; a new
process recovered the same report/hash without another private download, then
explicit buyer review settled once. Private journals contained no credentials,
code or test values. Mobile docs remained within 390px. Logs:
/tmp/clawdmarket-python-verifier-focused-final.log, python-verifier-predeploy-final.log,
python-verifier-build.log, python-verifier-browser-final.log and
python-verifier-browser-migration.log (all with the clawdmarket prefix).

**Publishing counter: 9/10.** No push, PR or deployment until the tenth substantive
part passes. Next local P1.5 capability: current-backed buyer reputation and bounded
owner-principal feedback. Audit found public trust still uses weaker funding/payout
checks than capability proof, permits unbound imported rating targets and repeatedly
weights purchases/ratings by the same buyer. Bind feedback to the actual seller and
current accepted delivery/payment proof; count known owner aliases once without
claiming independent identity, preserve adverse evidence and valid settlements, and
verify directory/profile/marketplace consistency. Independent production benchmark
data, calibration and semantic/provider proof remain external gates.


## P1.5 — current-backed buyer reputation (1.90; local part 10/10)

Completed the final substantive part of the authorized publishing batch. Public
ratings now bind the actual trade buyer/seller, exact buyer-accepted delivery and
current financial records. Ledger work requires the original buyer lock and
buyer-to-seller release; credit requires exact purchase/release/seller entries;
EVM/MPP require matching funding and confirmed payout. Refund contradictions,
incomplete or mismatched service orders, self/shared-owner work and known
reference/controlled cohorts cannot establish positive evidence. Manual accepted
work qualifies for marketplace history without becoming capability proof.

One latest eligible rating per current authoritative buyer-owner principal
contributes; repeated purchases cannot multiply positive rating/completion weight.
Ownership and backing are rechecked on reads. Medium/high confidence require
buyer breadth in addition to evidence thresholds; age alone supplies none.
Confidence is uncalibrated marketplace-history breadth, independence remains
unverified and measured quality remains null. Adverse dispute/resolution
observations remain separate. Manual-trade cycle checks retain the two-to-four
principal and 256-state limits, indexed outgoing-buyer probes and conservative
exhaustion behavior. Capability evidence retains its separate service graph and
existing ledger compatibility through shared pure SQL helpers.

Directory/search, profile ratings/distribution/backed volume, marketplace ranking
before pagination, and the first-render catalog share these checks. Profile
wording explains backed history and confidence; long seller/service names wrap on
mobile. The payout-ready default remains in place. Manifest, OpenAPI extensions,
skill/llms guidance and both generated SDK contracts advertise 1.90. Reputation
aggregates use one read transaction for consistent backing/ownership snapshots;
existing payment transaction concurrency and settlement state machines remain
unchanged. SQLite fixture mutations are serialized; current ownership changes
are exercised through a separate completed process.

Validation: final Node 24 predeploy passed **616 cases (611 passed, five skipped)**,
including actual external JavaScript/Python isolation; twelve Python recovery
client tests, SDK drift/build, typecheck and lint passed. The final production
build passed. Actual isolated Chromium/HTTP checks passed **21/21**, including
cross-worker owner/backing changes, removal of stale profile feedback/volume,
pre-pagination ranking, mobile layout and payout-ready default. All **52** runtime
migrations replayed twice against disposable local state. Evidence logs:
`/tmp/clawdmarket-reputation-predeploy-release.log`,
`/tmp/clawdmarket-reputation-build-publish.log`,
`/tmp/clawdmarket-reputation-browser-publish.log`, and
`/tmp/clawdmarket-reputation-migrations.log`.

CI browser fixtures use a guarded `/tmp/clawdmarket-workspace-test-ci` file
database. Real external-verifier browser execution uses the same explicit
`CLAWDMARKET_TEST_ISOLATED_VERIFIER=1` opt-in as its security tests; ordinary CI
hosts do not claim to provide the approved kernel-enforced verifier environment.
The local acceptance gate runs these real checks with the opt-in enabled.

Release CodeQL identified authenticated participant IDs as password material.
The ownership-grant fingerprint now reads agent IDs from authoritative agent
records alongside selected owner-link metadata. It preserves the original
SHA-256 bytes/hash without passing an authentication result into the fingerprint.
No alert was dismissed or security workflow weakened; credential lookup was not
changed. Required analyses must still pass on the final head before merge.

The complete CI browser matrix also caught operator workflow links added to
historical MPP proof cards. Those links are removed from the public page to
preserve its existing no-GitHub/X-links requirement; transaction explorer links,
MPP labels and the original test-source metadata remain intact.

The presence browser assertion now waits for and scopes to its mocked agent and
service cards, avoiding matches against existing server-rendered fixture agents.
The final fingerprint compatibility cases pass 15/15; the rebuilt release passes
six targeted MPP/account-balance, public-link and private benchmark HTTP/browser
checks. Full final-head CI remains the merge gate.

Vercel review also found semantic search failures rendered as empty matches.
The registry now clears stale result metadata, shows its connection-error state,
and retries the same semantic query through the existing retry control. Browser
coverage exercises HTTP and network failures, successful retries and genuine
empty results. The protected conversation gate remains in force.
The rebuilt app passes all five capability-hierarchy browser checks, including
those failure/retry paths, mobile filters and cancellation of stale pagination.

**Historical pre-publish counter: 10/10 acceptance-complete locally.** The combined batch was
authorized for GitHub/required CI and migration-first Vercel deployment. No
live wallet spend, top-up or global rollout flag change was made. Production
remains 1.80 until that deployment succeeds. Remaining PR inventory is unchanged:
#231 conflicts with released surfaces, #200 breaks legacy key recovery and failed
gates, and #163–173 are stale dependency proposals, including downgrades. Retain
the recorded old/unnecessary-PR exemption instead of merging those blindly.

### Production verification incident — 2026-10-09

PR #251 merged as `cd5cd24fa16033dbdc121170850812b5b48dd02d` after final-head
CodeQL/review/contract gates and CI passed: 606 unit tests (ten environment skips),
nine MCP contract cases and 57 Chromium/HTTP journeys (five environment skips).
Migration-first deployment `37886920522` passed and applied the five new runtime
migrations, reaching all 52 IDs. Production smoke `37887556081` then failed an
agent-profile read, and the independent public check found listings unavailable.
Runtime logs identify `SQL_PARSE_ERROR` at an ungrouped `HAVING`: local SQLite
accepts the syntax, but the remote Turso parser rejects it.

Production was rolled back to the verified PR #250 artifact
`clawdmarket-l8bmp8xhg-jacob-millers-projects-09998dbb.vercel.app`; public listings
and contract 1.80 are restored. Additive migrations remain intact. This release
is **not production-verified** until the correction passes its final-head checks,
remote query compilation, migration-first deploy and production smoke/browser
checks. It remains part of the authorized ten-part release, not a new capability
or bookkeeping release; further plan implementation waits for that completion.

The correction adds a constant `GROUP BY` to the bounded cycle aggregate, retaining
the same single-group count/reachability and 256-state bound. All 29 focused
reputation/capability tests pass, including every rail, owner changes, cycles,
state boundaries, indexed probes and public sorting. A new read-only deployment
gate compiles the actual feedback, reputation, marketplace-ranking and capability
query shapes with `EXPLAIN` against the production transport after migrations and
before artifact deployment. It emits neither private rows nor credentials.
Local typecheck/lint, all four query-compilation shapes and the rebuilt production
artifact pass. Three actual HTTP/Chromium cases cover cross-worker reputation
backing/owner changes, capability-cycle removal and truthful work-proof discovery.
Logs: `/tmp/clawdmarket-remote-cycle-fix-tests.log`,
`/tmp/clawdmarket-cycle-hotfix-build.log`,
`/tmp/clawdmarket-cycle-hotfix-browser.log`, and
`/tmp/clawdmarket-cycle-hotfix-capability-browser.log`.

The refreshed default-branch dependency graph also reports fifteen open advisories
(one critical, four high, nine moderate and one low). The correction updates the
verified patched releases of Next.js/eslint-config-next 16.3.8, MCP SDK 1.31.0 and
sharp 0.35.5, plus targeted proxy-addr, source-map-js, fast-uri, ip-address and
brace-expansion overrides. This refresh belongs to the existing P0 release
baseline; it does not count as a new capability. Full release gates must be rerun
with these exact dependencies. Maintainer evidence:
[Next.js](https://github.com/vercel/next.js/security/advisories/GHSA-cjq9-62q9-8jv4),
[MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-6qxp-vccf-f47h),
[sharp](https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w), and
[proxy-addr](https://github.com/jshttp/proxy-addr/security/advisories/GHSA-jqcg-44mw-7w3h).

The complete local audit additionally identifies high-severity
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) in
braces 3.0.3, for which upstream lists no patched release. `pnpm why braces` shows
its only installed path through micromatch/fast-glob in the development-only
Next ESLint plugin. It remains explicitly tracked; no advisory is dismissed or
ignored to obtain a clean audit. Production dependency audit is checked
separately from that development-tool limitation.
With the patched lockfile, full Node 24 predeploy passes 616 cases (611 passed,
five skipped), actual external JavaScript/Python isolation, twelve Python client
cases, SDK drift/build, typecheck and lint. `pnpm audit --prod` reports zero
vulnerabilities; the unpatched development-only braces advisory remains recorded.
PR CI also runs the query-compilation script against its initialized disposable
database. Evidence: `/tmp/clawdmarket-cycle-hotfix-security-predeploy.log` and
`/tmp/clawdmarket-cycle-hotfix-production-audit.json`.

### Corrected production release verified — 2026-10-09

PR #252 final-head checks all passed, including 57 browser journeys (five
host-dependent skips), 606 unit cases (ten host-dependent skips), nine MCP
contract cases, Agent Contract, CodeQL and resolved review gates. It merged as
`44544ce1b4aebf9e4a99cb45db9140d92017230a`. Corrected migration-first deployment
`37890272617` succeeded; all four production query shapes compiled before build,
all 52 additive migration IDs remain, and both domains point to
`clawdmarket-k48sr2l63-jacob-millers-projects-09998dbb.vercel.app`.
Same-SHA authenticated production smoke `37890762121`, main build/browser CI
`37890272553`, Agent Contract `37890272592` and payment monitor `37911816386`
passed. The release is now **production-verified at contract 1.90**.

The corrected dependencies passed local Node 24 predeploy (611 passed/five
skipped), actual external JavaScript/Python isolation, twelve Python recovery
client cases, SDK drift/build, typecheck/lint, production build and 23 actual
Chromium/HTTP acceptance cases. Independent read-only production browser/API
checks at 1440/390 px verified MPP proofs/Tempo labels, backed balance availability,
payout-ready default, current-backed profile/catalog reputation, registration
priority, ready health and bounded layouts. No new live payment or rollout flag
change occurred. Production dependency audit is zero; the unpatched development
braces advisory remains tracked above.

Evidence: `/tmp/clawdmarket-pr252-production-deploy.log`,
`/tmp/clawdmarket-cycle-security-browser.log`,
`/tmp/clawdmarket-cycle-security-client-browser.log`,
`/tmp/clawdmarket-cycle-security-core-browser.log`, and
`/tmp/clawdmarket-ten-part-production-readonly.log`.
The earlier incident section is historical, superseded by this verified result.
The next local publishing counter is **0/10**.

### Continued plan audit — next independent capability: bounded workflow execution

The implementation audit is recorded in
[WORKFLOW_EXECUTION_AUDIT.md](docs/WORKFLOW_EXECUTION_AUDIT.md), including concrete
existing code boundaries and required HTTP/provider, concurrency and recovery
acceptance gates. The audit and intermediate owner-review implementation do not complete P2.1 or
count as a substantive publishing part.

The existing workflow model stores at most sixteen explicit nodes, three
dependency edges of depth and a summed budget, but still truthfully returns
`execution_available: false`; no child route or economic execution exists.
Current route mandates bind a unique route ID/hash and reserve exposure against
that exact plan. Copying one parent's terms to new child routes would bypass
those authorization and aggregate-budget checks.

The next capability must bind an owner-approved frozen DAG and parent money
envelope, atomically reserve fee-inclusive child/retry exposure, retain per-node
ceilings and a common objective deadline, and inherit only explicitly authorized
provider/rail/verification terms. Revocation/expiry/current policy must stop fresh
sends while preserving original payment/refund/result recovery. Persist stable
node/route/attempt references before side effects; release dependents only after
exact private artifact hashes, required checks and upstream buyer acceptance.
Reconcile every child payment/refund/payout and exactly-once capacity release in
an aggregate receipt. Acceptance requires an actual multi-node HTTP/provider loop,
concurrent budget races, process-death recovery and failed dependency/refund paths
on disposable chains. Independent production quality/provider canaries remain
external gates; no live wallet spending or global flags are implied by this work.

### P2.1 local checkpoint — exact owner workflow review (1.91)

The current owner can inspect the exact private graph/hash, freeze every node's
static inputs, approved providers, explicit buyer verification, fee-inclusive
gross attempt/retry budgets, integer EVM/Tempo fee caps and dependency artifact
mappings, and revoke the original review. Agent credentials cannot approve or
revoke. Every graph representation is checked; current linked ownership, expiry,
cancellation and drift are visible without erasing historical review. Semantic
replay preserves the original immutable ID/hash even after revocation/expiry;
authority changes conflict. Approval grants **no current spending authority**,
creates no child order/payment/artifact grant, and cannot be passed as a route
payment mandate. Production planning/write flags remain unchanged.

Additive migration 53 stores reviews without changing financial history. The
four-schema readiness gate includes its required columns. Real process contention
also exposed failed-BEGIN native statements poisoning later shared-pool requests.
Workflow review uses disposable transaction clients with bounded lock retries,
closing each client without altering the financial pool or its concurrency.
Exhaustion returns retryable 503; the same saved request recovers after the lock
releases. A separate-process lock test verifies later planning still works.

Validation: Node 24 predeploy passes **627 cases (622 passed/five skipped)**,
actual external JavaScript/Python isolation, twelve Python recovery cases,
SDK drift/build, typecheck and lint. Production build passes. **16 actual app
HTTP/Chromium journeys** pass: the new owner review/transfer/revocation and
non-spending boundary, plus fifteen proof, core smoke, reputation/mobile catalog
and semantic search/hierarchy cases. Readiness and twice-replayed legacy migration
checks pass with **53** IDs and preserved legacy financial records. The Next.js
cache response appends max-age=0; the HTTP test checks the required private/no-store
directives without rejecting that additional restriction.

Evidence: `/tmp/clawdmarket-workflow-approval-predeploy.log`,
`/tmp/clawdmarket-workflow-approval-build.log`,
`/tmp/clawdmarket-workflow-approval-readiness.log`,
`/tmp/clawdmarket-workflow-approval-contention.log`,
`/tmp/clawdmarket-workflow-approval-browser.log` (fifteen regressions passed), and
`/tmp/clawdmarket-workflow-approval-http.log` (new journey passed).
See [WORKFLOW_OWNER_APPROVAL.md](docs/WORKFLOW_OWNER_APPROVAL.md).

This is a verified foundation, **not completed bounded workflow execution**.
The next implementation is atomic fee-inclusive parent/node exposure in the same
transaction as existing route/order/capacity/policy reservation, with stable child
references and a common absolute deadline. Dependency grants, actual multi-node
execution/crash recovery and aggregate settlement remain required before P2.1 can
count. The local publishing counter remains **0/10**; nothing from this checkpoint
is pushed or deployed.
