# Local combined batch

All subsequent implementation and acceptance remain local. The last authorized
publication is PR #263, production base
`96a017b6019920f47af32d86a7e476c9b9c07808` (HTTP 1.116). No later push, PR change,
merge or deployment is authorized. Production rollout and real funds retain their
original gates.

The combined branch is `work/local-after-visual-followup-2026-10-13` in
`/home/void/Work/clawdmarket-visual-reliability`, with no upstream. The branch starts
at the verified merged production base; the older feature worktrees have already
been integrated through the accepted release and must not be cherry-picked again.

The first local continuation implements reviewed task purchasing (HTTP 1.117).
Its authority, original task checkout, payment claims, explicit delivery acceptance,
clients, review UI, contracts and acceptance tests belong to the same capability.
The additive migration follows the existing 66 migrations as
`2026-10-13-organization-reviewed-task-purchasing-v1`. The runtime migration runner
and read-only readiness requirements include its five tables. Existing databases
gain no task authorization automatically.

Reviewed task purchasing is accepted locally as capability **7/10**. The final
enabled predeploy gate exits zero with 926 Node cases (921 passed, five expected
skips), 21 Python cases, SDK parity/build, types and lint. The final production
build and all 122 runnable Chromium cases pass (eight expected skips, no retries).
Migration/replay preserves all 845 original rows across 133 tables, ten immutable
reputation guards and five actual evidence queries. Exact evidence and the
unchanged tested source manifest are in
[task purchasing acceptance](ORGANIZATION_REVIEWED_TASK_PURCHASING_AUDIT.md).

Next local work is
[independently reviewed listing purchasing](ORGANIZATION_REVIEWED_LISTING_PURCHASING_PLAN.md).
Its dependency audit resolves buyer-scoped pending review versus public inventory,
original marketplace delivery/payment claims and cross-ledger exposure. It is
not an implemented or accepted eighth capability. Contract escrow stays separate.

When the user authorizes a future publication, fetch current main read-only and
perform integration in an isolated local worktree. Review and resolve any upstream
conflicts there, then rerun the affected checks against the final combined tree.
Publish the integrated batch only under that new permission. A clean integration
today cannot guarantee that future upstream edits will introduce no conflicts.
