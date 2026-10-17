# void

ClawdMarket master engineering plan: registration, activation, persistent
availability, economic activity, production reliability, and visual preservation.

Saved at the user's explicit request on 2026-10-16. This plan includes the master
assignment and its Phase 9A visual-preservation addendum. It is the active project
priority. Complete its applicable requirements before starting unrelated work.
Do not interpret saving this plan, a completed audit, or a passing test batch as
completion of the implementation assignment.

Repository: https://github.com/trillskillz/clawdmarket

Production visual reference: https://www.clawdmkt.com

Project: ClawdMarket — autonomous agent-to-agent marketplace and routing layer
for machine labor.

## Mission and operating rules

Investigate the current main branch and production architecture using evidence;
identify and fix the technical, architectural, operational and UX barriers
between network profiles and registered, activated, persistent, economically
productive agents. This is implementation work: develop, test, document and
validate every safe correction available under the authorized scope.

Preserve the existing visual identity, branding, styling, recognizable layouts
and user experience continuously. Production is the visual source of truth;
repository tokens, reusable components and conventions govern implementation.
Reflect backend changes consistently throughout the affected interfaces.

Non-negotiable rules:

1. Start from current main; preserve other local work and architectural invariants.
2. Establish root causes; separate confirmed defects, hypotheses, missing
   telemetry, operational failures, product friction and insufficient demand.
3. Never infer a confirmed production defect solely from an unusual metric.
4. Never fabricate registrations, availability, services, transactions, revenue,
   reputation, customer behavior or demand. Never send artificial heartbeats.
5. Preserve authentication, ownership verification, authorization, payment
   confirmation, payout verification, escrow and exactly-once economic effects.
6. Preserve ledger, MPP and EVM semantics, authoritative server pricing and
   existing platform fees except where a demonstrated defect requires correction.
7. Preserve genuine history during recovery, rotation, migration and rollback.
8. Never use display names as unique economic identity keys or merge identities
   without verified authority. Prevent takeover and unauthorized linkage.
9. Keep API and SDK compatibility where feasible; avoid competing state authorities,
   unnecessary rewrites, duplicate components and unrelated design systems.
10. Protect credentials, private artifacts, financial references and personal data.
11. Enforce explicit owner-configured purchasing limits and authorization scopes;
    do not create uncontrolled spending automation.
12. Add meaningful regression tests for every confirmed defect. Execute required
    checks; never suppress a failure or claim an unexecuted test passed.
13. Keep changes documented, local and reviewable. No deployment, live spending or
    live security configuration changes are authorized by this plan.
14. Distinguish production, staging, synthetic, first-party, subsidized and
    independently reviewed external activity. Test success is not organic demand.
15. Continue independent safe implementation when another workstream is blocked.
    Report missing prerequisites honestly rather than marking them complete.

## Explicit access contract and stop-and-report gates

The assignment authorizes local code/documentation changes, isolated disposable
tests and bounded read-only inspection of the named public repository and site.
Possession of a token, local environment file, connector or historical report
does not establish authorization to use private production access. Previous
release permissions do not authorize publication of this work.

| Gate | Continue autonomously | Stop and report before crossing |
| --- | --- | --- |
| G1 — repository/publication | Fetch current main; isolate branch; local edits/tests/docs | Push, publish GitHub metadata or PRs, merge, release, deploy |
| G2 — production writes | Public unauthenticated GETs and rendering | Live registration, heartbeat, claim, credential change, listing, checkout, execution, acceptance, settlement or any other mutation |
| G3 — private evidence | Identify precise queries and log fields needed | Reading secrets, using discovered credentials, authenticated admin access, production DB/log reads, private backups without explicit named scope |
| G4 — economic/external effects | Dummy keys, disposable chains, isolated test identities and valueless fixtures | Real funds, top-ups, live funded canaries, paid model execution, external jobs or uncontrolled retries |
| G5 — infrastructure/security | Review checked-in deployment and configuration | Live migrations, custody/security/payment configuration, billing, rollout flags or global execution changes |
| G6 — test isolation | Explicit disposable DB and RPC configuration with dummy keys | Running a script with ambiguous/inherited production DB, signer, environment or API credentials |
| G7 — correctness/security | Repair failures and rerun affected checks | Declaring acceptance with unresolved auth, identity, escrow, race, financial or regression failures |
| G8 — frontend | Capture loaded current production baselines first; use established components | Editing affected frontend without baselines, or claiming completion without rebuilt responsive/visual/interactive validation |
| G9 — market validation | Analyze available records and supplied evidence | Real-user enrollment/email, outreach, prospect contact, live pilot activity or declaring demand without measured usage |
| G10 — final acceptance | Maintain evidence and complete safe work | Marking this plan complete while required checks, authorized staging journeys or other technical acceptance remain blocked |

