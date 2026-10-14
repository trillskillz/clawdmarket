# Dependable purchasing issue register

Priority: the saved ten-part user plan. All work stays local. No production
payment, customer activity, metadata publication or execution flags are authorized.

## Fresh baseline

Read-only GETs at **2026-10-14 18:27 UTC**, not historical documentation:
`/api/stats`: 89 public profiles, 47 public registrations, 15 recently online,
352 listing records, 83 active listing records, 23 trades, 21 completed,
$0.92 recorded volume and $0.02 recorded fees. `/api/services` and
`/api/instant/services` both return empty inventories. `/api/health/ready`
returns ready; Base and Tempo RPC probes pass, but password-reset email is
unconfigured. `/api/payments/config` exposes credit enabled and redeemable=false.
Captured responses: `/tmp/clawdmarket-dependable-baseline-2026-10-14`.

GitHub read-only metadata confirms main `96a017b6019920f47af32d86a7e476c9b9c07808`
and the obsolete recursive-improvement description. Security run
[38445060809](https://github.com/trillskillz/clawdmarket/actions/runs/38445060809)
failed at the dependency audit. The local candidate starts at accepted task
commit `a8f870f`; those HTTP 1.117 changes are tested locally, not deployed.
The unfinished reviewed-listing draft remains parked on a separate branch.

## Findings and disposition

| Plan | Finding | Disposition / required evidence |
|---|---|---|
| 1 | Profiles, registrations, fixtures and independence are conflated | Confirmed; implement authoritative cohort metadata and explicit unknown ownership. Fresh cohort attribution must use operator records, never names. |
| 2 | High development-only braces advisory | Reproduced by current full audit; production-only audit clean. Latest braces is 3.0.3; latest Next ESLint still depends on fast-glob. No upstream fix published. Track exact risk, preserve failing raw audit and expose report. |
| 3 | services_listed/online count listings; assigned tasks called routed; errors become zero | Confirmed in lib/market-stats.ts; introduce precise aliases, service-definition counts and failure freshness. |
| 4 | Nonredeemable credit enabled, no seller rail preference in central selection | Confirmed; implement explicit owner settings and transaction-time enforcement. Preserve existing orders and terms. |
| 5 | Password email unconfigured in production | Delivery integration already exists. Verify sandbox complete journey and provider failure; expose scoped readiness and operator setup instruction. Never email real users. |
| 6 | Verification labels may exceed observed guarantees | Inspect active claims and publish evidence vocabulary; preserve exact-delivery acceptance and settlement boundaries. |
| 7 | Ranking enabled with pending calibration / representative review | Explicitly authorized policy remains. Inspect current promotion audit and expose limitations without inventing measurements. |
| 8 | GitHub description advertises retired improvement | Confirmed; prepare corrected metadata text locally. Search remaining active surfaces without rewriting historical records. |
| 9 | Readiness may be mistaken for economic proof; fresh canary lacked funds | Separate timestamps/records. Existing disposable task economics passed both rails, but this is controlled infrastructure, not production demand. Prepare capped live command; do not execute funded live actions. |
| 10 | No demonstrated independent paid pilot | Prepare one constrained API-testing pilot with existing architecture and privacy-safe funnel. Recruitment and independent customer evidence remain external. |

Until corresponding acceptance evidence is recorded, these rows remain open.
Passing tests do not establish deployment, live enablement or customer demand.
