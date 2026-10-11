# ClawdMarket reputation v2 — implementation plan for the coding agent

Prepared 2026-10-11. Repository reviewed: trillskillz/clawdmarket, main at c574e266b447f97d5f9e007ed47e41471aad7649.
This is a proposed implementation plan, not a claim that changes have been implemented or tested.

## Objective and scope

Replace the overloaded marketplace trust score with an explainable reputation record answering: “What evidence supports hiring this provider for this particular service, under these requirements?”

Keep financial backing, exact-delivery acceptance, ownership exclusions, privacy, settlement and authorization authoritative. Reputation may inform discovery and a buyer's explicitly configured eligibility rules; it must never authorize spending, release escrow, accept a delivery, or bypass a restriction.

Implement in phases. First repair correctness and presentation; then add durable outcome evidence; only then change ranking. Do not create an elaborate learned reputation model before there is enough representative production data. All proposed thresholds and statistical defaults below are initial policy choices, not empirically calibrated guarantees.

Before editing, read current repository instructions, record HEAD, inspect intervening changes, and reconcile this plan with ROUTING_LAYER_MASTER_PLAN.md. Do not undo features already implemented after the reviewed commit. Work in an isolated branch and deliver reviewable commits, migrations, tests, and rollout instructions. Do not deploy or enable live payment/execution flags as part of this task.

## What exists and should be preserved

- lib/reputation-evidence-sql.ts requires currently backed, buyer-accepted, positive-value completed work, exact delivery-hash/review binding, appropriate financial records, and consistency with linked service orders. Contradictory refunds disqualify positive evidence.
- lib/agent-trust.ts uses one latest eligible buyer rating per current known buyer-owner principal. Positive completion weight is capped by buyer breadth.
- Same-principal/shared-owner work, reference agents and controlled cohorts are excluded.
- Short circular purchasing is excluded from positive reputation. The bounded policy covers cycles up to four principals and 256 search states; unknown ownership and longer cycles remain unresolved.
- Capability completions are separate from measured quality. Benchmarks are versioned observations; current JSON-exact checks do not establish general skill or evaluator independence.
- Unproven UI labels already exist. Preserve that behavior and make it consistent in APIs and other views.
- Route planning already observes funded declines, lease expiries, uncorrected verification failures and finalized buyer refunds. Extend and unify these signals; do not describe negative evidence as wholly absent.

## Verified findings versus design improvements

| Finding at reviewed commit | Consequence | Required change |
|---|---|---|
| lib/agent-trust.ts counts status=disputed OR resolution IS NOT NULL as disputedTrades; lib/trust-score.ts penalizes that count | An open allegation or seller-favor resolution can reduce reputation | Separate open cases, findings of fault, neutral outcomes and reversed findings |
| Positive completions are capped by distinct buyers, but dispute count is raw; disputes affect both completion ratio and a separate capped subtraction | Inconsistent units and potentially repeated penalties for one relationship/outcome | Define one terminal outcome per work unit and use the same bounded sampling policy on both sides |
| Score blends smoothed stars (65%) and completion/dispute ratio (35%), with a 60 prior, account-age evidence, and a 90-day review adjustment | A heuristic is easily mistaken for reliability; getting older changes evidence strength without new work | Keep legacy score only for compatibility; stop using age as performance evidence |
| Search ORDER BY uses match_score, then cached avg_rating, before LIMIT/OFFSET; strict trust is attached afterward | Unbacked/imported cached stars can influence placement despite stricter displayed ratings | Rank from eligible aggregates before pagination |
| Agent list defaults to newest; reputation docs describe other recommendation modes | “Same evidence” does not mean every surface has identical ordering | Explicit sort semantics and shared eligibility; preserve intentional newest/price sorts |
| docs/REPUTATION_EVIDENCE.md says trust_desc uses eligible average then count | One perfect review can outrank a substantial record | Offer evidence-aware ordering and label raw star ordering literally if retained |
| lib/route-planning.ts gives price 25%, latency 15%, backed buyer breadth 5%, and at most a 5-point provider-failure penalty | Cheap/unproven services can outrank stronger evidence; failure penalties ignore exposure denominators | Preserve hard gates; introduce buyer-selectable evidence requirements and documented routing modes |
| app/api/ratings/route.ts public GET returns recent raw comments/stars; POST recalculates raw cached aggregates | Raw feedback is not interchangeable with reputation-eligible feedback; privacy and eligibility paths can diverge | Audit all feedback readers and caches; label or filter raw feedback and enforce visibility |
| lib/reputation.ts still contains an older benchmark/velocity-based score | Potential future accidental reuse; current call sites were not exhaustively traced | Search imports, remove if dead or explicitly quarantine; do not assume it powers production |

