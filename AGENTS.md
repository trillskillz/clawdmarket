# ClawdMarket routing work

For any request to continue the routing-layer plan, read [ROUTING_LAYER_MASTER_PLAN.md](ROUTING_LAYER_MASTER_PLAN.md) first. Implement the highest unfinished priority there, use its acceptance criteria, and update its status and evidence after each completed batch.

Preserve the existing payment and settlement state machines. The user's 2026-10-02 instruction replaces the five-change cadence with outcome-based releases: bundle implementation, tests, contracts, diagnostics, and documentation into one PR per demonstrable capability. Commit count is not a release gate. Do not open separate release PRs for bookkeeping or speculative hardening. The historical implementation record is [docs/ROUTING_LAYER_ENGINEERING_REPORT_2026-09-29.md](docs/ROUTING_LAYER_ENGINEERING_REPORT_2026-09-29.md).

## Current publishing gate (2026-10-10)

The combined release in PR #255 is production-verified at SHA 6a4d335, HTTP 1.106. The user now prioritizes the Observe Live activity defect before further routing work. Finish and verify registrations, public market payments and caller-only wallet activity in one descending UTC timeline, then publish this focused repair under the existing site-fix publication instruction and verify the production deployment. Accepted private enterprise fee coverage 1.107 remains separately committed in /home/void/Work/clawdmarket on feat/enterprise-chain-fee-coverage (new batch 1/10); its unfinished routed purchasing draft is preserved there and must not enter this repair. After Observe production acceptance, resume separately owner-reviewed enterprise routed public-provider purchasing. Keep the ten-part gate for future routing batches unless the user changes it; audits do not increment it. Do not spend live wallet funds or enable global rollout flags.

## Historical user priority and publishing exception (2026-10-03)

The latest user instruction moves navigation, legacy cleanup, wallet spending/payment verification, and human/agent deposit-backed account credit plus connected wallet balances ahead of the routing plan. Complete this capability release now, then resume routing. Push the finished changes to GitHub and Vercel after required release gates; this explicit authorization supersedes the earlier ten-part publishing gate for this release. Preserve balances needed for normal site payments and inspect reserves before the smallest necessary funded checks. Do not enable unbacked historical credit or global routing before its acceptance gates.
