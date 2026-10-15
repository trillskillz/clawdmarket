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
