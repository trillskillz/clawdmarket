# Local release candidate: dependable purchasing and independent pilot

Implementation checkpoint **ba28cd6**, HTTP **1.118**, branch
`work/local-dependable-pilot-2026-10-14`, based on accepted
local task purchasing `a8f870f` and inspected production
`96a017b6019920f47af32d86a7e476c9b9c07808`. All changes remain local.
The ten-part user plan is saved in
[the priority plan](DEPENDABLE_PURCHASING_AND_INDEPENDENT_PILOT_PLAN_2026-10-14.md);
each finding has its current disposition in
[the issue register](DEPENDABLE_PILOT_ISSUE_REGISTER_2026-10-14.md).

**Security gate remains blocked by one acknowledged development dependency risk.**
No exception has been approved. This is a reviewable local release candidate,
not authorization to publish, an all-green security release, a deployed fix, an
enabled rollout or evidence of independent demand. No production funds, flags,
custody, customer activity, mail or outreach were changed. The parked reviewed
listing foundation `e876e58` is excluded; routing acceptance remains **7/10**.

## What changed and why

- Append-only operator cohort attributions and current-owner/expiry checks separate
  first-party fixtures, unknown ownership and actually reviewed ownership. Public
  names and distinct account counts never establish independence. Credentials and
  private ownership notes remain outside public DTOs.
- Statistics, API metadata and four public surfaces distinguish public profiles,
  registrations, online cohorts, listing inventory, executable service definitions,
  recorded financial volume and qualified economic evidence. Legacy aliases retain
  their documented meaning. Query failures return unavailable or visibly stale
  observations with timestamps.
- Sellers explicitly confirm supported rails for their account or owned agent.
  New prepaid credit requires opt-in and pays nonwithdrawable account credit.
  Server selection and transaction commits enforce restrictions across purchase
  paths; marketplace and task interfaces expose the same restrictions. Existing
  original orders, claims, acceptance and settlement retain their references/terms.
- Password reset retains generic, rate-limited, expiring single-use hashed tokens;
  provider failure revokes the token, transport times out, and no HTTP/debug path
  discloses a reset token. Readiness scopes missing sender configuration to email
  password recovery. The approved existing session/agent ownership rules remain.
- Method-specific evidence labels replace a generic passed-status inference.
  Ranking remains the explicitly authorized policy, with evidence/calibration
  limits exposed and bounded provider concentration/baseline measurements added.
  Active metadata and promotional drafts no longer imply unrestricted autonomous
  commerce, unlimited capacity, identity verification or semantic guarantees.
- Operational observations have independent slots/timestamps. A capped canary is
  prepared with original-reference recovery; no live command was executed. The
  narrow reviewed organization-task API-testing pilot has finite requirements, an empty restricted
  cost ledger and a privacy-safe funnel that separates recorded financial stages
  from client-reported discovery. Missing intervention/cost data stays null.
  The pilot uses reviewed task v2 on Tempo for explicit exact-delivery acceptance.
  Ordinary tasks retain legacy automatic release and are not a substitute. The
  reviewed path is local and its execution gate does not yet admit real pilot
  participants; deployment and a separately authorized admission decision remain.

The additive transparency migration is number **68**, following the accepted
task migration. It creates only seller preferences and append-only attribution
storage/index/triggers. It does not rewrite historical identities, financial
references or immutable evidence. No new execution infrastructure or withdrawals
were introduced. Details: [metrics and rail contract](MARKETPLACE_TRANSPARENCY_AND_PAYMENT_RAILS.md).

## Dated live evidence and limits

[Public baseline](evidence/dependable-pilot-2026-10-14/public-baseline.json) captures
actual request times and public-only values. Production inspection found HTTP
1.116, main `96a017b`, 89 profiles, 47 registrations, 15 online, 352 listings,
83 active, nine with external payout configured, 21 completed records, $0.92
recorded volume and $0.02 fees. Reusable/instant discovery is empty. Credit is
enabled/nonredeemable; email sender is unconfigured. Legacy public data alone
cannot establish current ownership of every online agent.

