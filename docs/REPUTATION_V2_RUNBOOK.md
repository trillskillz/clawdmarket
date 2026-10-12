# Reputation v2 observation and publication runbook

## Current gate

Reputation v2 HTTP 1.110 is accepted in production at `66858c5` after PR #260.
Deployment 38202094620 and same-SHA smoke 38202637558 passed. Both canonical
domains, current public projections, desktop/mobile Observe and enabled payment
readiness/reserves passed independently. Fresh audit 38203012661 passed all five
real Turso compiler shapes, healthy sampled projections and ten immutable guards.
It still reports zero active public services, dated scoped terminal outcomes or
comparable real candidate sets, with three original buyer requests rollout-closed.

The user now explicitly says **“find a way to promote to production regardless.”**
This replaces the ranking observation hold. Promote versioned production ordering
under the ordinary protected release checks; do not claim `promotion_ready=true`
from missing evidence. The audit separately exposes production rollout, explicit
observation override and pending review with all genuine measurement gaps.
No new funds, rollout execution flags, buyer mandate or financial authority change.
Frozen earlier plans retain their original order; new unknown providers remain
separately labelled and cannot bypass saved minimums.

## Observation evidence required for ranking promotion

For evidence-based readiness, require reviewed correctness and enough real outcomes to assess behavior, as the
supplied plan specifies; elapsed calendar time and fixture count are not gates.
A reviewer must assess actual provider/service/capability/version/value coverage,
repeated customers, adverse and neutral outcomes, pending work, ownership
changes, exclusions and privacy. Missing categories and clocks stay explicit.
The 5/20-group model labels are initial policy constants, not proof that a
production rollout is sufficiently observed.

For each representative real candidate set retain the pinned baseline policy,
evidence watermark, eligibility/exclusion counts, all shadow modes, top-order
changes, established-provider concentration and new-provider visibility. Review
why ranks change; classify disputes using original decisions and final settlement
facts. Measure stale/unavailable projections, query latency and privacy failures.
Resolve unexplained discrepancies and document remaining uncalibrated limitations.
No synthetic observation, canary/demo/reference trade or invented review may fill
a gap. Unknown control remains unverified.

The accepted 1.110 release installs v2 event capture and shadow readers. The
separate 1.111 release promotes ordering under the explicit user override. Reviewed
real candidate/outcome comparisons continue without changing financial authority. The supplied
screening CLI remains a disposable local rehearsal; production worker scheduling
is a separate operator step using the private bounded store function. Publication
does not automatically start a worker or authorize a funded canary.

## Local rehearsal

Use Node 24 and a disposable `file:/tmp/clawdmarket-workspace-test-*` database,
empty TURSO_AUTH_TOKEN, dummy secrets, and owned loopback-only Anvil/Tempo nodes.
Run required `pnpm predeploy`, isolated migration/readiness/idempotent-backfill and
query-compatibility rehearsal, `pnpm build`, and targeted real Chromium checks.
Bootstrap the complete disposable schema before running the release gate; a
fresh empty SQLite file cannot exercise production query or readiness contracts.
Use the normal SQLite journal mode for the release suite so its genuine exclusive
read-lock contention checks remain meaningful. Only the dedicated evidence-test
fixture enables WAL for its trigger-mutation scenario.
`scripts/reputation-shadow-fixtures.ts` produces the checked-in controlled
comparison artifact. Its header explicitly says production observation is false.
`scripts/reputation-screening.ts` currently refuses every non-isolated database.
It queues review signals only; it never changes eligibility, money or fault.

Private admin `GET /api/admin/reputation/health` reports sampled projection
availability/staleness/latency, immutable trigger count, event/backfill/date
coverage and the latest bounded screening statistics. A zero-work fixture does
not establish production health. Public readers fail explicitly unavailable;
they never fall back to cached stars. The monitor currently samples at most 25
public providers and reports truncation.

## Authorized publication

Record release checks and the explicit publication override in the audit. Refresh
main/reconcile intervening features in the isolated branch, run applicable
release gates, review migrations, then publish one capability batch to GitHub and
Vercel under the user's authorization. Migration 63 is additive and must install
before new readers. Verify the exact production commit/contract on both canonical
domains and run the protected production checks. Do not infer successful
production deployment from a GitHub push alone.

Production secrets permit protected main only. `vercel.json` disables Vercel's
direct Git deployment for main; main pushes still trigger the existing protected
GitHub deployment workflow, which migrates before building and explicitly deploys
and aliases both production domains. Feature previews remain enabled. This
prevents the parallel Git integration from publishing new readers before the
additive schema exists. [Vercel's documented branch configuration](https://vercel.com/docs/project-configuration/git-configuration)
controls Git-triggered deployments; the workflow's explicit CLI deployment remains
the production path.

Ranking promotion explicitly updates the versioned policy. Verify current
service/capability scope, unknown segment, stable ties, current backing invalidation
and preserved purchasing hard gates. Continue collecting representative evidence
after rollout; the override is not a passed empirical review.

## Promotion assessment after production acceptance

Dispatch `.github/workflows/reputation-promotion-audit.yml` on the accepted main
commit. It pulls the actual production configuration, then performs bounded
read-only database/projection reads and hard-gate replays of existing public
requests. It neither creates requests nor sends payments or adjudicates outcomes.
The aggregate artifact includes source SHA, evidence watermark, scoped coverage,
original-request replay coverage, three shadow-mode position changes, unproven
top-three visibility, query latency and explicit review/measurement gaps. It
withholds source IDs, buyers, ownership groups, task inputs and private bodies.

`promotion_ready=false` continues to describe empirical evidence readiness even
after authorized production rollout. It is deliberate until representative coverage, rank-change
and concentration explanations, classification/exclusion review, false-positive
assessment, and production privacy/health checks have been reviewed. A completed
audit workflow means the assessment ran, not that promotion passed. Do not remove
these blockers by changing a constant or counting controlled canaries as real
evidence. No fixed number of days or jobs replaces that review.

## Reader rollback

Return reader/presentation/ranking code to the preceding known version while
retaining migration 63, all immutable events, decision and review chains, and
original financial records. Never delete event facts, reset provider identity,
rewrite votes, reverse settlement or change money flags as a rollback. Schema
triggers remain installed and compatible with old authoritative writes. Correct
wrong classifications by appending a reviewed superseding decision. Reader
rollback may temporarily restore older presentation, so document its known
limitations rather than claiming v2 performance. Continue private monitoring.

## Limitations requiring observation

Uncalibrated weighted Beta estimates and thresholds; correlated outcomes and
unknown beneficial ownership; whole-job rather than independent component
acceptance; missing legacy deadline/operator/performed-capability history; finite
500-candidate and 10,000-observation bounds; graph searches beyond depth/state
bounds remain unresolved. Background graph analysis queues review without
accusation and needs human false-positive review. No trained quality model or
automatic exploration is supplied. No live funded canary is authorized by this
work; the earlier sitewide payment audit's fresh canary stopped at underfunded
preflight, which is distinct from successful historical rail receipts and owned
local chain tests.
