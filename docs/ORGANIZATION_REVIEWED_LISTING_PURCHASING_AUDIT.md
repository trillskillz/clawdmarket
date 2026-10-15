# Reviewed listing local candidate — final acceptance in progress

Integrated implementation checkpoint **6ae6dbb**, local HTTP **1.119**, additive migrations **71**, branch
`work/local-reviewed-listings-after-pilot-2026-10-14`, based on preserved local
pilot candidate `bee652c` and inspected production
`96a017b6019920f47af32d86a7e476c9b9c07808`. Separate original claim checkpoint
`b233dfd` passes 91 focused cases and migration preservation. The integrated
[source manifest](ORGANIZATION_REVIEWED_LISTING_SOURCE_MANIFEST_2026-10-14.json)
binds 167 changed implementation/SDK/migration/workflow/packaging/test files
against that production base. Its SHA-256 is
`3b7a359f75629c9fd9d1bccb6d030a45d27913950a01e9a43be419024141a88f`;
all 167 current hashes match. Documentation is excluded. The source is local only. No push, PR, deployment, live funds, global flag,
custody change, real-user email or recruitment action has occurred.

**Accepted capability count remains 7/10 while complete final gates run.** This
record must be updated with their actual exit status before claiming the listing
outcome accepted. The full dependency audit still exits **1**, one high advisory
GHSA-vfj7-8cjw-p6xm (`braces <=3.0.3` in development ESLint dependencies), no
published patched range. Production-only audit exits **0**, all severity counts
zero. Raw current audits are retained under
`evidence/reviewed-listing-2026-10-14/`. No exception is approved and no audit is
suppressed. See [the tracked treatment](SECURITY_RISK_BRACES_2026-10-14.md).
Application acceptance cannot turn this into an unqualified security release.

## Changes and original identity

The [listing contract](ORGANIZATION_REVIEWED_LISTING_PURCHASING.md) describes the
exact one-listing external purchase. No service, task, route or workflow identity
is fabricated. Review takes no inventory hold against unrelated buyers, but the
original buyer cannot bypass review through generic checkout. One consumed
listing retains its one original trade after revocation, cancellation or refund.
Fresh permissions, exact frozen listing/quote, current seller rails, buyer and
organization budgets, gross/same-currency fee limits, reserves and shared wallet
nonce claims are checked independently of historical proof recovery.

Frozen private finite requirements govern original delivery. Structural checks
and artifact integrity do not authorize payment. Explicit original buyer
acceptance of the exact content hash is required; auto-confirmation is disabled.
Finite buyer/seller clients persist original requests, payment bytes, output,
attachment references and receipts across uncertain replies and process death.
Legacy listing IDs and canonical agent IDs retain their meaning. Both SDKs keep
explicit scope and original-reference recovery without automatic mutation retry.
Private human pages show the actual frozen review and participant delivery;
bounded artifacts are digest checked, untrusted output/URLs remain inert text,
and stale/private inspection is cleared. Trade history links this exact work
and keeps existing dispute access; its hashless release control is unavailable
for reviewed listing trades.

## Completed evidence before full gate

- `/tmp/clawdmarket-listing-economic-process-current-2026-10-14.log` exits zero:
  **16/16**, no skips/failures. Both real disposable unforked L1 and pinned Tempo
  journeys use legacy listing IDs and public dummy identities. Original funding,
  buyer/seller restarts, exact acceptance, confirmed payout, actual revoked late
  refund and final-send revocation pass. Buyer checkout/claim and seller delivery
  each survive both sides of their actual HTTP commit boundary. Separate review,
  approval and checkout survive real before/after-transaction SIGKILL. Inventory
  races retain one original trade. These are controlled acceptance fixtures,
  excluded from independent adoption, not live paid canaries or real demand.
- `/tmp/clawdmarket-listing-shared-process-first-2026-10-14.log` passes the 24
  sequential listing/task/route/workflow gross/fee and both reservation-order
  cases. Its 12 post-race inspections initially used an invalid test-only task-use
  buyer column; corrected current concurrent run
  `/tmp/clawdmarket-listing-shared-process-current-2026-10-14.log` passes **12/12**.
  Actual separate-process races, exact losing retries after cancellation and
  original one-trade history pass on both rails.
- `/tmp/clawdmarket-listing-participant-final-focused-2026-10-14.log` passes
  **51/51**, no skips/failures: current private delivery/checkout, named credential
  scope, CSRF, bounded bodies, current canonical contract and TypeScript listing
  SDK. Owners/reviewers cannot retrieve private participant output.
- `/tmp/clawdmarket-listing-sdk-http-current-2026-10-14.log` passes eight listing
  and task SDK cases with genuinely lost local HTTP replies. Python run
  `/tmp/clawdmarket-listing-sdk-python-first-2026-10-14.log` passes **24/24**.
  SDK parity/build pass. The complete gate will rerun these against final source.
- `/tmp/clawdmarket-listing-build-final-2026-10-14.log` exits zero for the current
  production build. Existing MPP/Tempo dynamic dependency warnings remain.
- Full enabled predeploy is running in
  `/tmp/clawdmarket-listing-predeploy-final-2026-10-14.log`. Full built Chromium
  passes in `/tmp/clawdmarket-listing-browser-final-2026-10-14.log`: **157 total,
  149 passed, eight expected skips, zero failures and zero retries**, 4.8 minutes.
  All 15 new owner/reviewer and buyer/seller listing journeys pass at desktop,
  390px and 320px. Both use fresh fully
  migrated disposable databases; the browser database uses WAL for concurrent
  fixture/page reads and writes. The enabled predeploy final outcome
  is pending; the earlier targeted browser run had 13 pass/two mobile overflow
  failures, now corrected in the final build.
