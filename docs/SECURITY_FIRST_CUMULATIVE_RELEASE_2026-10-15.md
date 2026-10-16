## Production database read block — 2026-10-16 02:52 UTC

Security prerequisite PR275 passed all four protected checks and merged as
764398c16bd020355d3c6c91153b5ac1d6a4b07c using the required squash method.
Its deployment is in progress, but the approved protected-main recovery run
38842433871 failed: Turso returned403 with SQL read operations blocked. No
production snapshot or encrypted artifact was created. Fresh production readiness
is503 (database unavailable, configuration and Base/Tempo RPC checks healthy),
while legacy stats incorrectly return HTTP200 with zero online/listing counts.
Those zeros are unavailable data, not a measured activity decline. Production
still advertises HTTP1.116. Operator restoration of database read access is needed
before backup, migration79 and cumulative production publication. No billing/
plan change, environment-policy bypass or production restore is attempted.

The first broad enabled local gate passed1183 cases:1178pass/5expected skips.
After the auth correction, the frozen1185-case gate had1179pass/1fail/5skips:
a separate-process listing/workflow fee race found a second unguarded read in
route-mandate preflight. That read-only fix and an actual exclusive-lock control
are being verified; explicit transaction sources retain their original boundary.
The final frozen Chromium suite passed165 cases/8expected skips/0retries.
The subsequent fully enabled release gate remains required before acceptance.
The earlier in-progress status below is historical where superseded here.

# Security-first cumulative release

Current status: validation and staged publication in progress. This record is not
production acceptance. Cumulative source manifest:
`SECURITY_FIRST_RELEASE_SOURCE_MANIFEST_2026-10-15.json`,236 source/config/test files,
SHA256 `380b80f6703b59ff3ac4b704569e42fdd9bb90a70fcadbb46313390e1eecb2c7`.
Local HTTP1.119/schema79; fresh reviewed-contract funding defaults disabled.

## Findings and changes

The [ten-part issue register](DEPENDABLE_PILOT_ISSUE_REGISTER_2026-10-14.md) retains
all findings and evidence. The braces dependency path is actually removed: the
scoped Next16.3.8 patch replaces its sole fast-glob use with bounded Node24 native
root discovery, and the exact-version hook removes that unused dependency.
Frozen installation, full and production audits pass with zero advisories/mutes.
No upstream braces fix, audit exception or blanket suppression is claimed.

Purchasing changes enforce supported seller rails for new obligations and disclose
nonwithdrawable credit. Metrics distinguish authoritative controlled/unknown
cohorts, profiles/registrations, actual executable inventory and recorded versus
attributable activity, with unavailable/stale reporting. Recovery delivery has
bounded failure handling; evidence/verification/reputation labels describe finite
observations and pending calibration. Original reviewed task/listing/contract
references, outputs, exact buyer consent, separate release and recovery preserve
financial history and original settlement terms. Operator/pilot setup and minimal
privacy-preserving funnel/cost measurements are prepared without customer activity.

Additional release findings: Vercel excluded the new contract worker; the explicit
allowlist repair now builds in preview. Test HTTP transports echoed exception
text and used a loose fixture URL prefix; those are repaired. Two remaining
Advanced Security hash annotations are separately [triaged](CODEQL_RELEASE_TRIAGE_2026-10-15.md):
legacy random API-token compatibility and immutable receipt identity, neither a
human-password hash. Their aggregate remains failed/visible; required analyses
pass. No stored credential or financial hash identity is rewritten to silence it.

Remote security maintenance passed dependency auditing but exposed a real local
SQLite ban-read race before the purchase transaction. Bounded fresh read recovery
now includes client construction; exhausted errors propagate and bans stay denied.
Actual exclusive-lock controls plus moderation/JWT/task races pass17/17.

## Validation actually run

- Security: full/production audit0; frozen install0; three named retained-lint,
  native glob and upgrade-drift cases pass without skips.
- Fresh funding: two named aggregate cases cover18 post-approval authority/
  agreement/expiry changes; both pass without skips and without financial writes.
- Authentication correction:17/17 cases pass, including two actual lock controls
  and all12 separate-process task race/commit-boundary cases; types/lint pass.
  An initial focused invocation omitted the legacy root schema and failed2 tests
  for missing tables; corrected initialization passes. Raw failed logs remain.
