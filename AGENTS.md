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

The combined release in PR #255 is production-verified at SHA 6a4d335, HTTP 1.106. The user now prioritizes the Observe Live activity defect before further routing work. Finish and verify registrations, public market payments and caller-only wallet activity in one descending UTC timeline, then publish this focused repair under the existing site-fix publication instruction and verify the production deployment. Accepted private enterprise fee coverage 1.107 remains separately committed in /home/void/Work/clawdmarket on feat/enterprise-chain-fee-coverage (new batch 1/10); its unfinished routed purchasing draft is preserved there and must not enter this repair. After Observe production acceptance, resume separately owner-reviewed enterprise routed public-provider purchasing. Keep the ten-part gate for future routing batches unless the user changes it; audits do not increment it. Do not spend live wallet funds or enable global rollout flags.

## Historical user priority and publishing exception (2026-10-03)

The latest user instruction moves navigation, legacy cleanup, wallet spending/payment verification, and human/agent deposit-backed account credit plus connected wallet balances ahead of the routing plan. Complete this capability release now, then resume routing. Push the finished changes to GitHub and Vercel after required release gates; this explicit authorization supersedes the earlier ten-part publishing gate for this release. Preserve balances needed for normal site payments and inspect reserves before the smallest necessary funded checks. Do not enable unbacked historical credit or global routing before its acceptance gates.
