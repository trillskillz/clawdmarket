## Accepted corrected listing candidate — 2026-10-15

Current local candidate source **9d48c39** repairs the reproduced generic contract
inventory bypass. HTTP **1.119**, migrations **71**, capability **8/10**. Every one
of **172** source hashes matches manifest SHA-256
`9bcabe54250845960dad1b3398e76f6915d4a7a8cd0a7fca596c32b64e623939`.
Complete enabled predeploy passes **1,076 Node cases: 1,071 pass, five expected
skips, zero failures**, **24 Python cases**, SDK parity/build, types and lint.
Production build passes; complete Chromium **149 pass, eight skips, zero failures
and retries**. Fresh migration/replay preserves 845 original rows/133 tables,
ten immutable guards, five actual queries and zero foreign-key anomalies.
The 103 targeted original-payment/credit/inventory cases also pass without skips.

This source supersedes `6ed0a09` as the listing release candidate; that parent's
complete tests remain historical evidence and lacked these new regressions.
Full audit still exits 1 with one high development braces advisory; production-only
exits 0. No exception is approved and the security publication gate stays blocked.
Production last observed `2026-10-15T11:16Z`: main **96a017b**, HTTP **1.116**,
89 profiles, 47 registrations, 16 recently online, 21 completed trades, $0.92
recorded volume and $0.02 fees. Legacy listing fields remain 352/83. The online
count cannot establish ownership or independent adoption. Latest public payment
monitor 38691824558 checks readiness/RPC only, not paid canary/worker/reserves.

All work stays local; no publication, live funds, global production flags, custody
changes, real-user email or outreach. Continue the separate contract foundation
in `/home/void/Work/clawdmarket-reviewed-contracts-current` (73 migrations, no
reviewed funding, no capability 9). Retain this candidate and `bee652c` intact.
See `docs/ORGANIZATION_REVIEWED_LISTING_SCOPE_FIX_AUDIT_2026-10-15.md` for release,
rollback, limitations and exact remaining external authorization/dependencies.

## Active listing release repair — 2026-10-15

This isolated worktree `/home/void/Work/clawdmarket-reviewed-listing-scope-fix`
repairs a newly reproduced generic credit-contract bypass of original reviewed
listing inventory. Parent `6ed0a09` preserves prior tested source `4cc00d4`, but
its listing release now needs this repair and complete source-bound reacceptance.
Seven new disposable backed-credit regressions pass in the separate contract
worktree; rerun them here with the actual listing payment tests, then complete
enabled/build/browser and preservation gates. No contract-reference foundation or
migration 72 is included: this repair remains HTTP **1.119**, **71** migrations.
Historical capability count is **8/10**, release acceptance pending this repair;
no new capability is counted. Keep all changes local, no live funds, publication,
global flags, custody, mail or outreach. Security still has one unapproved high
development advisory. Preserve both earlier listing and dependable-pilot trees.
Once corrected listing acceptance is complete, merge this fix's tested source
into the separate contract continuation and resume the saved contract plan.

The new contract dependency audit reproduced fresh credit funding bypassing a
pending or revoked original-buyer listing review, adopting a consumed cancelled
listing after manual reactivation, and funding after the listing seller changed.
Before-fix evidence is the corrected four-case contract fixture log:
`/tmp/clawdmarket-contract-listing-scope-before-corrected-2026-10-15.log`.
These are controlled signed local RPC receipt fixtures, not live payments.

`requireContractListingScope` rechecks current active/public seller, exact original
contract seller, consumed listing/reviewed task/private-service identities and
legacy task workspace links inside fresh funding. Generic companion review checks
remain buyer-scoped and persist after revocation. New linked drafts also exclude
consumed/synthetic inventory inside their creation transaction. Pending review
alone reserves no inventory and does not block an unrelated public buyer. Existing
funded cancellation/expiry, milestone release and disputes never run fresh scope
checks; original financial references and upfront-fee/principal-refund semantics
remain intact. Seven new scope regressions cover those boundaries. No review/use/
claim or financial reference is migrated or rewritten by this repair.

Acceptance is complete at source 9d48c39 with the evidence above and in
`evidence/reviewed-listing-scope-fix-2026-10-15/acceptance-progress.json`. The parent audit retains the original full gate's
failures and corrections. This repair does not resolve the unapproved braces
advisory or authorize publication. Follow the parent release/rollback policy:
backup then migrate all 71 runtime migrations before matching application; retain
all authority/claim/use handlers whenever those records exist. Never clear records,
relist consumed inventory or replace a financial reference during rollback.

## Release status, limitations and external actions

The ten-part product finding register remains at
`DEPENDABLE_PILOT_ISSUE_REGISTER_2026-10-14.md`. Its implementation candidate bee652c
is preserved; this repair adds the separately accepted listing outcome. Implemented
and locally demonstrated original purchasing is distinct from deployed/enabled
production and independent demand. No independent customer activity was generated
or demonstrated. Known external requirements remain: compatible braces remediation
or an explicitly approved scoped exception; configured recovery sender and approved
inbox delivery; authoritative cohort and seller-rail confirmations; actual real
provider/customer admission; fresh worker/payout-anomaly/reserve evidence; approved
pilot recruitment; explicit publication and separately capped live-payment approval.

Actual verification limits: five Node skips cover four retired unbacked credit
service paths and unconfigured Base Sepolia wallet integration. Eight browser
skips retain retired credit, dedicated instant and guarded buyer-chain fixtures;
enabled disposable economic suites run separately. Build initially failed because
the sandbox blocked the TypeScript child process (EPERM), returning empty config
output. Direct tsc output was valid; build with allowed local subprocesses passed.
No source workaround or dependency mutation was used. Known MPP dynamic dependency
build warnings remain. The original four unsafe funding reproductions fail before
this repair and pass after it; no failed run is counted as success. Raw full and
production dependency audits are saved and remain respectively exit1/high1 and
exit0/all severity counts0. The advisory still lists no patched version:
https://github.com/advisories/GHSA-vfj7-8cjw-p6xm .

After explicit publication authorization AND accepted security treatment, run
protected same-source CI, back up production, apply all71 migrations using
`pnpm db:migrate:runtime` BEFORE the matching app deployment, then verify the
same deployed SHA, HTTP1.119 and scoped read-only live smoke. Do not push, open a
PR, dispatch workflows, edit remote metadata, deploy or enable execution flags
under the current local-only authorization. Prepared GitHub-description and
pilot/canary materials remain reviewable in the preserved parent audit.

Rollback must retain the new contract inventory guard and original listing
payment/fulfillment/recovery handlers. As in the parent audit, ANY listing grant,
use, intent or claim prevents rolling back to an application without those guards,
including pending/revoked grants and completed/refunded uses. Retain all additive
tables, original references and immutable financial/delivery evidence; never clear
or reactivate consumed inventory to make a rollback appear compatible. If no
listing ledgers exist, an older compatible application may be considered only
after read-only compatibility checks, without dropping additive schema. The
unfinished contract foundation with migrations72/73 is not included in this release.

No live canary is executed or authorized. The old proposal is exactly one $0.02
Base-USDC canary; its snapshot-based $0.014427 top-up is stale and must be reread.
Before live execution, explicitly authorize the updated buyer funding and a
separately bounded/enforced treasury worker fee budget, retain original approval/
state/bytes and recovery references, and use dedicated controlled identities.
Readiness/RPC success cannot refresh the paid-canary timestamp or count as adoption.
