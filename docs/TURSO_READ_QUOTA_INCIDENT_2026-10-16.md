# Turso read-quota incident — 2026-10-16

Reads recovered at 03:07:56 UTC after the owner completed monthly Developer
checkout. Authenticated checks confirm `developer/monthly`, `overages=false`,
`blocked_reads=false` and `blocked_writes=false`. Both domains return HTTP 200
readiness with database and configured payment RPC checks passing. Password-reset
email remains unconfigured. The diagnostics below record the incident.

## Cause and scope

At 03:03–03:06 UTC, the owner API reported Starter with overages disabled and
reads blocked. Consumption was 507,088,334 / 500,000,000 rows read; 532,655 /
10,000,000 rows written; 3,751,936 / 5,000,000,000 storage bytes; and zero /
3,000,000,000 embedded-sync bytes. All recorded database usage belonged to
ClawdMarket; the second database had zero measured usage. These are resource
measurements, not customer activity or economic adoption.

Production readiness returned 503 because SQL reads were forbidden. Configuration
and Base/Tempo RPC observations passed separately. Legacy production stats returned
200 with zero counts on the failed data source; those zeros meant unavailable data.
The cumulative candidate explicitly reports unavailable/stale observations.

The first protected backup failed during initial sync, cleaned plaintext, and
uploaded no encrypted artifact. It did not produce a recovery point.

## Authorized recovery and billing cap

The owner authorized restoring reads and completed official account login.
Automatic approval review rejected the proposed Starter overage setting because
it would permit uncapped billing. That change was not executed. The owner chose
to keep billing capped and completed Developer checkout privately in the official
billing dashboard. No database locations, credentials or custody changed.

The authenticated plan API lists monthly Developer at $5.99, including 2.5 billion
reads, 25 million writes, 9 GB storage and 10 GB sync. Overages remain disabled.
Both databases share the default group's sole `aws-us-east-1` region. The CLI still
reports two used locations against Developer's allowance of one, while reads are
healthy and the upgrade was accepted. Keep this provider discrepancy visible for
support review; do not silently remove a location or purchase a larger plan.

Sources: authenticated GET `/v1/organizations/trillskillz`, `/plans`,
`/subscription`, `/usage`, `/groups` and `/billing/payment-methods`; official
[pricing](https://turso.tech/pricing),
[organization controls](https://docs.turso.tech/api-reference/organizations/update),
and [CLI billing implementation](https://github.com/tursodatabase/turso-cli/blob/v1.0.34/internal/cmd/plan.go).
Only aggregate availability/quota evidence belongs in public release records.
Tokens, private billing details and recovery records stay outside git.

## Recovery point and prevention

Protected-main backup [38843991825](https://github.com/trillskillz/clawdmarket/actions/runs/38843991825)
succeeded after access recovery. Its recovery point synchronized at 03:08:40 UTC
with 66 migrations, integrity passing and zero foreign-key anomalies. The approved
AES-256-GCM artifact 12022281799 was privately downloaded, checksummed and decrypted,
then deleted remotely; the run now has zero artifacts. A separate local restore
migrated to 79 and replayed, preserving every original record/column across 136
tables and all 66 original migration entries. Immutable guards and all five evidence
queries passed. Production restoration was not performed. This does not refresh a
paid-canary timestamp. [Sanitized evidence](evidence/security-first-release-2026-10-15/production-recovery.json).

Inspect authenticated quota totals at least daily during the pilot. Record
`observed_at`, totals, allowances and blocked flags separately from request and
customer metrics. Investigate at 80% and arrange a reviewed bounded capacity
change before 95%; exhaustion still blocks reads with overages disabled. Preserve
billing caps. Aggregate exhaustion is established; no query trace has established
which traffic/query shapes consumed the allowance.
