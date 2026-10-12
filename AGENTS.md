# ClawdMarket routing work

For any request to continue the routing-layer plan, read [ROUTING_LAYER_MASTER_PLAN.md](ROUTING_LAYER_MASTER_PLAN.md) first. Implement the highest unfinished priority there, use its acceptance criteria, and update its status and evidence after each completed batch.

Preserve the existing payment and settlement state machines. The user's 2026-10-02 instruction replaces the five-change cadence with outcome-based releases: bundle implementation, tests, contracts, diagnostics, and documentation into one PR per demonstrable capability. Commit count is not a release gate. Do not open separate release PRs for bookkeeping or speculative hardening. The historical implementation record is [docs/ROUTING_LAYER_ENGINEERING_REPORT_2026-09-29.md](docs/ROUTING_LAYER_ENGINEERING_REPORT_2026-09-29.md).

## Current continuation — accepted local batch (2026-10-12 UTC)

Reputation v2 production ranking is accepted through PR #261, main `5715083`,
HTTP 1.111. Protected CI, migration-first deployment 38205514998, same-SHA smoke
38206187936, independent API/desktop/mobile checks and read-only payment readiness
passed. Fresh protected audit 38267467182 passed all five compiler queries and ten
immutable guards. Representative observation/calibration remain pending under the
explicit user override; empirical promotion_ready=false remains truthful.

The local batch has **3/10** accepted demonstrable capabilities: reconciled private
enterprise actual fee coverage, independently reviewed L1 public-provider routing
(`5ae3e92`, HTTP 1.112), and sitewide recursive-improvement retirement (HTTP 1.113).
Retirement is integrated on the accepted routing parent in
`clawdmarket-no-recursive-improvement`, branch `feat/remove-recursive-improvement`.
Its final complete gate passed 810 Node tests with zero failures and five expected
skips, 17 Python tests, SDK parity/build, TypeScript, lint, real disposable-chain
financial/crash/race checks and legacy migration. Production build and eleven
built browser journeys passed. Database: 64 migrations, integrity ok, no foreign-key
anomalies, ten immutable reputation guards and five working evidence queries.

Evidence: [routing audit](docs/ORGANIZATION_ROUTED_PURCHASING_AUDIT.md),
[retirement acceptance](docs/RECURSIVE_IMPROVEMENT_REMOVAL.md), and
[fee coverage audit](docs/ENTERPRISE_CHAIN_FEES_AUDIT.md).

Next implement separately reviewed Tempo routed authority from this accepted
parent using [the dependency plan](docs/ORGANIZATION_ROUTED_TEMPO_PLAN.md).
Preserve L1 hashes and fee units, original payment/receipt/refund recovery, existing
direct-service credential scopes and historical identity/ownership/credentials.
Private providers/product/task/workflow purchases remain separate gates.

The user's latest cadence is **ten completed capability PRs per publication batch**,
one demonstrable capability per PR, protected CI, migration-first deployment and
exact merged-SHA production verification. Audits, commits and intermediate
foundations do not count. No live funds or global rollout changes are authorized.

## Historical user priority and publishing exception (2026-10-03)

The user's latest 2026-10-11 instruction replaces current routing work with
sitewide reputation v2 implementation and publication. They will paste the plan;
wait for its actual requirements. The routed purchasing model/API/tests remain
unaccepted local work. Its first four tests stopped at a fixture with zero eligible
route candidates; no routing acceptance or batch increment is established.

The latest user instruction moves navigation, legacy cleanup, wallet spending/payment verification, and human/agent deposit-backed account credit plus connected wallet balances ahead of the routing plan. Complete this capability release now, then resume routing. Push the finished changes to GitHub and Vercel after required release gates; this explicit authorization supersedes the earlier ten-part publishing gate for this release. Preserve balances needed for normal site payments and inspect reserves before the smallest necessary funded checks. Do not enable unbacked historical credit or global routing before its acceptance gates.
