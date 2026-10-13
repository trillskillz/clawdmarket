# ClawdMarket routing work

## Latest publication policy — local accumulation (2026-10-13 UTC)

The user explicitly renewed permission after the additional repair publication
was rejected: "ensure that it passes to production after that make sure everything
stays local". Complete the necessary read-snapshot repair, required checks,
protected follow-up merge, migration-first deployment and same-SHA verification
without requesting permission again. The prior rejected command never ran; this
subsequent instruction authorizes the necessary follow-up to finish production.
Once verified, all further changes must accumulate locally until new permission.
Do not push, merge, publish GitHub metadata or deploy a later release automatically.
Previous exceptions and the ten-capability cadence do not authorize a later release.

PR #231 merged as `9aab6a0` after all four required checks passed, including 104
Chromium passes with nine expected skips and no retries. Deployment 38345497758
stopped at its release gate before production migration: a retry preflight took
a write lock for read-only workflow validation and exhausted bounded contention
recovery during concurrent retry/root checkout. Production remains `5715083`.
The narrow read-snapshot correction is local on `fix/workflow-retry-read-snapshot`;
a follow-up PR is necessary because #231 is already merged, and its publication
is now explicitly authorized as recorded above. The new
committed-snapshot regression passes while another writer holds uncommitted
exposure; its old-write negative control fails with the observed storage-busy
code. Ten unchanged concurrent retry/root cases and all 41 focused tests pass.
The enabled 854-case gate is running before protected merge and deployment.

For any request to continue the routing-layer plan, read [ROUTING_LAYER_MASTER_PLAN.md](ROUTING_LAYER_MASTER_PLAN.md) first. Implement the highest unfinished priority there, use its acceptance criteria, and update its status and evidence after each completed batch.

Preserve the existing payment and settlement state machines. The user's 2026-10-02 instruction replaces the five-change cadence with outcome-based releases: bundle implementation, tests, contracts, diagnostics, and documentation into one PR per demonstrable capability. Commit count is not a release gate. Do not open separate release PRs for bookkeeping or speculative hardening. The historical implementation record is [docs/ROUTING_LAYER_ENGINEERING_REPORT_2026-09-29.md](docs/ROUTING_LAYER_ENGINEERING_REPORT_2026-09-29.md).

## Current continuation — accepted local batch (2026-10-12 UTC)

The user's latest request prioritizes a site visual audit, font/readability fixes,
and pushing them with the accepted workflow/routing work. This explicitly permits
publishing this combined review branch before the usual ten-capability cadence.
Use `fix/site-visual-reliability` in `/home/void/Work/clawdmarket-visual-reliability`,
based on accepted workflow commit `4c4d998`. See
[visual acceptance](docs/SITE_VISUAL_RELIABILITY_AUDIT.md). The accepted routing
count remains 6/10; visual cleanup is not another economic capability. The user's
follow-up explicitly authorizes GitHub/Vercel publication: required CI, merge,
migration-first deployment and exact-SHA production verification. Rollout remains
closed under its original gates.

Reputation v2 production ranking is accepted through PR #261, main `5715083`,
HTTP 1.111. Protected CI, migration-first deployment 38205514998, same-SHA smoke
38206187936, independent API/desktop/mobile checks and read-only payment readiness
passed. Fresh protected audit 38267467182 passed all five compiler queries and ten
immutable guards. Representative observation/calibration remain pending under the
explicit user override; empirical promotion_ready=false remains truthful.

The local batch has **6/10** accepted demonstrable capabilities: reconciled private
enterprise actual fee coverage, independently reviewed L1 public-provider routing
(`5ae3e92`, HTTP 1.112), recursive-improvement retirement (`3839c32`, HTTP 1.113),
reviewed Tempo public-provider routing (`eb3b6f8`, HTTP 1.114), independently reviewed
private-provider L1/Tempo routing (`0d9bcd4`, HTTP 1.115), and independently reviewed
enterprise workflows (HTTP 1.116).
Current integrated branch: `feat/enterprise-reviewed-workflows` in
`/home/void/Work/clawdmarket-enterprise-reviewed-workflows`, accepted parent `0d9bcd4`.

Workflow acceptance passes the fully enabled **852-case Node gate**:
847 passed, zero failed, five expected skips. Eighteen Python tests,
SDK parity/build, TypeScript, lint, final production build and forty built Chromium
journeys pass. Six final genuine workflow L1/Tempo journeys prove two dependent
private providers, buyer/provider process deaths, original artifact handoff, explicit
buyer acceptance, confirmed payouts, exact revoked late-payment refunds, downstream
consent denial, shared-wallet exclusion and original backed receipt recovery.
Both SDKs recover genuinely lost proposal/decision replies over real HTTP.
Twelve supplemental economic journeys also retain previous private standalone
acceptance with corrected actual DELETE dispatch. Rejected-claim cancellation
releases unused capacity while original gross/fee use stays charged; original
claimed payment recovery retains its scope. Seven focused authority/privacy cases
include four separate-process gross/fee/department/capacity races and ten genuine
before/after-commit SIGKILL boundaries. Storage: 66 migrations and replay, preserved
legacy financial/input/read-credential state, integrity ok, zero foreign-key
anomalies, ten immutable reputation guards and five working evidence queries.
Legacy workflow v1/route v1-v4 hashes, separate fee units and historic identities
retain their meaning. Controlled fixture providers are not production independence
evidence. Execution remains behind the original closed rollout gates.

Evidence: [workflow acceptance](docs/ORGANIZATION_REVIEWED_WORKFLOW_AUDIT.md),
[workflow contract](docs/ORGANIZATION_REVIEWED_WORKFLOWS.md),
[workflow dependency/acceptance](docs/ORGANIZATION_REVIEWED_WORKFLOW_PLAN.md), and
[private-provider acceptance](docs/ORGANIZATION_ROUTED_PRIVATE_PROVIDER_AUDIT.md).

Next implement independently reviewed task-board purchasing using
[the audited dependencies](docs/ORGANIZATION_REVIEWED_TASK_PURCHASING_PLAN.md).
Bind the exact accepted bid/workspace and original task trade, separately scoped
payment claims and shared route/workflow/task exposure. Preserve original task
delivery, explicit review and late-payment recovery; pending review cannot be
bypassed through generic task funding. That dependency audit is not another
capability. Product/listing and contract purchases retain separate authority.

The general cadence is **ten completed capability PRs per publication batch**,
one demonstrable capability per PR, protected CI, migration-first deployment and
exact merged-SHA production verification, subject to the current explicit push
exception above. Audits, commits and intermediate
foundations do not count. No live funds or global rollout changes are authorized.

## Historical user priority and publishing exception (2026-10-03)

The user's latest 2026-10-11 instruction replaces current routing work with
sitewide reputation v2 implementation and publication. They will paste the plan;
wait for its actual requirements. The routed purchasing model/API/tests remain
unaccepted local work. Its first four tests stopped at a fixture with zero eligible
route candidates; no routing acceptance or batch increment is established.

The latest user instruction moves navigation, legacy cleanup, wallet spending/payment verification, and human/agent deposit-backed account credit plus connected wallet balances ahead of the routing plan. Complete this capability release now, then resume routing. Push the finished changes to GitHub and Vercel after required release gates; this explicit authorization supersedes the earlier ten-part publishing gate for this release. Preserve balances needed for normal site payments and inspect reserves before the smallest necessary funded checks. Do not enable unbacked historical credit or global routing before its acceptance gates.