- Fresh original-database migration/replay/row preservation and five evidence
  queries pass in `/tmp/clawdmarket-listing-final-preservation-2026-10-14.log`.
  The previous migration-71 report preserves all original 845 business rows/133
  tables, ten immutable guards, original migration rows, zero inherited new
  authority, integrity `ok` and zero foreign-key anomalies. The fresh final run also exits zero with exactly these counts.

A first broad gate was stopped after seven existing admin/agent-auth failures
showed its disposable database had not been initialized/migrated (including a
missing api_key_prefix column). Its successful financial cases remain recorded,
but it is not an accepted full run. First full browser: **144 passed, eight
expected skips, five failed**; all 15 new listing cases passed. Missing runtime
migration readiness caused four operational-console failures, and an existing
cycle fixture write failed under concurrent local reads. A targeted rerun after
migration passed three/five, but reused fixed receipt IDs collided and another
cycle write failed. The final unchanged-source run uses a fresh migrated WAL
database, not that reused fixture state. No runtime guard or test expectation
was relaxed. The unchanged-source final browser run passes all 149 runnable cases. Its eight
expected skips are three retired unbacked-credit journeys and five scenarios
requiring separately supplied live economic browser fixtures; real disposable
L1/Tempo economics is tested in the Node suite. Enabled predeploy remains pending.

Initial failures are retained honestly: missing error-code/SDK operation types,
permissive new TypeScript reference validation, test response inference, faulty
post-race inspection, rate-limit admission contention before inventory CAS,
mobile preformatted output overflow, and a build database parent directory/setup
namespace issue. Corrections preserve policy/rate limiting and original payment
semantics. No retry changes a saved financial reference or signs new bytes.

## Fresh public baseline recheck

Read-only recheck at `2026-10-15T03:23:29.701Z` still finds main
[`96a017b`](https://github.com/trillskillz/clawdmarket/commit/96a017b6019920f47af32d86a7e476c9b9c07808)
and live HTTP **1.116**. Public statistics remain 89 profiles, 47 registrations,
15 recently online, 352 legacy listing records/83 active, 21 completed trades,
$0.92 recorded volume, $0.02 fees and zero recorded volume over 24 hours. There
are 23 total trade records, which differs from completed trades. These legacy
production fields are not the local cohort/executable-service terminology, and
cannot establish independent ownership or customer demand. Public JSON and
recent CI records are saved under `evidence/reviewed-listing-2026-10-14/`.
Latest main payment monitor is
[38666090566](https://github.com/trillskillz/clawdmarket/actions/runs/38666090566),
created `2026-10-15T01:31:12Z`, successful on the same production SHA. Inspection of its public log confirms a GET of `/api/health/ready` and
checks of enabled rails and Base/Tempo RPC health only. This monitor
readiness must not be presented as a new successful paid canary. No fresh live
paid journey was run by this work.

## Release, rollback and external actions

The ten-part dependable-pilot [finding register](DEPENDABLE_PILOT_ISSUE_REGISTER_2026-10-14.md)
and [release/rollback audit](DEPENDABLE_PILOT_RELEASE_CANDIDATE_AUDIT_2026-10-14.md)
remain applicable, with their preserved source bound to `bee652c`. This integrated
listing candidate needs its own source manifest and final acceptance. Still
external: a compatible security fix or explicitly approved scoped exception;
configured recovery email and approved-inbox delivery verification; reviewed
cohort/seller settings; independently admitted real participants; current worker,
anomaly/reserve evidence; approved pilot recruitment; and specifically authorized
publication/funding. Fixture outcomes do not demonstrate those dependencies.

After explicit publication authorization and security treatment, run protected
checks on the exact reviewed source; back up the database; migrate runtime schema
**before** deploying the matching application; verify the same deployed SHA,
contract 1.119 and scoped live read-only smoke. Do not dispatch workflows, push,
change repository metadata, deploy or enable global execution automatically.
Before rollback, inspect original pending claims, receipts and settlement
outboxes. A pre-listing application is compatible only when every listing ledger
below is empty. A pending/revoked grant still blocks review bypass, and even a
completed original use must retain consumed-listing exclusion. Once a grant/use
exists, retain the listing financial handlers and recovery APIs; roll back only
presentation/admission or prepare a compatible recovery release. This read-only
check establishes compatibility; it does not authorize clearing any records:

```sql
SELECT 'listing_reviews' AS ledger, COUNT(*) AS rows FROM organization_listing_authorizations
UNION ALL SELECT 'listing_uses', COUNT(*) FROM organization_listing_uses
UNION ALL SELECT 'listing_evm_claims', COUNT(*) FROM organization_listing_payment_claims
UNION ALL SELECT 'listing_tempo_intents', COUNT(*) FROM organization_listing_mpp_intents
UNION ALL SELECT 'listing_tempo_claims', COUNT(*) FROM organization_listing_mpp_claims;
```

Retain all additive authority/use/claim tables,
financial references, immutable evidence and attribution. Do not reactivate a
consumed reviewed listing, clear a wallet hold or replace an original operation.

Live paid canary remains separately unauthorized. The parent proposal was one
$0.02 Base-USDC canary, with a snapshot-based $0.014427 buyer top-up and zero new
native funding; balances must be reread, original approval/state retained and the
treasury worker fee ceiling separately bounded and authorized before execution.
That proposal does not authorize running listing L1/Tempo purchases or count as
an executed canary. No real prospect/provider contact is authorized.