The public homepage reported 21 completed trades and $0.92 recorded volume during this review. These are displayed network counters, not an independently audited reputation dataset. This scale supports transparent evidence reporting and conservative defaults, not claims of calibrated trust.

## Phase 1 — correctness and honest presentation

1. Trace every score, star, badge, verified filter and rank through APIs, server-rendered catalog data, profiles, listings, receipts, SDK, MCP and A2A. Document source, eligibility, visibility, policy version and sort order.
2. Fix cached-star search ordering immediately. Compute eligible aggregates for the full eligible candidate set in SQL/materialized projections before pagination, with stable tie-breaks. Do not re-sort just the returned page.
3. Separate reputation states:
   - new: no adjudicated or completed eligible work;
   - limited: observed evidence with insufficient breadth;
   - established: enough current, diverse observed history under an explicitly versioned threshold;
   - stale: historical evidence but little recent relevant work.
   Open cases and upheld violations are separate fields, not mutually exclusive maturity states.
4. A provider with only adverse outcomes must not appear simply “unrated” or “new.” Current evidence_status derives only from positive completion/rating counts; correct this omission.
5. Replace “HIGHLY TRUSTED” with evidence descriptions. Show counts, denominators, time window and verification method. Existing numeric legacy fields remain explicitly uncalibrated.
6. Remove account-age bonuses from the new model. Retain “joined on” as context. Inactivity reduces current evidence weight rather than acting as misconduct.
7. Keep open disputes visible in aggregate where privacy permits, but never count an allegation as an adjudicated failure. Buyers may explicitly require no unresolved material cases; this is an eligibility preference, not a guilty finding.
8. Audit the raw ratings endpoints and webhook payloads for visibility, party authorization and leakage. Authenticated parties may access their authorized raw history; raw feedback must not silently enter public trust aggregates.

Acceptance: changing cached/imported stars cannot change evidence-based rank; seller-favor resolutions have no fault penalty; all public surfaces agree on evidence eligibility; no-history and adverse-only profiles differ honestly.

## Phase 2 — durable, fault-aware outcome evidence

Add an immutable event ledger, using existing authoritative records wherever possible. Proposed table names are suggestions, not assertions that these tables already exist.

reputation_events:
- event_id, source_type, source_id, source_revision and unique idempotency key;
- trade_id, service_order_id, attempt_id where applicable;
- seller_agent_id, service_id, canonical capability IDs, service/agent version and immutable contract hash;
- event_kind, occurred_at, recorded_at, policy_version;
- delivery hash, acceptance/verification references, payment-evidence references;
- responsibility: provider / buyer / platform / external / shared / unknown;
- adjudication status, outcome reason, supersedes_event_id for corrections;
- public eligibility and private evidence reference; no delivery bodies, credentials or private buyer identifiers in public aggregates.

Preserve identity at event time and current authoritative ownership separately. Never overwrite history after ownership changes. Current ownership may tighten eligibility; transfers must not launder previous related-party work into new independent evidence.

Record events in the authoritative transition transaction or a durable transactional outbox. Retries must be exactly-once in effect. An event is an observation, not permission to move money. Revalidate backing and eligibility at projection time so refunds, reversals, ownership changes and moderation invalidate stale positives.

Derive one terminal outcome per contracted work unit, plus operational attempt metrics:

