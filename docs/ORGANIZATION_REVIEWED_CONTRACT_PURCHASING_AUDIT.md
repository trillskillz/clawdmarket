## Contract inventory defect reproduced and fixed locally — 2026-10-15

The fresh contract audit found a cross-scope defect in the previously tested
listing candidate: generic credit contract funding could bypass pending/revoked
listing review, adopt a consumed manually reopened listing, or fund after the
seller changed. These are real local backed-credit fixture reproductions, not
live activity. The correction checks exact current seller/public inventory and
original review/task/private-service scope inside fresh funding; new draft
creation excludes consumed/synthetic inventory. Original paid release/refund
paths remain unchanged, including principal-only refund after upfront fees.
Seven new scope cases and existing regressions pass in the complete **84/84**
focused run, zero skips/failures; current types/lint pass. The old listing release
candidate requires this fix and source-bound reacceptance before publication.
Preserve `6ed0a09` as historical tested evidence, not an unqualified final release.

# Reviewed contract foundation — local checkpoint, not accepted capability

Based on accepted listing candidate `6ed0a09`; code remains local HTTP 1.119,
capability **8/10**. The listing source-bound release evidence is preserved in its
original worktree. This unfinished separate contract work does not authorize
payment, publication, custody changes, withdrawals or production flags.

Optional `client_reference` on POST `/api/contracts` now names the exact parsed
normalized command. One transaction writes the original contract, ordered
milestones and buyer/reference/hash association. A concurrent exact command or
lost response recovers those same records; changed seller, milestone order,
amount, expiry or relative deadline returns 409. Absolute dates derive once from
one first-creation clock. Current state is returned on replay, so cancellation
and closed fresh admission cannot allocate a replacement or extend a deadline.
GET `/api/contracts?client_reference=...` is private to the original buyer and
uses no-store; other buyers and sellers get 404. Existing participant pagination
continues when the query is omitted. Without a reference, legacy non-idempotent
creation remains. No existing contract gains a fabricated reference.

The 65,536-byte request ceiling and referenced metadata bounds (depth 12, 4,096
value nodes) protect canonical hashing of extensible acceptance specifications.
Fresh creation still checks deployment credit readiness and payment pause, seller
visibility, active linked listing, self-purchase, whole-cent quotes and the original
five-percent fee. This creates an **unfunded DRAFT** only. Seller credit opt-in,
actual backed reserve, spending/review policy and inventory CAS remain separate
funding requirements. No credit account, trade, payout or organizational purchase
use is created by recovery. OpenAPI describes original recovery and explicitly
nonwithdrawable credit. No full reviewed-contract claim is added.

Migration `2026-10-15-contract-original-creation-v1` adds only
`contract_creation_requests` with unique buyer/reference and original contract
identity, restrictive references and no historical backfill. Runtime migration and
replay total **72**. A fresh copy of the original visual baseline retains all
**845 business rows across 133 tables**, integrity ok, zero foreign-key anomalies,
all ten immutable reputation guards and all five actual evidence queries. New
reference and prior reviewed authority tables remain empty. Evidence:
`/tmp/clawdmarket-contract-creation-preservation-2026-10-15.log`.

Focused current evidence:
`/tmp/clawdmarket-contract-creation-bounded-focused-2026-10-15.log` passes **57/57**,
zero skips/failures. Ten new draft cases include actual dropped HTTP reply after
commit, competing separate processes with identical/changed commands, and actual
before/after-commit SIGKILL. Before commit leaves no draft/reference/milestones;
after commit retains the original ID and exact milestone set. Existing backed
credit settlement, policy/pause, runtime migration and canonical contract checks
also pass. These credit regression receipts are signed local RPC fixtures, not a
new genuine contract-chain economic demonstration or live canary. Current types
and changed-file lint pass in the `...creation-{types,lint}-bounded-2026-10-15.log`
files under `/tmp`. No full new predeploy/browser acceptance is claimed.

Initial checks failed due to a missing retained `eq` import, a test-only nonexistent
`credit_ledger` table (actual table is `credit_entries`), an automatic-semicolon
boundary and a CommonJS top-level-await child launcher. The corrected launcher
uses an async main. A transitional run had one missing child barrier; the final
complete focused run includes both real process races and both kill boundaries.
No application financial guard was relaxed and no failed run is counted as pass.

Remaining: enforce linked original inventory scope in both draft creation and
fresh funding; separate frozen credit-only organization proposal/reviewer/decision
and original-use ledger with cross-scope gross exposure; exact seller submission
identity/hash and explicit buyer acceptance; maintenance exclusion; original
partial dispute/refund recovery; finite clients, both SDKs and responsive private
review; genuine deposit-backed disposable economic and full release gates.
Security remains blocked by the high development braces advisory, without an
approved exception. Production was last observed at main 96a017b, HTTP 1.116.

Release/rollback: this foundation is not a publication candidate. Only after the
complete outcome, security treatment and explicit publication authorization may
protected same-source gates and backup/migration-first deployment proceed. Do not
drop or rewrite reference rows on rollback; older application code cannot honor
newly issued recovery references. Retain compatible original recovery handlers if
any exist. All pre-existing claim, financial, immutable evidence and listing
rollback conditions continue to apply. Live canary, treasury fee budget, email
provider inbox verification, real participant admission and recruitment remain
separate external dependencies documented in the preserved pilot/listing audits.

## Linked inventory evidence

`/tmp/clawdmarket-contract-listing-scope-before-corrected-2026-10-15.log`
reproduces all four unsafe fresh funding outcomes (HTTP 200 instead of 409).
An initial attempt hit the unrelated fixture buyer-approval threshold and supplied
an extra approval property to internal checkout; both fixtures were corrected
before counting a reproduction. Production guards were not relaxed.
`/tmp/clawdmarket-contract-listing-scope-after-2026-10-15.log` passes those four.
The complete current focused run
`/tmp/clawdmarket-contract-listing-scope-focused-2026-10-15.log` passes **84/84**,
including seven new scope cases, original creation, existing credit and listing
review, pause and migration tests. Types/lint pass in the contract-scope logs.
No listing payment-claim test is counted by that run; the requested nonexistent
claims filename did not add any cases. The later full listing reacceptance must
include the actual `organization-listing-payment.test.ts` file.

The seven cases cover pending/revoked original-buyer restrictions with unrelated
public buyer access, consumed original listing exclusion after cancellation and
manual catalog reactivation, seller changes before funding versus original
funded refund recovery, task/private-service original identities, and current
provider visibility. Original draft-reference recovery stays available after
fresh scope closes. All credit evidence is controlled signed RPC receipt fixtures;
this scope regression does not establish a new live or independently paid journey.
