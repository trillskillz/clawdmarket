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

The local batch has **5/10** accepted demonstrable capabilities: reconciled private
enterprise actual fee coverage, independently reviewed L1 public-provider routing
(`5ae3e92`, HTTP 1.112), recursive-improvement retirement (`3839c32`, HTTP 1.113),
reviewed Tempo public-provider routing (`eb3b6f8`, HTTP 1.114), and independently
reviewed private-provider L1/Tempo routing (HTTP 1.115).
Current integrated branch: `feat/enterprise-routed-private` in
`/home/void/Work/clawdmarket-enterprise-routed-private`.

Private-provider acceptance passes the fully enabled 838-case Node gate:
833 passed, zero failed, five expected skips. Eighteen Python tests, SDK parity/build,
TypeScript, lint, genuine disposable L1/Tempo economics, crash/race recovery and
legacy migration replay pass. Six final private economic journeys independently
prove actual payouts, revoked original refunds, last-boundary consent checks,
shared-wallet exclusion and settled-result recovery after both share/grant
revocation. Eight focused authority/privacy/crash/race checks pass. Production build
and seventeen built browser journeys pass. Storage: 65 migrations and replay,
integrity ok, no foreign-key anomalies, ten immutable reputation guards and five
working evidence queries. Public v1/v2 hashes, separate fee units, shared original
gross and historic identity/ownership/credentials retain their meaning. Ordinary
route DTOs redact private candidates/input; named read-only credentials cannot
inspect private mandates. Original owner/reviewer review and financial recovery
retain their scope after revocation.

Evidence: [private-provider acceptance](docs/ORGANIZATION_ROUTED_PRIVATE_PROVIDER_AUDIT.md),
[private-provider contract](docs/ORGANIZATION_ROUTED_PRIVATE_PROVIDERS.md),
[Tempo acceptance](docs/ORGANIZATION_ROUTED_TEMPO_PLAN.md),
[retirement acceptance](docs/RECURSIVE_IMPROVEMENT_REMOVAL.md), and
[fee coverage audit](docs/ENTERPRISE_CHAIN_FEES_AUDIT.md).

Next implement independently reviewed enterprise workflows using
[the dependency audit](docs/ORGANIZATION_REVIEWED_WORKFLOW_PLAN.md) from this accepted
parent. Bind original DAG/node/dependency contracts and internally derived child
consent, with shared standalone/workflow exposure and multi-node real economic
acceptance. Existing workflow, route, direct-service and read credentials retain
separate authority. Product/task/contract purchasing remains separately bounded.

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