- Earlier cumulative build and165 runnable Chromium cases pass with8 expected
  skips and no retries. The final frozen build/predeploy/browser runs are in
  progress after the authentication correction; final counts are not claimed yet.
- All79 migrations and replay preserve845 original LOCAL baseline rows across133
  tables, with integrity ok, zero FKs, immutable guards and five real evidence
  queries. Isolated LOCAL backup restore passes. This is not production data.
- Private actual-production backup and local migration rehearsal remain pending.
  The first backup dispatch failed before any step because production only allows
  protected branches; the policy is unchanged.
- Read-only operating reserve checks pass: Tempo8.56529 pathUSD and
  Base0.000100205551108468 ETH at this observation, above existing minima. They
  establish neither settlement-worker/anomaly health nor a paid canary.

## Publication and deployment

The user authorized GitHub/Vercel publication after fixing security, then approved
both the private full production recovery copy/local restore and encrypted
artifact transfer with deletion. PR275 is a small security/backup prerequisite
based on production96a017b; no purchasing handlers or migrations change there.
PR274 carries the cumulative marketplace candidate. Repository description is
already corrected and read back. Neither PR's production acceptance is claimed.

1. Merge PR275 only through all four required protected checks and validate its
   same-SHA deployment/smoke. Schema66 replays unchanged; no new admission flags.
2. Dispatch Audit Internal Credits from protected main with only the operator's
   base64 public X509 certificate. Its optional backup job uses existing protected
   database credentials for a read-only native replica, consistent SQLite backup,
   integrity/FK/source-count validation and AES256GCM CMS encryption. Only encrypted
   transport/checksum are artifacts, retained at most one day. Runner plaintext
   is cleaned on failure too; the local private key is never uploaded.
3. Download into the approved mode700 private operator directory, verify/decrypt,
   validate a separate local restore, migrate it to79 and replay, compare all
   original table/column record fingerprints and verify guards/evidence queries.
   Publish sanitized results only. Delete the remote encrypted artifact after
   download. Do not commit snapshots, credentials, private keys or row data.
4. Integrate protected main into PR274, verify the frozen runtime/config/test
   hashes and finish current local gates and exact-head protected CI. Merge via
   protection; existing deployment applies additive schema79 before serving code,
   verifies evidence queries, builds and aliases both canonical domains.
5. Verify exact merged-SHA CI/deployment/smoke, both domains' HTTP1.119/readiness,
   precise inventory/cohort/credit disclosures and paid recovery. Keep fresh
   reviewed-contract funding and other rollout scopes at their existing defaults.
   No production funding, provider execution, customer creation or email is part
   of this release procedure.

## Rollback

Prefer a forward correction or a reviewed recovery-compatible binary with new
admission held under the existing incident procedure. Keep original orders,
funding proofs, client references, immutable output/consent/ledger rows, receipts,
refunds, organization attribution, consumed inventory and migration tables. Never
adopt a paid status as exact buyer consent, restore generic hashless handlers for
reviewed work, reopen consumed inventory or rewind customer balances. Once newer
paid obligations exist, production1.116 lacks their recovery APIs and seller-rail
checks. A simple old-binary rollback or snapshot restoration is not safe. The
private recovery snapshot is retained for operator incident recovery; production
restoration needs a separate reviewed decision and is not executed here.

## External requirements and precise remaining authorization

Configure a verified recovery sender and test an approved provider sandbox/inbox;
only local transport-sandbox delivery has been demonstrated. Obtain owner-reviewed
cohort attribution and seller-rail confirmation, ready independent providers and
consenting customers for the narrow API-testing pilot. Representative reputation
review/calibration and contribution-margin/intervention observations remain pending.
No customer demand, independent economic activity or production canary is proved
by controlled tests or readiness checks.

A live canary still needs specific authorization for its dedicated identities,
fresh balances, exact original references, maximum0.02 BaseUSDC purchase and a
separately enforced treasury gas budget. The historical0.014427 USDC top-up estimate
is stale and must be rechecked; publication/backup permission does not fund it.
No outreach, synthetic reviews/purchases/providers, withdrawals, custody change,
real-user test email or global execution-flag change is authorized.
