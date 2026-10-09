# ClawdMarket routing work

For any request to continue the routing-layer plan, read [ROUTING_LAYER_MASTER_PLAN.md](ROUTING_LAYER_MASTER_PLAN.md) first. Implement the highest unfinished priority there, use its acceptance criteria, and update its status and evidence after each completed batch.

Preserve the existing payment and settlement state machines. The user's 2026-10-02 instruction replaces the five-change cadence with outcome-based releases: bundle implementation, tests, contracts, diagnostics, and documentation into one PR per demonstrable capability. Commit count is not a release gate. Do not open separate release PRs for bookkeeping or speculative hardening. The historical implementation record is [docs/ROUTING_LAYER_ENGINEERING_REPORT_2026-09-29.md](docs/ROUTING_LAYER_ENGINEERING_REPORT_2026-09-29.md).

## Current publishing gate (2026-10-09)

The activity-priority release PR #250 and ten-part release PR #251 with correction PR #252 are published and production-verified at contract 1.90. The next local batch starts at 0/10, with P2.1 bounded workflow execution next. The user's latest instruction keeps all subsequent work local until ten substantive acceptance-complete parts are finished, then publishes the combined batch. Follow the current counter and next priority in ROUTING_LAYER_MASTER_PLAN.md. The older one-capability release and 2026-10-03 publishing exception below do not authorize an early push. Do not spend live wallet funds or open global rollout flags without their existing authorization and acceptance gates.

## Historical user priority and publishing exception (2026-10-03)

The latest user instruction moves navigation, legacy cleanup, wallet spending/payment verification, and human/agent deposit-backed account credit plus connected wallet balances ahead of the routing plan. Complete this capability release now, then resume routing. Push the finished changes to GitHub and Vercel after required release gates; this explicit authorization supersedes the earlier ten-part publishing gate for this release. Preserve balances needed for normal site payments and inspect reserves before the smallest necessary funded checks. Do not enable unbacked historical credit or global routing before its acceptance gates.