At each gate record: the exact action; evidence or access missing; impact; safe
work completed; reviewable proposed change; authorization/prerequisite needed;
and resumption/rollback procedure. Stop only the dependent action. Unknown values
remain unknown, never invented zeros. Do not broaden access from one system to
another. A rejected automatic approval must be reported explicitly with the
action and stated reason; never bypass it.

Before eventual deployment, present the exact candidate, fresh validation,
migration and rollback artifacts for explicit approval. No request for approval
should substitute for first completing all independently authorized work.

## Execution order and completion tracking

Use dependency order, not the number of commits. Keep the full plan active until
the definition of done is evidenced; a completed batch is not plan completion.
Status values: pending, investigating, implemented-awaiting-validation,
validated, or blocked-with-evidence. Never equate a blocked requirement with a pass.

| Priority | Work | Initial status | Status 2026-10-17 |
| --- | --- | --- | --- |
| P0 — establish truth | Current repository/production audit, identity reconciliation, activation, first-party execution, transaction trace, visual baselines | Investigating | public scope validated; private DB/log scope blocked: needs user (G3) |
| P1 — restore core | Registration/identity, activation, presence, reference workflow, confirmed transaction defects and regression tests | Pending | registration/activation/presence validated locally; reference workflow blocked: needs user |
| P2 — economic participation | Seller onboarding/publication, machine discovery, payout feedback, purchasing reliability, lifecycle diagnostics | Pending | seller/buyer readiness blockers implemented; publication/purchasing defects pending (need private evidence) |
| P3 — transparency/UX | Honest metrics, status/onboarding/profile/catalog UI, internal funnel, SDKs/docs, continuous design preservation | Pending | SDK/docs done; public metrics audited; UI reflection of worker lease pending; private funnel blocked: needs user |
| P4 — validation | Full checks, migrations/security, visual comparison, repeatable sandbox transactions, deployment/rollback report | Pending | local gates — see Phase 11 log; publication blocked: needs user (G1) |

Phase 9A applies before and throughout every frontend modification in every
priority. Start no unrelated project until this plan is complete or the user
explicitly changes the priority.

## Phase 1 — complete repository and production audit

Inspect current main and current public production; do not assume previous
documentation describes the deployed implementation. Inspect all of:

- External discovery/indexing; registration/identity; authentication and credential
  lifecycle; ownership verification and owner claims; autonomous activation.
- Presence/heartbeats; worker scheduling/execution; profile-to-principal mapping.
- Service publication; seller payouts/capacity; discovery/matching; buyer
  registration/purchasing; payment configuration/funding.
- Escrow/settlement; delivery verification/acceptance; reputation and verified work.
- First-party buyer, seller and system agents; background jobs, queues, retries
  and dead letters; deployment and environment configuration.
- Database schema/migrations; API contracts/SDKs; monitoring, analytics and public
  dashboards; frontend routing, reusable components and design system.

Trace the whole economic lifecycle:

`Discovery → Registration → Activation → Availability → Service Publication →
Buyer Discovery → Authorization → Funding → Execution → Delivery → Verification →
Acceptance → Settlement → Repeat Purchase`

Locate failures, abandonment and blocked transitions. Use private production
logs/database records only within explicit authorized read scopes. For each
confirmed defect record root cause, exact files/lines, supporting evidence,
severity/impact, correction, regression tests, deployment risk and rollback.
Separate verified findings from unresolved hypotheses and evidence gaps.

Acceptance: an evidence map covering each stage and its authority, with current
observations distinguished from historical reports and inferred causes.

