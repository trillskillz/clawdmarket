## Security-first release preparation — 2026-10-15

The user explicitly authorized GitHub/Vercel publication after fixing security,
and separately approved a full private production recovery copy, a local restore,
and AES256GCM-encrypted Actions artifact transfer with remote artifact deletion.
This preparatory branch removes the braces dependency path while retaining lint
rules and adds the approved optional encrypted backup mode to the existing audit
workflow. The protected production environment requires protected branches; do
not weaken that policy. Merge this small preparatory PR through required checks,
validate same-SHA deployment, then run the backup mode from protected main.
No application purchasing handlers, migrations, financial semantics, funds or
rollout flags change in this preparatory release. Existing migration66 is replayed.
The cumulative marketplace branch/PR274 follows only after its complete checks
and a validated private production recovery copy before migration79.
Earlier local-only publication instructions below are historical and superseded
by the user's new publication authorization for this release.

# ClawdMarket routing work

## Current authorized visual follow-up (2026-10-13)

The user requested a fresh visual audit, chose a new visual follow-up PR, and
explicitly instructed: "push this but after do not push anymore keep everything
local". Complete this visual-only batch on `fix/site-visual-followup`, including
rendered acceptance, required CI, protected publication and production verification
under the established release workflow. This permission applies only to these
visual fixes and their audit/policy records. No unrelated routing capability or
later release is authorized. Once this batch is verified, all further code, tests
and documentation must stay local until explicit new publication permission.
Do not push, merge, publish GitHub metadata or deploy a later release automatically.
The prior completed release and acceptance below are historical evidence.

## Latest publication policy — local accumulation (2026-10-13 UTC)

The final authorized production release is complete. PR #231 merged as `9aab6a0`;
its required read-snapshot repair PR #262 merged as
`1b53230c84709fc42f5a10686fae12183d3b0bd0`. Migration-first deployment
38348774805 and same-SHA production smoke 38349820680 passed. Both domains serve
HTTP contract 1.116, with 72 live desktop/mobile renders passing and all 26 served
font files matching their recorded hashes. Publication permission for this release
is now consumed. All further code, tests and documentation must accumulate locally
until the user explicitly authorizes another publication. Do not push commits,
merge PRs, edit GitHub publication metadata or deploy to Vercel without new
permission. Earlier exceptions and the ten-capability cadence do not authorize
a later release. The current local continuation is
`work/local-after-final-production-2026-10-13` in this worktree, with no upstream.

Final enabled acceptance: 854 Node cases, 849 passed, five expected skips and zero
failures; 18 Python cases, SDK parity/build, TypeScript, lint and production build
pass. All 104 runnable Chromium cases pass with nine expected skips and no retries.
All four required checks passed for both PRs. The read-only preflight regression
passes under an independent writer's uncommitted exposure; its old-write control
reproduces storage contention. Ten unchanged retry/root races and all 41 focused
cases pass. See [visual acceptance](docs/SITE_VISUAL_RELIABILITY_AUDIT.md).
Routing acceptance stays six capabilities; the next task-board purchasing batch
must be implemented and validated locally. Rollout gates retain their original scope.

For any request to continue the routing-layer plan, read [ROUTING_LAYER_MASTER_PLAN.md](ROUTING_LAYER_MASTER_PLAN.md) first. Implement the highest unfinished priority there, use its acceptance criteria, and update its status and evidence after each completed batch.

Preserve the existing payment and settlement state machines. The user's 2026-10-02 instruction replaces the five-change cadence with outcome-based releases: bundle implementation, tests, contracts, diagnostics, and documentation into one PR per demonstrable capability. Commit count is not a release gate. Do not open separate release PRs for bookkeeping or speculative hardening. The historical implementation record is [docs/ROUTING_LAYER_ENGINEERING_REPORT_2026-09-29.md](docs/ROUTING_LAYER_ENGINEERING_REPORT_2026-09-29.md).

## Historical accepted batch — now published (2026-10-12 UTC)

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