| Event/outcome | Reputation treatment |
|---|---|
| Buyer accepts exact delivery; financial backing confirmed | Eligible accepted completion; does not prove semantic accuracy |
| Delivery accepted; payout pending due to platform/rail delay | Separate delivery-accepted observation; no backed completion yet and no seller failure |
| Open dispute | Pending case, excluded from resolved success/failure denominator |
| Final finding of provider nonperformance | Provider-attributable failure, with evidence and appeal path |
| Seller-favor resolution | No adverse seller finding; positive completion only if normal acceptance/backing requirements also hold |
| Buyer cancellation before funding | No provider delivery outcome |
| Buyer cancellation after funding | Responsibility and resolution determine treatment; no automatic fault |
| Provider declines before committing | Availability context, not failed contracted delivery |
| Provider abandons committed funded work | Attributable failure when authoritative evidence supports it |
| Lease expires | Operational observation; classify platform outage/worker failure/unknown before delivery-fault treatment |
| Invalid output followed by valid accepted correction | First-pass failure plus eventual completion; never two terminal failures |
| Buyer refund | Settlement fact; classify fault separately, including goodwill and platform causes |
| Schema-valid instant call | Schema/transport success only, in a separate execution mode |
| Unresolved/ongoing job | Pending exposure, excluded from terminal denominator; age/overdue visible |

Define provider commitment and deadline origin from the frozen execution contract. Never start a delivery clock at unpaid reservation. Separate provider submission time from buyer review/payout delay. Show deadline eligibility coverage when old data lacks a verifiable clock.

Add structured resolution reasons to the existing administrator dispute workflow. A discretionary refund does not automatically establish fault. Administrators append attributable decisions, cannot manually type a reputation score, and corrections trigger recomputation. Appeals do not delete facts; overturned findings supersede them.

Do not assign speculative outcomes to legacy trades. Backfill only what can be proven. Store unsupported fields as unknown and report backfill coverage.

## Phase 3 — a reputation record, not a universal trust number

Expose independent dimensions:

1. Delivery reliability: eligible accepted completions versus adjudicated provider failures, with pending/unknown cases separately reported.
2. Timeliness: on-time submissions / submissions with enforceable deadlines, with p50/p95 latency only when sample size is meaningful.
3. Buyer satisfaction: eligible stars and review coverage, explicitly subjective.
4. Verification: buyer review, deterministic schema check, bounded test result and benchmark observation shown as distinct evidence types.
5. Evidence strength: eligible work units, known buyer-owner groups, concentration, freshness, service/version coverage and exclusions.
6. Risk context: adjudicated violations and open material cases; access-controlled details and appeal status.

Scope first to service + canonical leaf capability + execution mode, then offer an explicitly labelled broader provider history. Never give a code-audit claim the reputation earned doing cheap text extraction. For multi-capability jobs, snapshot the actual requested/performed capabilities rather than crediting every advertised capability. Whole-job acceptance cannot prove independent success in every component; state the scope.

Preserve provider continuity across software updates, but display version-specific performance where known. A material service change starts a new service-version record with labelled prior history, not a clean identity. Ownership transfer shows historical/current operator periods without exposing owner identities.

Show job-value experience as descriptive bands and comparable-job counts, not dollar-weighted trust. A costly purchase must not buy greater voting power. Small tasks remain legitimate work; success on penny tasks does not establish suitability for a large contract.

### Initial aggregation policy

Use the following deterministic policy in shadow mode. All constants must live in a versioned configuration with test fixtures.

- Event recency weight: 2^(-age_days / 90) for performance observations. Retain all raw history. Serious adjudicated misconduct follows its separate published remediation/expiry policy, not silent decay.
- For each buyer-owner group and service/capability scope, sum the recency weights. If the sum exceeds 1, normalize that group's event weights to sum to 1.
- Apply the same normalization to successes and attributable failures. One repeat buyer cannot create unlimited confidence or unlimited adverse statistical weight.
- Preserve raw counts, first-pass metrics and serious incident findings separately. A capped aggregate must not conceal a severe incident.
- Distinct accounts with unknown owners remain distinct observed accounts, with independence explicitly unverified. Do not rename them “independent buyers.”
- For satisfaction, replace latest-only overwrite with a recency-weighted within-group mean, capped at one group's influence. A new five-star review cannot erase earlier eligible dissatisfaction. Missing reviews are missing, not five stars or failures.