**Status (2026-10-17): validated for public scope; private scope blocked: needs user.**
Fresh read-only public audit (11:45 CT) and a stage-by-stage evidence map with
confirmed defects F1–F4 and hypotheses H1–H3 are recorded in
[the lifecycle audit](docs/LIFECYCLE_AUDIT_2026-10-16.md#continuation--2026-10-17-box-clone-branch-voidlifecycle-plan-2026-10-17).
Blocked: production DB/log reads (G3) needed to trace publication, checkout
abandonment and settlement; requires an explicit named read scope from the user.

## Phase 2 — registration and authoritative identity resolution

- Distinguish discovered external profiles, registered economic identities,
  owner-verified identities, activated identities and available workers.
- Successful registration must atomically create or securely link the
  authoritative identity and its marketplace account.
- Support secure idempotent registration, including concurrent retries and lost
  responses. Prevent duplicate economic identities after retry or key rotation.
- Preserve legitimate activity during safe credential recovery; prevent
  unauthorized merging/takeover. Never use names alone as identity keys.
- Audit stale references, race conditions, recovery and rotation.
- Expose accurate machine-readable identity states for every profile and reflect
  actual backend states on public pages. Reconcile registry counts to records.
- Avoid registration loops caused by ambiguous API responses.

Acceptance: machine-readable identity classification is accurate; registered
counts represent marketplace identities rather than discovered profiles;
concurrent/lost-response/recovery tests preserve the original economic identity.

**Status (2026-10-17): implemented and validated locally (F1).**
`Idempotency-Key` registration replay: lost reply, 4× concurrent retries, changed
command (409 `registration_reference_conflict`), post-rotation replay (409
`registration_replay_closed`), malformed secrets — all tested; display names are
never identity keys; secret/key never stored. 13:00 CT: actor binding moved from
the request digest to the original lifecycle-event actor after CodeQL PR #278
flagged a credential-derived value in a SHA-256 digest; new sponsor-adoption test. Count reconciliation: public stats
already separate profiles (223) / registered (181) / active (49); the legacy
`registered_agent_count` alias (= active) is documented, not renamed (API
compatibility). Pending: per-profile public identity-state field on registry pages.

## Phase 3 — activation and resumable onboarding

Investigate default owner-claim behavior and whether agents understand the
requirements. Preserve ownership protections while supporting explicit autonomous
and owner-managed activation modes.

- Clear registration/activation reporting; machine-readable blockers and structured
  error codes; secure resumable and idempotent onboarding transitions.
- Extend the existing readiness/status authority rather than introducing another
  state machine. Represent registration, activation, ownership, authentication,
  worker availability, seller/buyer readiness and permitted next actions.
- SDK helpers for determining the next permitted action; safe credential recovery;
  documented activation requirements and backward-compatible APIs.
- Do not require undocumented manual intervention or treat an unverified owner
  as evidence the agent is unregistered.

Acceptance: a legitimate agent can register, inspect its state and complete all
permitted onboarding steps through documented APIs without weakening verification.

**Status (2026-10-17): implemented and validated locally (F4).**
`GET /api/agents/status` now returns `activation_state`, `ownership_state`,
`api_availability`, `worker_presence`, `seller_ready`, `buyer_ready`, structured
`blockers` and `next_action` by projecting existing authorities (no new state
machine). Unobservable projection returns `readiness_state: 'unavailable'`, not
"not ready". Contract/OpenAPI/llms docs updated; SDK `getAgentStatus` /
`nextOnboardingAction` (TS) and `get_agent_status` / `next_onboarding_action` (Python).

## Phase 4 — presence and persistent availability

Investigate missing heartbeat support, expiration, authentication, terminated
processes, SDK integration, background scheduling, deployment limits, reconnect
logic, stale records, frontend interpretation and registration without a worker.

- Repair authenticated heartbeat reporting, leases/expiration, accurate states,
  reconnect handling, exponential retry backoff, graceful shutdown and crash
  recovery as evidence requires.
- Provide worker health diagnostics, presence observability and SDK support for
  persistent and periodically invoked agents.
- Separate persistent identity, recent API activity, active worker leases and
  actual execution availability. Registration is not an online signal.
- Disconnected workers become unavailable within a documented interval; do not
  manufacture a heartbeat to improve counts.

Acceptance: healthy workers remain accurately visible; lease expiry removes
disconnected workers; UI and API presence agree with authoritative records.

**Status (2026-10-17): implemented and validated locally (F2, F3); UI pending.**
Explicit worker lease (`worker_state` available/busy/stopped, 180 s) separate from
API activity; status/self-test inspection no longer creates presence; reference
fleet cron does not create worker leases; additive migration
`2026-10-16-agent-worker-presence-v1`. SDK `reportWorkerHeartbeat` /
`report_worker_heartbeat`; docs specify 60 s cadence, backoff and `stopped` on
shutdown. Pending: show worker lease on public registry/profile UI (needs Phase 9A
visual cycle).

## Phase 5 — seller readiness and service publication

Audit service creation/validation, activation, payout setup, capacity, eligibility,
discoverability and execution availability.

- Authoritative seller readiness; explicit publication requirements; structured
  listing validation and machine-readable payout blockers.
- Resumable onboarding, reliable status transitions, correct search eligibility,
  capacity-aware purchasing and accurate availability indicators.
- Explain the difference between published and purchasable. Do not advertise
  unavailable services as immediately executable.
- Do not create services for unrelated agents without authorization.

Acceptance: a newly integrated eligible seller can publish a genuinely
purchasable service through documented APIs and see any remaining blocker.

**Status (2026-10-17): partially implemented.** Seller blockers
(`NO_PUBLISHED_SERVICE`, `PAYOUT_NOT_CONFIGURED`, `PAYMENT_RAIL_UNAVAILABLE`,
`PAYMENTS_PAUSED`, `REFERENCE_FLEET_PAID_SERVICES_LOCKED`, per-offer readiness
codes) and published-vs-purchasable counts are exposed via status. Pending: root
cause of 0 executable public services (H1) — needs private records (G3).

## Phase 6 — economic transaction failures (critical)

Trace `Discover → Quote → Authorize → Reserve/Fund → Execute → Deliver → Verify →
Accept → Settle` and distinguish technical barriers, inadequate supply and lack
of demand.

Inspect discovery/eligibility, prices, buyer funding, payment configuration,
wallet readiness, checkout abandonment, escrow reservations, worker execution,
delivery validation, acceptance deadlocks, settlement, lost replies and terminal
accounting.

- Preserve ledger/MPP/EVM settlement semantics, authoritative server totals,
  platform fee logic, payment confirmation and payout verification.
- Add correlated durable lifecycle events, transaction IDs, structured stage
  failures, safe retries, idempotent economic effects and interrupted-operation
  recovery using existing state authorities where possible.
- Improve buyer/seller diagnostics and reconcile terminal accounting.
- Use only isolated sandbox accounts and test funds. No live canary without
  separate explicit approval and a reviewed spending limit.

Acceptance: controlled authorized transactions complete through every enabled,
testable rail; every failure is attributable to a lifecycle stage. An unavailable
rail/test environment is a recorded blocker, never a claimed successful payment.

**Status (2026-10-17, updated 11:58 CT after the user granted test-journey access
with NO real money): validated on disposable rails; live parts blocked: user chose
no real money.** Existing fixture-RPC suites cover credit/MPP/EVM funding,
escrow, late payment, dispute split and exactly-once settlement; the new
reference lifecycle test (below) adds an agent-level trace. No financial
handler changed. Blocked: live/mainnet canaries and real settlement (user chose
no real money); testnet runs need a testnet signer and test tokens that are not
configured on the box (needs user). Production DB/log tracing of historical
failures still needs a named read scope (G3).

## Phase 7 — first-party automation and reference transaction

Investigate registration, activation, credentials, schedules, valid services,
discovery, execution requests, output, acceptance and settlement for ClawdMarket
buyer/seller/system agents.

Inspect workers, cron/queues, environment configuration, retry/dead-letter policy,
credential validity, deployment health and execution logs under the access gates.
Repair confirmed failures. Build/extend an isolated automated reference workflow
covering registration, activation, discovery, authorization, funding, execution,
delivery, acceptance and settlement.

Acceptance: the workflow completes repeatedly in an authorized staging/disposable
environment with full traceability and no unauthorized spending. Label internal
and synthetic identities and activity; never count it as organic demand.

**Status (2026-10-17, 11:58 CT): reference workflow validated in a disposable
environment.** `tests/api/account-credit.test.ts` "reference lifecycle" runs:
replay-safe registration (seller + buyer agents) → worker lease → listing
publication → machine discovery via `/api/listings` → test-credit deposit
(fixture RPC, no value) → scoped purchase with lost-reply replay → buyer
acceptance → exactly-once settlement (5% fee unchanged, credit liability
conserved) → graceful `stopped`. Passed 3/3 consecutive isolated runs plus the
full file (31/31). Identities are synthetic and labeled; never organic demand.
`prod-agent-canary` now reports `stopped`, so it never inflates worker counts.
Blocked: production reference-fleet execution (credentials in protected Actions
env) and anything spending real funds (user chose no real money).

## Phase 8 — autonomous discovery and authorized purchasing

Inspect capability search, metadata, input/output schemas, price/execution
constraints, seller availability, offer comparison, suitability, budgets,
permission, verification and outcome reporting.

An agent must be able to identify a needed external capability, find eligible
providers, assess suitability and offers, obtain/exercise explicit authorization,
fund within configured limits, receive/validate results, record outcomes and reuse
a reliable provider. Supply SDK examples and integration tests.

Acceptance: an authorized buyer can discover/evaluate/purchase a suitable service
through documented machine APIs without manual website navigation or uncontrolled
spending. Owner-configured limits and scopes remain enforced server-side.

**Status (2026-10-17, 11:58 CT): validated locally for listings + credit.**
Buyer readiness blockers (`PAYMENT_SCOPE_REQUIRED`, rails/pause) are exposed via
status; the reference test discovers and buys through machine APIs only.
Server-side limits remain enforced (existing test: `CLAWDMARKET_AGENT_MAX_TRADE_USD`
and read-only scopes cannot pay). Pending: offer comparison/provider reuse helpers
in the SDK for reusable services (0 executable public services today, H1).

## Phase 9 — honest metrics and economic reporting

Audit every public metric and replace ambiguous measurements with auditable
definitions. Track:

- Discovered profiles, unique registrations, activation, verified owners, recent
  worker availability, published sellers and payment-ready sellers.
- Independent buyers, purchase attempts, funding, completed deliveries, accepted
  work, financial settlement, organic GMV and fees actually earned.
- Repeat buyers/sellers, registration/activation/first-service conversion,
  discovery-to-funding conversion and median time to first paid transaction.

Separate production, staging, synthetic, first-party, subsidized and independent
external activity. Registration is not participation; reservation is not settled
revenue; unknown ownership is not independent demand. Do not infer zero when an
observation fails or telemetry is absent.

Create/extend a private diagnostic funnel over durable events and authoritative
records with correlation IDs, timestamps and structured failure reasons. Protect
privacy; public statistics should reconcile without exposing private inputs,
credentials or identity details.

Acceptance: every displayed economic metric reconciles to its stated records;
funnel stages and cohort definitions are explicit, with missing measurements
identified rather than invented.

**Status (2026-10-17): partially done.** Public metrics audited against
`/api/stats` (see audit table); counts are cohort-separated and unknowns stay
unknown. Private diagnostic funnel blocked: needs user (G3 production reads).

## Phase 9A / Phase 10 — continuous visual preservation and frontend consistency

This is a requirement for all frontend work, not a final optional cleanup.
Current production is the visual source of truth. Preserve branding, typography,
color relationships, backgrounds, borders/shadows, spacing, hierarchy, navigation,
icons, animation, interaction/focus states, responsive behavior and established
component patterns. No unnecessary redesign, generic dashboard aesthetic, unrelated
component library or duplicate visual system.

Before editing frontend components:

1. Inspect global styles, theme/tokens, typefaces, palette, spacing, breakpoints,
   existing reusable components, loading/empty/error states and mobile interactions.
2. Capture current production screenshots of every affected page at desktop,
   tablet and mobile sizes; preserve originals. Include wide desktops as well.
3. Check screenshots have loaded CSS/fonts and completed relevant data requests;
   stale or broken captures cannot serve as the sole visual reference.
4. Preserve layouts/styling unless a functional correction or clear usability
   improvement calls for a proportional change.

Reflect corrected backend states in every affected registry/profile, registration,
onboarding, activation/claim, ownership, presence, seller/payout, catalog/service,
checkout, transaction history, settlement, reputation, public metrics and admin UI.
Clearly distinguish discovered/registered/activated; ownership verification from
registration; online/offline/unavailable/never-checked-in; published from purchasable;
funding/execution/delivery/acceptance/settlement; and verified work from unverified
activity. Explain blockers and failures without clutter or implementation details
that do not help the user act.

Reuse existing tokens and components. Provide appropriate loading, empty, error,
success and recovery states. Maintain semantic structure, labels, contrast,
keyboard navigation, visible focus, screen-reader status announcements and form
validation. Never rely on color alone for a state. Prevent horizontal overflow,
clipping, overlap, broken menus, unusable forms, misaligned indicators and layout
shifts; all new actions must work on phones.

After frontend changes:

1. Rebuild the application and run frontend tests.
2. Capture updated screenshots and compare them against the preserved baselines.
3. Investigate differences; separately document intentional changes and resolve
   material unintended regressions. Never blindly update baselines to pass.
4. Test mobile, tablet, standard and wide desktop layouts.
5. Exercise navigation, keyboard interaction, forms and state/error recovery.
6. Record responsive, accessibility, visual and interactive results and limitations.

Acceptance: branding remains recognizable; changes fit the current design;
affected pages accurately reflect backend state; no material visual regression
remains; layouts/navigation/controls remain responsive and accessible; intentional
changes have evidence and documentation. Screenshot existence alone is not a pass.

**Status (2026-10-17): baselines refreshed; no frontend files changed in this batch.**
Loaded production baselines at 320/390/768/1440/1920 for home, registry, profile,
marketplace, observe and docs (box: `/workspace/evidence-2026-10-17/`; 16 Oct set
on omarchy). `registry-768` captured skeletons — invalid for that viewport. Since
no UI source changed, no visual comparison is required for this batch; the UI
work in Phases 2/4 stays pending until its own capture-compare cycle.

## Phase 11 — production reliability and security

Validate auth/authorization, owner verification, idempotency, recovery, state
invariants, database consistency, concurrency, duplicate-payment prevention,
escrow conservation, exactly-once economic effects, leases, queues, timeouts,
retries, settlement reconciliation, chain confirmations/reorganizations where
applicable, compatibility, migrations, feature flags, monitoring and rollback.

Run applicable unit/integration/end-to-end suites, types, lint, production build,
migration validation/replay/preservation, security checks, visual regressions and
existing predeployment gates. Include regression coverage for every confirmed
defect. Resolve failures; do not bypass them. Keep original financial obligations
recoverable during rollout closure and rollback.

Acceptance: fresh evidence binds the exact reviewable source and enabled test
configuration. Expected skips, unsupported rails, external dependencies, warnings
and unexecuted checks are explicitly distinguished from passes. No deployment is
performed under this plan without separate approval.

**Status (2026-10-17): local gates — see "Validation log" under Current handoff.**
Migration is additive (two nullable columns, idempotent, replay-tested).

## Phase 12 — actual utility and independent demand

Evaluate differentiation, demand, pricing, execution reliability, buyer savings,
seller profit, repeat-purchase potential, verifiable quality, specialized access
and alternatives. Identify a small number of plausible uses where buying work
is preferable to doing it internally: specialized computation, independent
verification, permissioned data, external tools, software analysis, time-sensitive
monitoring, verifiable research, constrained delegation or infrastructure.

These categories are hypotheses until actual external purchasing behavior
supports them. Implement supporting technical improvements for the strongest
opportunities, but do not fabricate usage or conduct unauthorized outreach/live
spending. Sustainable margin requires actual rail/provider/operator costs.

Acceptance: independent recurring transactions are technically supportable;
engineering readiness and measured demand remain separate. Record any customer
validation awaiting an authorized independent pilot as an external dependency.

**Status (2026-10-17): blocked: needs user.** Demand validation needs
real outreach/pilots, which are not authorized. 0 independently attributed trades
is recorded as unmeasured demand, not as zero demand.

## Phase 13 — autonomous execution and final deliverables

Work P0 → P1 → P2 → P3 → P4 in dependency order. Complete safe independently
testable fixes without unnecessary interruption. Unavailable credentials,
infrastructure, production spending or deployment authorization block only their
dependent actions; document them and continue safe work. Keep this plan and its
evidence current after each accepted capability.

Deliver all of:

| Deliverable | Required content |
| --- | --- |
| A — root causes | Confirmed defects, severity/impact, files/lines and evidence; hypotheses and missing evidence separately; fixes/tests/deployment risk/rollback per finding |
| B — implementation | Modified files, schema/migrations, API/SDK/worker/frontend changes, tests and compatibility |
| C — conversion funnel | Actual available discovered → registered → activated → available → seller ready → first paid job → repeat paid job counts, cohort/scope definitions and measurable abandonment; unknowns explicit |
| D — transaction audit | Evidence for technical failures versus inadequate supply/demand; lifecycle-stage diagnostics and economic accounting |
| E — visual report | Loaded production baselines, updated screenshots, intentional changes, comparisons, responsive/accessibility/interaction results and unresolved differences |
| F — validation | Exact commands/source/configuration, executed results/logs, migration/security evidence, repeatable isolated end-to-end transactions and explicit skips/blockers |
| G — deployment | Required configuration, backup prerequisites, migration order, flags, guarded rollout, monitoring, rollback and postdeployment checks; separate approval required |
| H — business constraints | External access/operational/customer/cost constraints; engineering readiness versus demonstrated product-market fit |

**Status (2026-10-17):** A partial (F1–F4 + hypotheses), B done for this
batch, C partial (public counts only), D blocked (G3), E baseline only, F see
validation log, G see handoff, H recorded in audit. Plan is **not** complete.

## Final definition of done

All of the following require evidence before marking this plan complete:

- [ ] Discovery and registration are accurately distinguished, with counts
  reconciled to authoritative records and privacy-preserving machine states.
- [ ] Registration is reliable, atomic and retry-safe; concurrent requests and
  credential recovery preserve original identity/history without takeover.
- [ ] Activation is secure, explicit, documented, resumable and understandable.
- [ ] Integrated workers can remain available and expire correctly; no fabricated
  presence, and temporary availability is separate from persistent identity.
- [ ] Eligible sellers can publish genuinely purchasable services; payout,
  capacity, availability, supported rails and blockers are accurate.
- [ ] Buyers can discover and compare suitable services through documented APIs.
- [ ] Explicitly authorized, bounded test transactions execute reliably across
  enabled/testable rails while preserving prices, fees, escrow and security.
- [ ] Delivery, verification, explicit acceptance, settlement, late-payment and
  lost-response recovery work with exactly-once economic effects.
- [ ] Economic operations and failures are auditable by correlation/stage.
- [ ] First-party reference workflows pass repeatedly in an isolated authorized
  environment; test activity is distinct from organic demand.
- [ ] Public economic statistics are accurate and internally reconcilable; the
  conversion funnel is measured where data exists and honest where it does not.
- [ ] All affected frontend interfaces reflect authoritative backend states.
- [ ] Existing visual identity is preserved; rebuilt responsive, accessibility,
  interaction and visual-comparison checks show no material regressions.
- [ ] Appropriate regression, type, lint, build, security, migration and existing
  predeployment gates pass on the final source; limitations are disclosed.
- [ ] Deployment and rollback procedures are concrete and reviewable; no
  unauthorized publication, configuration, production mutation or spending occurs.
- [ ] Deliverables A–H are complete and linked to evidence; the platform is
  technically prepared for genuine recurring commerce.

Organic adoption, independent customer demand and sustainable revenue must be
measured honestly. They are not manufactured completion criteria. Missing
authorized staging/access/validation remains an explicit incomplete technical
requirement; a final report must not falsely declare the entire plan complete.

## Current handoff

Updated 2026-10-17 (CT). Active work moved to a box clone:
`/workspace/clawdmarket-void`, branch `void/lifecycle-plan-2026-10-17`, based on
main `a17494d`. It contains the omarchy `clawdmarket-lifecycle-audit` draft
(imported verbatim, verified identical file list/diffstat) plus follow-up
commits. The omarchy worktree is untouched. **Not pushed**: the user requires
explicit authorization before any push, PR, merge or deployment (G1).

Investigation/access report: [lifecycle audit](docs/LIFECYCLE_AUDIT_2026-10-16.md).
Baselines: 16 Oct on omarchy `docs/evidence/lifecycle-2026-10-16/production-baseline/`;
17 Oct on the box `/workspace/evidence-2026-10-17/production-baseline/` (PNGs not
committed; `public-api.json` for 16 Oct is committed).

### Validation log (disposable DB `file:/tmp/clawdmarket-workspace-test-ci/ci.db`, dummy secrets, no production credentials on the box)

Mirrors `.github/workflows/pr-build-smoke.yml` (`/workspace/ci-local.sh`):
drizzle push + runtime migrations (80) OK; evidence query compilation OK; lint OK;
typecheck OK; `sdk:check` OK; `pnpm test` 1,201 tests — 1,060 pass / 141 skipped
(expected env-gated skips, same count as prior CI) / 0 fail; Python SDK 28/28;
production build OK; MCP contract 9/9; Playwright (Chromium, CI mode, built app)
164 passed / 9 skipped / 0 failed / 0 flaky; `pnpm audit` (full and prod): no known
vulnerabilities. Reference lifecycle test 3/3 consecutive isolated passes.
Final rerun on `bc09728` (12:10–12:26 CT): every step green except `pnpm test`
1,202 tests — 1,059 pass / 141 skipped / **2 fail**, both in
`tests/api/organization-listing-races.test.ts` ("generic L1/Tempo funding versus
pending review proposal"), `SQLITE_BUSY` reading `seller_payment_preferences`
during trade creation in a two-process file-SQLite race. **Pre-existing flake, not
caused by this branch**: reproduced on untouched base main `a17494d` (1 of 6 runs)
and on this branch (1 of 5 runs); the same file passed in the first full run.
No file in that path is modified here. Not fixed in this batch (financial
trade-creation path; needs its own bounded fresh-read recovery change like the
2026-10-16 payout-lookup fix). It may flake in PR CI; a rerun is the expected
remedy, never a suppression.

### Deployment plan (G — requires user approval)

1. Push branch, open PR to main linking `void.md`; wait for PR Build + Smoke.
2. Merge (squash) → Deploy workflow: release gate on an isolated DB, production
   readiness preflight, **additive** `db:migrate:runtime`
   (`2026-10-16-agent-worker-presence-v1`: two nullable `agents` columns, no
   backfill), build, deploy, alias, alias health checks.
3. Production Smoke (includes `prod-agent-canary`, now heartbeating `stopped`).
4. Post-deploy checks: `/api/health`, `/api/health/ready` (new columns present),
   key pages, `GET /api/agents/status` shape via the smoke canary.
5. Rollback: revert the merge commit and redeploy; the two columns are inert for
   old code and remain (no destructive down-migration). Registrations created via
   `Idempotency-Key` are ordinary agents and remain valid.

### Security alerts (2026-10-17, local only; push/merge held for user approval)

- #44 contract-exact-acceptance: fixed in code (authoritative buyer id in the digest gives identical digests; constant-time `sameDigest`). Local CodeQL clears it.
- #12 legacy API-key digest: hardened (constant-time format detection, atomic audited upgrade to HMAC, no lockout). CodeQL will still flag it until legacy support is sunset or the alert is dismissed by the user. See audit doc.

### Remaining (not complete)

- Worker lease / identity state on public registry & profile UI (needs a Phase 9A
  capture-compare cycle).
- Private evidence (G3): publication failures (H1), checkout abandonment,
  funnel (Deliverable C/D) — needs a named production read scope.
- Live/testnet transactions: blocked: user chose no real money; testnet signer
  and test tokens not configured (needs user).
- Phase 12 demand validation: needs authorized outreach/pilot (not granted).
- Known compatibility notes: a non-JSON heartbeat body now returns 400; a
  malformed `Idempotency-Key` on registration returns 400; rotating
  `AGENT_API_KEY_PEPPER` changes replay-derived ids (old replays would mint a new
  identity), so pepper rotation must close outstanding registration replays.

All phases remain incomplete unless their evidence is recorded above.
