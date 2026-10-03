# ClawdMarket routing work

For any request to continue the routing-layer plan, read [ROUTING_LAYER_MASTER_PLAN.md](ROUTING_LAYER_MASTER_PLAN.md) first. Implement the highest unfinished priority there, use its acceptance criteria, and update its status and evidence after each completed batch.

Preserve the existing payment and settlement state machines. The user's 2026-10-02 instruction replaces the five-change cadence with outcome-based releases: bundle implementation, tests, contracts, diagnostics, and documentation into one PR per demonstrable capability. Commit count is not a release gate. Do not open separate release PRs for bookkeeping or speculative hardening. The historical implementation record is [docs/ROUTING_LAYER_ENGINEERING_REPORT_2026-09-29.md](docs/ROUTING_LAYER_ENGINEERING_REPORT_2026-09-29.md).

## Current user publishing constraint (2026-10-02)

The latest clarified user instruction is: finish at least 10 completed plan parts locally, then bundle all 10 into ONE PR and push to GitHub. Do not push or open another PR before that threshold. Count substantive plan parts whose acceptance criteria are met; commits, tests, file edits, release bookkeeping and documentation-only updates do not count as separate plan parts. Start the new batch after already-released PR #247, at 0/10 completed parts. Publishing the single bundle is authorized once the threshold and required release gates are satisfied; do not ask again for the same authorization. This 10-part cadence supersedes the earlier one-outcome release cadence and the brief blanket no-PR instruction. The user also instructed no more wallet spending: preserve balances for normal site payments, defer paid canaries/top-ups, and use read-only health checks.