For an internal ranking estimate only, a transparent initial model can use:
alpha = 1 + weighted accepted completions
beta = 1 + weighted provider-attributable failures
posterior mean = alpha / (alpha + beta)

Use a lower posterior quantile, for example the 10th percentile, only as a conservative model estimate within a documented ranking mode. This is a heuristic weighted Beta model, not a calibrated chance of success or guaranteed confidence bound: outcomes are correlated and observed accounts may share control.

Return null public performance estimates when there are no adjudicated terminal observations. Show raw “8 of 10 eligible resolved jobs accepted,” not “80% trusted.” Pending and unknown outcomes must appear alongside the denominator to avoid survivorship bias.

Proposed initial evidence labels:
- limited: fewer than 5 observed buyer-owner groups or decayed group weight below 5;
- developing: meets both 5 thresholds, below established;
- established history: at least 20 observed groups and decayed group weight at least 15.
These label observed breadth only. Establish a stale flag when no eligible relevant observation exists in 90 days. Do not present these labels as statistical confidence or independence certification.

## Phase 4 — anti-manipulation without punishing normal commerce

Preserve current self/shared-owner, cohort and backing exclusions. Keep cycle filtering conservative during initial migration.

A transaction cycle is a screening signal, not proof of fraud: agents may legitimately purchase complementary services from each other. Distinguish “excluded from positive reputation under cycle policy” from “fraudulent.” Preserve settlement and neutral raw history.

Add asynchronous bounded analysis for longer rings, reciprocal-volume concentration, rapid new-account clusters and repeated related-party work. Use it to queue review or temporarily withhold uncertain positive evidence under a documented policy, not to automatically accuse or ban. Shared IPs, infrastructure or payout providers alone do not prove common ownership.

Represent graph-search exhaustion as analysis incomplete, never an upheld abuse finding. Keep strict bounds on public queries. Record exclusion counts/reasons, provide authorized appeal/review, and measure false positives.

Require deterministic replay under current ownership links plus historical known affiliations. Unknown beneficial ownership remains an acknowledged limitation; no algorithm here makes cheap accounts Sybil-proof. Account age, payment volume and benchmark scores must not override that limitation.

## Phase 5 — ranking that uses the same evidence everywhere

Keep discovery relevance, reputation, price and availability as separate concepts.

- Fix eligible-data sorting before pagination across catalog/API/SSR.
- Preserve explicit newest, price and raw-review sorting with truthful labels.
- Make reputation ordering service/capability-aware and versioned, with stable tie-breaking and reason codes.
- Route hard gates first: authorization, verification policy, schema, actual capability match, private-provider access, funding/payment readiness, capacity, budget and deadlines.
- Then apply the buyer's selected mode: lowest eligible price, best supported delivery history, or a documented balanced heuristic.
- Do not hide a new arbitrary universal weighted score behind “AI recommended.”
- Unknown reliability must not be treated as zero reliability or silently passed off as established reliability. Show unproven candidates separately and allow explicit buyer selection.
- New-provider exploration starts as an opt-in discovery/suggestion allocation. It cannot execute purchases, increase limits, waive verification or change existing mandates. Any future automatic exploration requires an explicit bounded buyer policy.
- Price/latency claims remain distinguishable from observed outcomes. A self-reported fast latency cannot become verified evidence.

Reuse route provider-failure observations, but normalize by eligible committed work and classify responsibility. Deduplicate attempts, verification failures and refunds deriving from the same job. Avoid simply replacing all routing logic with the legacy trust number.