Latest inspected protected reputation audit
[38267467182](https://github.com/trillskillz/clawdmarket/actions/runs/38267467182)
is dated October 12, not this local acceptance: ranking is production, empirical
promotion_ready=false, representative review pending, no scoped terminal sample.
Three stored original route requests have closed buyer rollout. This is not
calibration or independent adoption evidence. Production route metrics show zero
qualifying autonomous GMV; the three legacy route funnels lack qualifying backed
receipts even though individual completion counters exist.

The latest inspected payment monitor
[38629505398](https://github.com/trillskillz/clawdmarket/actions/runs/38629505398)
at October 14 20:08 UTC proves readiness and Base/Tempo RPC availability only.
The October 11 fresh paid run
[38153085972](https://github.com/trillskillz/clawdmarket/actions/runs/38153085972)
stopped before execution for insufficient buyer funding. Inspected successful
preflight workflows do not establish a later complete paid journey. Last complete
paid-canary success remains unknown, rather than refreshed by readiness.

Separate public Base balance reads at 21:40:54 UTC observed treasury
0.000100205551108468 ETH and dedicated buyer 0.005573 USDC plus
0.002753001248135033 ETH. They do not measure token liabilities, Tempo reserves,
worker freshness or outstanding settlement anomalies. Proposed buyer top-up for
the one $0.02 canary is 0.014427 USDC and zero ETH at that observation. No funds
were moved; refresh balances before any separately authorized action. The buyer
fee bound does not cap the treasury outbox's separately chosen fees.

## Local validation

[Source manifest](DEPENDABLE_PILOT_SOURCE_MANIFEST_2026-10-14.json) binds **134**
changed implementation/SDK/migration/workflow/packaging/test files relative to
production. [Acceptance record](evidence/dependable-pilot-2026-10-14/acceptance.json)
retains exact counts, actual exit statuses and local log SHA-256 hashes. Final text
and evidence corrections follow implementation checkpoint `ba28cd6` in the local
acceptance commit. Intermediate failures below are not counted as passing runs.

The broad enabled predeploy run completed **942 Node cases: 937 passed, five
expected skips, zero failed**, in 1,362,326 ms. It includes genuine disposable L1
and Tempo journeys, explicit buyer acceptance, confirmed payout/refund evidence,
crashes and original-reference recovery. The current targeted suite then passes
**57/57**, including the final task preference DTO and a positive independent-volume
control followed by controlled-cohort exclusion. The latter is disposable
aggregation evidence, never a claim of real independent customers.

Final TypeScript, SDK contract parity/build, **21 Python tests**, lint and production
build pass. The current operator CLIs also execute under the repository's actual
CommonJS/tsx runtime: dry run, a single disposable import, local empty report and
remote-database rejection all behave as specified. No remote connection/write
occurs in those guard tests. These focused checks cover final UI/metadata/CLI and
test refinements made during the broader run; they are not represented as a second
full-suite run on an unchanged earlier tree. A future protected CI must run the
complete gate for its exact publication SHA.

Final fresh-database Chromium acceptance passes **134/134 runnable cases**, with
**eight expected skips, zero failures and zero retries** (142 total, 6.0 minutes).
All twelve new transparency cases pass at 1440, 390 and 320 pixels, including
unavailable/stale observations, seller rail confirmation, task checkout restrictions,
credit disclosure and task-view analytics without private content. Existing long-
identity dashboards, lost-decision/recovery, privacy and payment evidence also pass.

Node skips: four retired unbacked legacy-credit paths and one unconfigured Base
Sepolia integration. Real disposable-chain tests do run; no funded public-chain
test is implied. Chromium's opt-in actual-chain and fixed-instant-database cases
remain separate from its normal browser suite. Production build retains the
existing mppx/ox dynamic-dependency warning and module-type warning; no new global
module-format change was made to silence them.

[Preservation evidence](evidence/dependable-pilot-2026-10-14/legacy-preservation.json)
shows **845 original business rows across 133 tables unchanged** in their original
columns, plus all 66 original migration metadata rows preserved. Migration/replay
reaches 68, integrity is ok, foreign-key anomalies are zero, all seven new task/
transparency tables remain empty, and all ten immutable reputation guards remain.
Final compiler compatibility executes all five actual buyer-feedback, backed-
reputation, ranking, capability-backing and verified-agent discovery queries.

Intermediate failures and corrections:

- An early broad run had two obsolete assertions: inactive public profiles were
  expected to disappear, and migration count was still 67. Expectations now match
  explicit inactive profiles and migration 68; targeted and subsequent broad checks pass.
- Initial focused fixtures omitted a required amount or requested an unsupported
  routed rail. Corrected requests are now passing; the early runs are not accepted.
- Initial Chromium found four real UI failures: malformed rail JSON could crash
  existing dashboard fixtures, and long owned-agent names overflowed small screens.
  Input handling and selector sizing were fixed. A later reused-database run had
  one setup failure because a fixed receipt hash already existed. Final acceptance
  uses a fresh disposable database, matching CI.
- One build attempt used a nonexistent temporary database directory; the initialized
  database build succeeds. One sandbox-only Python invocation could not open its
  local fixture socket; the permitted local-listener run passes all 21 cases.
- Final copy lint found two unescaped JSX apostrophes; fixed and lint rerun passes.
  Direct CLI execution exposed top-level-await/CJS incompatibility; async entrypoints
  fix it, and actual documented commands plus rejection controls now pass.
- The full dependency audit still fails. It is the explicitly open security risk
  below, not a corrected test fixture or a pass.

## Security disposition

[Full audit](evidence/dependable-pilot-2026-10-14/dependency-audit-full.json) exits 1;
[production-only audit](evidence/dependable-pilot-2026-10-14/dependency-audit-production.json)
exits 0 with zero advisories. The remaining high finding is
GHSA-vfj7-8cjw-p6xm / CVE-2026-93687, braces <=3.0.3 through
eslint-config-next → Next ESLint plugin → fast-glob → micromatch → braces.
No published compatible upstream fix was identified. No forced version, muted
audit or unrelated suppression was added.

[Risk treatment](SECURITY_RISK_BRACES_2026-10-14.md) records exact versions,
development/input reachability, controls, maintainer owner, October 28 expiry
for reevaluation and immediate upstream/config-change triggers. The audit finding
reproduces. The bounded Node 24 compile control did not reproduce a stack overflow;
it does not remediate the package. Security maintenance retains the raw failed
audit and treatment artifact while preserving failure. A production-only clean
audit is not a claim that the entire application is secure.

## Release instructions — review only

1. Resolve the upstream dependency finding or obtain an explicit time-limited
   exception under reviewed repository policy. This document does not approve one.
   Obtain new publication authorization for the exact reviewed commit. Do not push,
   merge, dispatch deployment or edit remote metadata from this preparation.
2. Verify the source manifest, Node 24, frozen lockfile, the repository release
   checks, full dependency audit, build and browser acceptance on that commit.
   Use an isolated database. Do not run `pnpm deploy` as a local validation command;
   it publishes to production.
3. After authorization, follow the existing protected CI and migration-first
   deployment workflow for the exact accepted SHA. Backup/recover through the
   existing approved operator process. Apply `pnpm db:migrate:runtime` (68 total),
   then `pnpm db:verify:evidence` against the target before serving new code.
   Never export private production records into these public evidence files.
4. Confirm same-SHA CI, deployment and smoke results on both domains. Inspect HTTP
   1.118, schema readiness, truthful inventory/cohort fields, stale/error behavior,
   seller rail settings and original order recovery. These future checks have not
   run against production and cannot be inferred from local pass counts.
5. Require operator-reviewed cohort records, owner-confirmed seller rails, intended
   payout destinations and an actual ready provider before admitting the proposed
   pilot. Configure a verified Resend sender and verify the entire recovery flow
   through the provider sandbox or approved inbox; configuration alone is not delivery.
6. Use the separate operational records for fresh reserve/worker/anomaly checks.
   Preserve rollout scope. Fund or execute the
   [prepared capped canary](CAPPED_PAID_CANARY_PREPARATION_2026-10-14.md) only after
   specific live-payment authorization, exact approved identities/terms, current
   balances and a reviewed treasury fee bound. Record original confirmed hashes,
   accepted delivery and terminal balances before reporting success.
7. Publish the [prepared repository description](GITHUB_DESCRIPTION_PREPARED_2026-10-14.md)
   or promotional drafts only with separate authorization. Execute the
   [opt-in recruitment plan](INDEPENDENT_API_TESTING_PILOT_2026-10-14.md) only after
   outreach approval. Actual paying customers and repeats remain unmeasured here.

## Rollback and financial recovery

No production deployment occurred, so there is no live rollback to execute now.
Local checkpoints are retained without rewriting the accepted task/listing history.

For a future deployment incident, stop admission of **new** obligations using the
existing approved incident procedure before selecting a fallback. Do not disable
recovery workers, erase signed bytes/claims, delete migrations or rewrite evidence.
Keep original funding intents, nonce/transaction hashes, delivery hashes,
acceptance records, payouts and refunds. Already-sent payment evidence and late
refund recovery retain their original authority.

Migration 68 is additive; leave its tables and immutable records in place. An
older binary does not enforce new seller preferences, so a simple code rollback
without an admission hold can permit newly unsupported payments. Prefer a forward
fix or a recovery-compatible reviewed binary while new admission is held. If any
new reviewed-task obligation exists, do not blindly roll back to production 1.116:
it lacks accepted local 1.117 task recovery endpoints. The accepted task checkpoint
`a8f870f` supports that recovery but does not enforce the new rail policy.

Reconcile each outstanding original obligation through the existing outboxes and
confirm exact chain amounts and terminal state. Do not create replacement orders
or payments to recover from an uncertain transport response. Rollback is never
permission to change custody or abandon a funded seller/buyer obligation.

## External dependencies and exact pending actions

- Security: compatible published upstream fix, or explicit reviewed risk exception;
  the full high-severity audit is still failing.
- Production recovery: verified sender configuration and approved provider/inbox
  delivery test. No real email was sent by these tests.
- Attribution and pilot: reviewed persistent operator records, current ownership,
  confirmed seller rails/payouts and actual consenting external provider/customer.
  Deploy the reviewed task path and obtain a real-buyer admission decision without
  changing global flags or borrowing an operational canary identity.
  Unknown ownership, fixtures and registrations do not establish independent demand.
- Operations: fresh authorized worker/anomaly/remaining-reserve observations and
  a separately reviewed/enforced or authorized treasury fee ceiling.
- Publication: exact commit authorization, protected CI, migration-first deployment,
  same-SHA smoke and optional prepared repository-description update. None executed.
- Live canary: explicit funding/payment authorization for the reviewed one-order
  proposal, refreshed balances and original-reference journals. None executed.
- Recruitment: explicit outreach approval before using the prepared opt-in plan.
  No prospects/providers were contacted and no testimonials/activity were fabricated.
