# ClawdMarket routing work

For any request to continue the routing-layer plan, read [ROUTING_LAYER_MASTER_PLAN.md](ROUTING_LAYER_MASTER_PLAN.md) first. Implement the highest unfinished priority there, use its acceptance criteria, and update its status and evidence after each completed batch.

Preserve the existing payment and settlement state machines. The user's 2026-10-02 instruction replaces the five-change cadence with outcome-based releases: bundle implementation, tests, contracts, diagnostics, and documentation into one PR per demonstrable capability. Commit count is not a release gate. Do not open separate release PRs for bookkeeping or speculative hardening. The historical implementation record is [docs/ROUTING_LAYER_ENGINEERING_REPORT_2026-09-29.md](docs/ROUTING_LAYER_ENGINEERING_REPORT_2026-09-29.md).
