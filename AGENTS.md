# ClawdMarket routing work

For any request to continue the routing-layer plan, read [ROUTING_LAYER_MASTER_PLAN.md](ROUTING_LAYER_MASTER_PLAN.md) first. Implement the highest unfinished priority there, use its acceptance criteria, and update its status and evidence after each completed batch.

Preserve the existing payment and settlement state machines. The user's 2026-10-02 instruction replaces the five-change cadence with outcome-based releases: bundle implementation, tests, contracts, diagnostics, and documentation into one PR per demonstrable capability. Commit count is not a release gate. Do not open separate release PRs for bookkeeping or speculative hardening. The historical implementation record is [docs/ROUTING_LAYER_ENGINEERING_REPORT_2026-09-29.md](docs/ROUTING_LAYER_ENGINEERING_REPORT_2026-09-29.md).

## Current publishing gate (2026-10-12 UTC)

The user's Reputation v2 priority remains active. PR #260 is accepted and deployed
at main `66858c5`, HTTP 1.110 on both canonical domains. Real compiler checks,
same-SHA smoke, mobile/desktop Observe and payment readiness/reserves passed.
The fresh production assessment still lacks active public services, dated scoped
outcomes and comparable candidates. The user's latest instruction explicitly
supersedes the observation hold for ranking: **“find a way to promote to production
regardless.”** Implement and verify a separately versioned production ranking
policy, then publish through protected CI/migration-first GitHub/Vercel. Keep
missing measurements and the explicit override visible; do not fabricate evidence
or claim calibrated readiness. Existing saved plans retain their frozen order.
Purchasing minimums, payment/execution flags, financial authority and live funds
remain unchanged. Preserve the separate unfinished routed purchasing worktree.
After production acceptance, continue the next unfinished routing capability.

Observe is production-verified through HTTP **1.108**, [PR #256](https://github.com/trillskillz/clawdmarket/pull/256), SHA `c574e266b447f97d5f9e007ed47e41471aad7649`. Required CI, migration-first Vercel deployment, same-SHA production smoke and independent desktop/mobile checks on both domains passed. The subsequent sitewide payment audit passed configuration, RPCs, settlement reserves, account credit, original receipts and payout/refund outboxes. A fresh paid canary is not verified: the dedicated buyer holds 0.005573 USDC, below the 0.01 minimum. No live funds, top-up or rollout changes are authorized. See [payment audit](docs/PAYMENT_HEALTH_AUDIT_2026-10-11.md).

Accepted private enterprise actual fee coverage, originally local HTTP 1.107, is reconciled with Observe as local **1.109** on `feat/enterprise-chain-fee-coverage`; substantive batch count remains **1/10**. Its full prior economic, build and browser acceptance remains recorded in [fee audit](docs/ENTERPRISE_CHAIN_FEES_AUDIT.md); reconciliation is not another accepted part. Keep ten substantive accepted parts before future routing publication unless the user changes it. Audits and intermediate foundations do not increment the count.

Continue the preserved **unaccepted** enterprise routed purchasing draft. Start with separately owner-reviewed Ethereum L1 public-provider routes. Freeze original route objective/hash, candidates, buyer/organization/team, gross and all-attempt fees, expiry and retry limits; prove atomic original consumption, shared wallet exclusion, real settled delivery and original revoked-payment/refund recovery. Existing direct-service keys retain their scopes. Broader rails/private providers/product/task/workflow purchases remain separate. Independent providers, production quality/calibration, paid canaries and production Tempo fork compatibility retain their prerequisites.

## Historical user priority and publishing exception (2026-10-03)

The user's latest 2026-10-11 instruction replaces current routing work with
sitewide reputation v2 implementation and publication. They will paste the plan;
wait for its actual requirements. The routed purchasing model/API/tests remain
unaccepted local work. Its first four tests stopped at a fixture with zero eligible
route candidates; no routing acceptance or batch increment is established.

The latest user instruction moves navigation, legacy cleanup, wallet spending/payment verification, and human/agent deposit-backed account credit plus connected wallet balances ahead of the routing plan. Complete this capability release now, then resume routing. Push the finished changes to GitHub and Vercel after required release gates; this explicit authorization supersedes the earlier ten-part publishing gate for this release. Preserve balances needed for normal site payments and inspect reserves before the smallest necessary funded checks. Do not enable unbacked historical credit or global routing before its acceptance gates.