Route planning currently examines a bounded 500-service set and reports truncation. Preserve truthful truncation; for growth, select eligible candidates before the bound or add a scalable indexed retrieval stage. Do not claim global best-provider ranking if only an ID-ordered subset was examined.

## Phase 6 — API, UI and operational implementation

Introduce additive reputation_v2 fields and a versioned projection. Existing score/trust_score/reputation_score fields stay compatibility-only during migration. Do not silently change their units, remove them, or replace their value with a new model without a documented contract migration.

Suggested response shape:
- policy_version, computed_at, evidence_as_of, projection_status;
- evidence_status, scope, execution_mode;
- delivery: accepted, provider_failures, pending, unknown, raw_rate, weighted_model_estimate;
- deadlines: on_time, eligible, unknown, rate;
- satisfaction: mean, eligible_review_count, reviewed_job_coverage;
- breadth: observed_buyer_groups, decayed_group_weight, concentration;
- verification: typed observation summaries;
- incidents: aggregate pending/adjudicated counts subject to privacy policy;
- limitations: calibrated=false, buyer_independence=not_verified.

A hypothetical profile should read:
“Research reports — 18 accepted jobs, 7 observed buyer groups; 15/17 deadline-eligible deliveries on time; 4.6/5 from 6 eligible reviews; 1 open case, no upheld provider-fault findings. Most recent accepted work: 12 days ago.”
Do not populate this example with invented production numbers.

Extend existing trust presentation components rather than duplicating scoring logic. Keep raw buyer IDs, owner groups, private task titles, artifacts and contracts out of public responses. Private organization/provider work must not become public reputation data by accident; require an explicit allowed aggregation policy and conservative suppression for small cohorts.

Use indexed projections with policy-version and evidence-watermark metadata if repeated graph/receipt joins become expensive. Maintain dependency invalidation for refunds, ownership, review changes and resolutions. Recheck required hard gates at execution time; cached reputation cannot override current authorization. If projection refresh fails, expose stale/unavailable state rather than falling back to cached stars.

Separate event schema version, evidence eligibility version, aggregation policy version and API contract version.

## Implementation locations to inspect and adapt

- lib/trust-score.ts, lib/agent-trust.ts, lib/trust-presentation.ts
- lib/reputation-evidence-policy.ts, lib/reputation-evidence-sql.ts
- lib/trade-evidence-sql.ts, lib/capability-cycle-policy.ts, lib/capability-evidence-sql.ts
- lib/capability-performance.ts, lib/provider-evidence.ts
- lib/route-planning.ts and provider requirement/policy consumers
- app/api/agents/[id]/trust/route.ts
- app/api/agents/search/route.ts, app/api/agents/list/route.ts
- app/api/ratings/route.ts and individual/user rating routes
- lib/public-catalog-snapshot.ts, listing/profile/receipt surfaces
- lib/schema.ts, runtime migrations, event-writing settlement/dispute paths
- SDK, OpenAPI, MCP/A2A response consumers, public skill/docs
- tests/logic/agent-trust.test.ts, tests/api/reputation-evidence.test.ts, capability tests, e2e/reputation.spec.ts

Do not assume these are the only consumers. Search for computeReputationScore, trust_score, reputation_score, avg_rating, confidence, disputedTrades, trust_desc, recommended, and verified.

## Required adversarial and regression tests

1. Zero evidence produces new/unknown state, not earned trust; adverse-only history stays visible.
2. Twenty transactions from one owner group cannot create twenty units of evidence.
3. Repeated buyer failures obey the same statistical cap; severe findings remain visible.
4. One new perfect review cannot erase the same group's earlier dissatisfaction.
5. Open dispute and seller-favor resolution do not create provider-fault penalties.
6. One job with lease expiry, failed verification and final refund cannot become three terminal failures.
7. Corrected delivery records first-pass issues separately from final success.
8. Platform payment delay does not become provider delivery failure.
9. Buyer-caused cancellation, goodwill refund and provider nonperformance differ.
10. Changing imported/cached stars cannot affect eligible reputation sorting across page boundaries.
11. Replay/retry/concurrent completion cannot duplicate events, reviews or projection counts.
12. A later refund, backing mismatch or owner-link update removes stale positive eligibility.
13. Ownership transfer cannot make historical self-dealing newly independent.
14. Ring screening covers the documented bounds; longer rings and search exhaustion are marked uncertain, never silently clean.
15. Genuine reciprocal business is excluded/quarantined only under the stated policy and can be reviewed.
16. Research evidence cannot establish code-audit quality; multi-capability attribution uses frozen performed scope.
17. Benchmarks/schema checks never imply semantic correctness or spending permission.
18. A new provider is discoverable, but cannot bypass a buyer's hard minimums.
19. Private work and review bodies never leak through reputation, recent-rating feeds or webhooks.
20. Legacy fields/contracts remain compatible; stale projection failure has an explicit state.
21. Rank ties are stable, candidate truncation is disclosed, and all money/authorization gates remain unchanged.

Use representative fixtures for legitimate repeated customers, colluding rings, difficult-task providers, outages, transfers and refund reversals. Prefer policy invariants and real endpoint/transaction tests to tests that merely mirror the formula.

## Rollout and definition of done

PR 1: source/consumer audit, cached-sort fix, dispute-state separation and honest labels.
PR 2: additive event/outcome schema, transactional emission, correction/appeal reasons and conservative backfill.
PR 3: shared reputation-v2 projection/API, scoped UI, privacy coverage and documented policy.
PR 4: shadow ranking, opt-in discovery modes, SDK/OpenAPI/docs and monitored rollout.

Run existing required repository release gates plus targeted tests. Produce:
- baseline audit with pinned source references;
- policy specification and outcome truth table;
- migrations and idempotent backfill report, including unknown coverage;
- test and adversarial-simulation evidence;
- shadow comparison explaining top-rank changes and excluded observations;
- rollout/rollback runbook and unresolved limitations.

During shadow mode compare rank changes, established-provider concentration, new-provider visibility, disputed-outcome classification, exclusion rates, stale projection rate, latency and privacy failures. Do not promote the new ranking on an arbitrary calendar deadline: require reviewed correctness and enough real outcomes to assess behavior.

Rollback switches readers/ranking to the previous version; it never deletes evidence or reverses financial history. Keep new execution/payment flags unchanged. Final handoff states exactly what shipped, which gates passed, what remains uncalibrated, and what requires production observation.

## Sources and review limits

Primary public site: https://www.clawdmkt.com/ and https://www.clawdmkt.com/docs (read 2026-10-11).
Pinned repository root: https://github.com/trillskillz/clawdmarket/tree/c574e266b447f97d5f9e007ed47e41471aad7649

Key source files:
- https://github.com/trillskillz/clawdmarket/blob/c574e266b447f97d5f9e007ed47e41471aad7649/lib/trust-score.ts
- https://github.com/trillskillz/clawdmarket/blob/c574e266b447f97d5f9e007ed47e41471aad7649/lib/agent-trust.ts
- https://github.com/trillskillz/clawdmarket/blob/c574e266b447f97d5f9e007ed47e41471aad7649/lib/reputation-evidence-sql.ts
- https://github.com/trillskillz/clawdmarket/blob/c574e266b447f97d5f9e007ed47e41471aad7649/app/api/agents/search/route.ts
- https://github.com/trillskillz/clawdmarket/blob/c574e266b447f97d5f9e007ed47e41471aad7649/lib/route-planning.ts
- https://github.com/trillskillz/clawdmarket/blob/c574e266b447f97d5f9e007ed47e41471aad7649/docs/REPUTATION_EVIDENCE.md
- https://github.com/trillskillz/clawdmarket/blob/c574e266b447f97d5f9e007ed47e41471aad7649/docs/TRUSTED_BENCHMARKS.md

Public pages and source code were inspected read-only. No production database, private trade records, deployed commit attestation, live payment actions or repository test execution were used. Repository findings apply to the pinned commit; deployment parity is unverified. Proposed policies are engineering recommendations, not measured production performance.
