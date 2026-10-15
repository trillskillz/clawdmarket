## Finite original buyer/provider command recovery verified — local only

One exact-command worker durably journals explicit FUND, seller OUTPUT, buyer
ACCEPT and buyer RELEASE separately. It checks original reference before sending;
uncertain absence requires explicit same-command resume. Private kernel-locked
journals preserve original inputs/receipt identities, never credentials. Changed
scope/body fails locally; unavailable reads never become missing records. Output
is not executed. Credit nonwithdrawability requires explicit acknowledgment.

Current **33/33** named cases pass, zero failures/skips: all10 scoped fund/process/
CLI cases,3 worker safety cases,18 canonical API and2 SDK cases. Actual buyer and
seller CLI processes are SIGKILLed after each committed command through BOTH
milestones and restarted from saved private journals. Restarts issue only original
GETs, with no second mutation. Explicit acceptance alone posts no credit. Final
buyer principal0/seller100/fee5 TEST cents, even after review revocation and fresh
funding closure. No private artifact is printed. Initial test-only fetch typing
and optional-chain lint failures were corrected; final types/lint pass. Existing
9b9f9b7 app build applies; no app/runtime API/schema changed here. Migration79 and
prior local preservation unchanged/not rerun. No live or independent activity.

Manifest **71** files versus e55e151, SHA-256 `e5906b8d6882155eef870419f9ae1d9efee5b8ac35fd65200a8d667577cfae51`.
Worker setup/recovery: `docs/ORIGINAL_CONTRACT_COMMAND_WORKER.md`.
Evidence: `docs/evidence/reviewed-contract-foundation-2026-10-15/finite-worker.json`.
Fresh funding defaults DISABLED; HTTP1.119/count8 stay local. This is finite exact
command recovery, not a completed autonomous lifecycle or capability9. Next add
private human review/work UI, remaining economic/shared-reservation scenarios and
complete predeploy/build/browser/preservation gates. Keep prior accepted candidates
unchanged and retain original financial references/recovery/interlocks on rollback.
Publication, flags, real funds/mail/outreach and independent demand remain separate.

## Historical checkpoints (superseded where stated above)

## Original funding process recovery verified — local only

All **9** actual scoped-funding API cases pass with zero failures/skips, including
separate-process exact replay, conflicting reuse across two valid agreements,
a shared original-gross ceiling, and SIGKILL immediately before/after commit.
Before-commit termination leaves the original DRAFT, inventory and deposited
credit unchanged; restart commits once. After-commit restart recovers the SAME
request despite review revocation, fresh rollout closure and new-payment pause.
Refund retains the original fee and consumed inventory; it does not recycle gross.
Types pass. Lint passes after removing one unused fixture binding. The previous
9b9f9b7 application build remains applicable; this checkpoint changes tests only.
Migration79 and its prior local preservation are unchanged, not repeated.

Source manifest **69** files versus e55e151, SHA-256 `b33e7fc41c966356d9a5847bdcd73642dbb571c3380b0ba5e4bca3cc104e3928`.
Evidence: `docs/evidence/reviewed-contract-foundation-2026-10-15/funding-process.json`.
Fresh funding still defaults DISABLED; HTTP1.119/count8 remain local. No live
funds, publication, production flag, independent demand or capability9 claimed.
Next: finite durable exact-command buyer/provider journals and real restarts,
private human review/work UI, remaining economics and complete release gates.
Rollback retains original references, paid recovery and financial safeguards.

## Historical checkpoints (superseded where stated above)

## Separately gated original reviewed funding verified — migration79 unchanged

One scoped fund transaction now recovers known originals first, then checks the
current approved original buyer/owner/reviewer/team/quote/rails/deadlines,
environment/database pause, shared original gross, buyer/agent/global/team caps
and validated internal purchase evidence. It atomically claims original inventory,
funds the SAME original contract, reserves existing deposited credit/fee, records
organization attribution/use and appends the immutable buyer reference. Final
journal failure rolls everything back. No trade/route/task/service/nonce alias.

Fresh funding DEFAULTS DISABLED behind
CLAWDMARKET_REVIEWED_CONTRACT_FUNDING_ENABLED=false (operator example preserved).
Only the dedicated disposable fixture enables it; no production/global flags
changed. Known original GET/replay precedes fresh rollout/pause/permission checks.
Owner review reports funding_api_implemented and funding_requires_current_review;
funding_available reflects the fresh rollout flag, not binding purchase authority.
Both SDKs expose explicit fund/original-reference recovery with no automatic retry.
Seller work reads expose frozen nonwithdrawable-credit/fee/refund terms BEFORE
start; seller receives account credit, not external tokens.

Current **68/68** focused cases, zero skips/failures, **27 Python cases**, types/
lint/SDK parity/build and production build pass. Two ACTUAL public API journeys
use verified disposable test-token deposits, public original DRAFT and owner/
selected reviewer decisions, actual buyer fund, seller start/output, exact buyer
acceptance and credit release of both milestones. Both SDKs lose a committed
funding HTTP reply, recover/replay one original request after revocation, owner/
seller-rail changes, new-payment pause and rollout closure, complete work, then
recover after completion without another fee/reservation. Tests also cover exact
concurrent replay, read-key/cookie/role exclusion, pending review/rail/department/
buyer/team/pause failures and final-append full rollback. No direct initial use
construction substitutes for these NEW scoped paths; older stored-record controls
remain separate. Controlled actors still establish no independent demand, remote
sandbox execution or live paid canary. No capability9 or complete client outcome.

Migration79 unchanged; preceding845-row/133-table/guard/query local preservation
applies, not rerun. Manifest **68** source/config files relative to e55e151,
SHA-256 `1494cc5cb35e627eb3d8f3c7efa3ca918e35256591226986d725b2ed195c41ba`. Evidence is under the contract foundation directory. Prior
accepted listing/pilot candidates stay unchanged. HTTP1.119/count8 remain local;
last observed production1.116/main96a017b and continuing security risk are separate.

Next prove original FUND same/different-body separate-process races, shared budget
reservation orders and before/after-commit SIGKILL/rollback. Then finite durable
buyer/provider journals and real restarts, private human review/work UI and complete
multi-milestone/dispute/refund/revocation/expiry economics plus full predeploy/build/
browser/preservation gates before capability9/1.120. Do not deploy or enable the
fresh rollout flag. Any eventual rollout/publication/live funding needs new
explicit authorization and external risk/provider/inbox/calibration/admission/
canary-budget dependencies remain unresolved. Rollback must retain original
references/financial records and scoped paid recovery/interlocks.

## Historical checkpoints (superseded where stated above)

## Original buyer funding-reference boundary verified — migration79

A separate immutable request now binds buyer/reference uniquely across reviewed
contracts, and pins organization/authorization/original contract/hash/clock to
its original use. Exact original recovery returns frozen original_terms plus
current state/held principal and fee/principal/nonwithdrawability disclosures.
Changed/cross-contract reference reuse conflicts; owner/reviewer/seller cannot
read the buyer request. Earlier reservations gain NO invented request receipt;
their original financial/fulfillment/refund meaning stays intact. Append accepts
only a transaction source for the future atomic financial write. No public scoped
funding writer or SDK is exposed and funding_available staysfalse.

Current focused **47/47**, zero skips/failures, types/lint and production build
pass. Initial39pass/1fail was a wrapped uniqueness-error assertion; the actual
buyer/reference constraint rejected the duplicate correctly. The assertion now
checks its bounded precise cause. Controlled initial use/reference construction
is atomic over actual disposable deposits; it is not a public reviewed purchase
or independent economic activity. Migration79/replay preserves845 LOCAL baseline
rows/133 tables, integrityok, zero FK anomalies,10 reputation guards,4 output,
2 acceptance,2 release,4 adjudication/dispute and2 funding-reference guards, and
all5 actual evidence queries. New reference tables stay empty on legacy migration.
No production backup/deployment or complete new contract release gate is claimed.

Source manifest **63** changed files versus e55e151, SHA-256
`615d2f20a1a0af2c7768d3f4c01080aa1987af443716aad708fe24ffb48801bd`. Evidence is under the contract foundation directory. HTTP1.119/count8
remain local-only; prior accepted listing/pilot candidates remain unchanged.
Next implement the SINGLE [scoped funding transaction](docs/ORGANIZATION_CONTRACT_SCOPED_FUNDING_DESIGN_2026-10-15.md)
with original buyer/current reviewed authority, atomic pause/shared gross/global
budgets, current seller credit rail, original listing claim/credit/fee recipient/
attribution/use/reference. Recover known originals before fresh eligibility and
never adopt unreferenced old reservations or fabricate another financial family.
Then actual funding HTTP/process/economic controls, finite journals/private human
UI and complete release gates before capability9. Retain all original records and
scoped recovery/interlocks across rollback. Do not deploy this unfinished tree.
No publication, real funds, global flags, custody changes, mail or outreach.

## Historical checkpoints (superseded where stated above)

## Durable original contract inventory exclusion verified

Public catalog/snapshot/metrics SQL and listing detail/edit/preview, all generic
fresh trade rails, shared credit/ledger reservations, new reviewed listing scopes
and contract draft/funding checks now exclude original consumed contract inventory.
The binding is the original paid USE plus frozen agreement listing ID, never the
mutable status or current contract link. Refund, cancellation or manual status/
link edits cannot reopen it. Free pending contract review has NO paid use and does
not reserve inventory. Historical identities/credit references and ordinary
unreviewed behavior remain unchanged. No new migration or financial writer.

Current inventory/credit/catalog/transparency checks **59/59** pass; separate
reviewed listing/task compatibility passes **44**, with **4 preexisting retired
legacy-credit skips**, zero failures. Total107cases=103pass4skip. Types/lint and
production build pass. The previous public original release gate91 remains
historical evidence for those adapters, not a new full contract gate. Tests use
direct controlled original reviewed-use records over actual disposable deposits.
Shared reservation anti-adoption is tested; public task/service APIs otherwise
create their own listing identities. No public reviewed funding, complete finite
client/worker journey, live canary or independent customer demand is demonstrated.
Migration78 unchanged; prior845-row/133-table/guard/query preservation applies,
not repeated. Source manifest **61** changed files versus e55e151, SHA-256
`2b24307f395b4ce35c0d7ba567d944f448ca7fba3acc93b1e7bc5d29b79e71c8`. Evidence is under the contract foundation directory.

Next implement unique buyer-scoped original FUND request references and one scoped
reviewed funding/use transaction. Bind exact authority/reference, current buyer/
owner/reviewer/team/rails/deadlines, shared gross and global budgets, current pause,
original quote/principal/fee recipient, atomic listing claim and original credit/
attribution/use. Recover known original funding before fresh eligibility; reject
changed/cross-contract reference reuse and never adopt historical unreferenced
reservations or fabricate a trade/route/task/service identity. Then finite process
journals/private human work UI and complete actual economic/process/release gates
before capability9. HTTP1.119/count8 remain local and undeployed. Prior accepted
listing/pilot candidates remain unchanged. Do not deploy this unfinished tree or
roll back to handlers that recycle consumed inventory/skip exact consent or proof.
No publication, real funds, production flags, custody changes, email or outreach.

## Historical checkpoints (superseded where stated above)

## Exact original public credit release verified — migration78 unchanged

The dedicated POST `/api/contracts/{id}/milestones/{milestoneId}/release` now
requires original buyer/payments:write, cookie CSRF, saved release reference and
exact immutable acceptance ID/submission ID/content hash. Generic hashless
mark_paid remains blocked. Participant GET release_reference recovers the original
pinned ledger posting; selectors cannot combine/repeat. Both SDKs expose explicit
release/recovery with no automatic retry. Seller receives NONWITHDRAWABLE account
credit, never an external token payout. New funding authority is not introduced.

Both SDKs lose an ACTUAL committed financial HTTP reply, recover and explicitly
replay the same original posting after review revocation, then complete the next
milestone through public seller/acceptance/release handlers. Original first release
recovers after completion without another debit/credit. Exact ledger IDs, original
upfront fee and gross remain preserved. Named read/marketplace keys cannot pay;
foreign owners/reviewers have no receipt authority. An inconsistent held-credit
account returns a conflict requiring operator review, rolls back state/postings,
and never asks the buyer to deposit again for already held work.

Current focused **91/91**, no failures/skips, plus **27 Python cases**, types/lint/
SDK parity/build and production build pass. Initial56cases22pass/34fail all rejected
fixture deposits with PAYMENT_PREDATES_INTENT before the release path. Isolated
first control passed. Positive fixtures now advance ONLY the unforked node's next
block after the ACTUAL original intent/latest-block timestamp BEFORE transferring;
no intent is backdated and production payment guards remain unchanged. The final
91 include ordinary credit/refund, original admin, actual HTTP and canonical API
controls. Migration78 did not change; prior845-row/133-table/guard/query local
preservation applies, not newly repeated. No full new contract release is claimed.

Initial reviewed funding/use records are still DIRECT controlled records over
genuine disposable token deposits. Public fulfillment is exercised, but no complete
public reviewed purchasing/client/worker journey, live canary or independent
adoption is established. Scoped reviewed funding/use, durable consumed inventory,
finite process journals/private human UI and complete economic/process/release
gates remain unfinished. HTTP1.119/count8 stay local-only; production was last
observed at16:50UTC on1.116/main96a017b with the same open security risk.

Manifest **54** changed source files relative to e55e151, SHA-256
`633d7875ba9c4de7174b6362f104c447831da7392b3433dd1b0bf49da223b922`. Current evidence is in the contract foundation directory. Prior accepted
listing/pilot candidates stay unchanged. Next complete durable original listing
consumption exclusion and unique buyer-scoped funding references, then one scoped
reviewed fund/use transaction with original fee/credit/attribution and all shared
budget/pause/role/rail/deadline checks. Recover original use before fresh eligibility
and never create a second financial family identity. Finish finite clients/UI and
complete release acceptance before capability9. Do not deploy this unfinished tree.
Rollback must retain original financial/operation/submission/decision/admin records
and scoped recovery/interlocks. No publication, real funds, production flags,
custody changes, email or outreach authorization is implied.

## Historical checkpoints (superseded where stated above)

## Dedicated original seller submission verified — local migration78 unchanged

POST `/api/contracts/{id}/milestones/{milestoneId}/submissions` now accepts bounded
version1, saved client_reference and artifact_bundle from the original paid seller.
The older generic hashless reviewed submit stays blocked. Named credentials need
payments:write, cookies need CSRF, foreign owners/reviewers cannot inspect/write
work, and all responses are private/no-store. Raw requests are capped96000 bytes;
existing canonical artifact65536-byte/depth12/node4096 bounds and SQL immutability
remain. Passing finite checks cannot accept or release credit or prove semantics
or remote sandbox execution. No remote artifact fetching/execution is added.

Both provider SDKs save one exact command, lose an ACTUAL committed HTTP reply,
then inspect by the original seller reference and explicitly replay the same body
after review revocation. One immutable submission/hash remains, with no new output,
acceptance or financial movement. Current focused **53/53 cases**, no skips/failures,
plus **27 Python cases**, types/lint/SDK parity/build and production build pass.
The focused gate includes original financial/acceptance/admin controls and18
canonical cases. It is not a new full predeploy/browser or process-worker gate.
Migration78 did not change; prior local baseline preservation remains applicable.
Reviewed tests still directly construct original funding/use records over genuine
disposable deposits, not public reviewed checkout, a live canary or independent
customer activity. No capability9. HTTP1.119/count8 remain local and undeployed.

The source manifest binds **53** changed files relative to e55e151, SHA-256
`bc1699f78e36353fba497420eed3dfe4e561f593867cef4e44f936d00cf622dc`. Durable output logs/evidence are in the contract foundation directory.
Production was independently observed at16:50UTC on HTTP1.116/main96a017b; current
security/metrics/monitor limitations are in the read-only recheck note. Prior
listing/pilot candidates are unchanged.

Next add a dedicated exact original credit-release POST and participant saved-
release-reference GET/SDK recovery, retaining old generic hashless mark_paid
exclusion. Use payments:write plus original buyer, expected immutable acceptance
ID/submission ID/hash, separate saved release reference and pinned ledger proof.
Verify actual committed release HTTP loss in BOTH SDKs with no duplicate debit/
seller credit, including revocation and completion recovery. Then durable consumed
inventory, scoped reviewed fund/use, finite buyer/provider process journals/private
human UI, actual multi-milestone economics and complete process/release gates.
Do not deploy this unfinished tree. Preserve all original references/records and
scoped recovery/interlocks on rollback; do not restore older hashless approval/pay
or relist consumed inventory. No publication, real funds, production flags, custody
changes, email or outreach authorization is implied.

## Historical checkpoints (superseded where stated above)

## Read-only production baseline refreshed — 2026-10-15 16:50 UTC

Production still serves HTTP1.116/main96a017b. Public counts are now90 profiles,
48 registered agents and15 online; recorded totals remain21 completed trades,
$0.92 volume/$0.02 fees. Legacy services_listed353/services_online84 count listing
records. Public cohort attribution is absent; neither profile growth nor recorded
volume establishes independent/autonomous adoption. Security-maintenance38761523868
failed today on the same high braces finding, with no patched range reported.
Payment monitor38763126626 succeeds on readiness/enabled rails/RPC only; it does
not prove treasury/outbox/anomalies, a paid canary or customer activity. The remote
GitHub description remains obsolete. Nothing was remotely changed. Full timestamped
sources/log evidence: `docs/evidence/reviewed-contract-foundation-2026-10-15/PRODUCTION_READONLY_RECHECK_2026-10-15.md`.
Current contract source remains fba6c92, unfinished local migration78/count8.

## Immutable original admin recovery verified — migration 78

New reviewed admin rulings now commit an immutable operation in the SAME
transaction as dispute closure, original credit distribution and milestone state.
It freezes original dispute/contract/milestone/use/authority, deciding account,
exact ruling/split percentage, original principal and exact refund/seller ledger
entry IDs. Four SQL guards protect both operation and its original resolved
dispute. Nothing is backfilled. Redo pins no financial posting, even after a later
legitimate payout. Admin adjudication never creates explicit buyer consent.

Participant-private GET uses adjudication_reference=<original dispute UUID>,
mutually exclusive with submission/acceptance selectors. Buyer/seller only;
organization owner/reviewer authority grants no output/receipt access. Configured
admin GET of the original resolve path is separately authenticated. Both SDKs
recover participant receipts. Missing/contradictory original financial records
fail closed. An actual committed admin HTTP reply is dropped, then both SDKs
read the same original split without repeating resolution. Journal append failure
rolls back ruling, milestone state and both original credit postings. Actual admin
redo still requires fresh consent for identical bytes under a new submission ID.

Current **92/92 focused Node cases**, no skips/failures, plus **27 Python cases**
pass. Final OpenAPI-only descriptions followed the functional gate; **18 actual
canonical contract cases** plus static checks and final build pass afterward.
Those18 overlap the92 and are not additional unique cases. Initial91pass/1fail
was the ordinary positive fixture inheriting a50-cent approval threshold; its
explicit5-dollar cap now permits the1.05 control without changing app policy.
All four actual ordinary public-funded admin rulings retain their behavior and
gain no inferred reviewed operation. A non-escalated metadata runner reported
only a file pass; it is NOT counted. Permitted execution lists all18 real cases.
Types/lint/SDK parity/build and final production build pass. Migration78/replay
preserves845 LOCAL baseline rows/133 tables, zero FK anomalies,10 reputation,
4 output,2 acceptance,2 release and4 adjudication/dispute guards, plus5 actual
queries. No production backup/deployment or full contract release is claimed.

Reviewed tests use actual disposable deposits with DIRECT controlled initial
funding/use records. No public reviewed purchase, live canary or independent
adoption is demonstrated. Public reviewed funding, seller submission and payment
release stay closed; HTTP1.119/count8 remain local. The source manifest binds
**51** files relative to accepted listing e55e151, SHA-256
`0ddfd62fde2dbcd37061991eb1f458d5392b2e39b584a16d6dbb687a0740f033`. Prior listing/pilot candidates are unchanged.

Next connect public saved-reference original seller submission and exact release/
recovery adapters in both SDKs, then durable consumed inventory and one scoped
reviewed funding/use transaction. Complete finite provider/buyer journals/restarts,
private human work UI, actual multi-milestone public-path economics and full
process/predeploy/browser gates before accepting capability9. Keep all work local;
no publication, real funds, global production flags, custody changes, mail or
outreach. Rollback must retain migration78 original records and scoped financial
recovery/interlocks; never rewrite original financial refs or reopen consumed
inventory. Do not deploy this unfinished foundation. Existing security/provider/
inbox/pilot/publication/live-budget external dependencies remain unresolved.

## Historical checkpoints (superseded where stated above)

## Original unstarted refunds verified — migration 77 unchanged

Reviewed start/cancel/expire now validate original financial use inside their
transaction. Refunds use frozen original principal, preserve the upfront fee and
original credit reference/gross, and do not reactivate linked reviewed inventory.
Current owner, assignment, rails or review revocation cannot erase a paid refund.
Manual and maintenance expiry use the frozen ORIGINAL deadline: changing current
metadata cannot cause early refund or postpone expiry. Maintenance includes paid
reviewed uses even if mutable expiry was removed. Contradictory evidence returns
a timestamped failure with financial_changes_committed:false after rollback;
it cannot report a successful empty maintenance run.

Current **67/67 focused cases** pass, no failures/skips, including original credit,
output/acceptance/release/admin and review compatibility. Types/lint and production
build pass. Initial run39pass/1fail caught an introduced falsy-zero timestamp check
that rejected historical epoch-zero expiry; explicit finite/undefined checks fix
it and the final regression passes. Date tests use a controlled clock with actual
disposable local test-token deposits and directly constructed future use records.
No public reviewed purchase, customer demand or live canary is demonstrated.
Migration77 is unchanged; its prior845-row/133-table/guard/query preservation
remains applicable, not newly repeated. No new full predeploy/browser gate.

The refund handlers now preserve original inventory, but durable catalog/adoption/
funding exclusion after manual status reactivation remains a separate unfinished
boundary. No public reviewed funding, seller submission or payment release is
opened. Count8/10 and HTTP1.119 remain local-only; prior accepted candidates stay
unchanged. Source manifest **49** files relative to e55e151, SHA-256
`f3f918cbfa0f4768d05dc48a74671082490f7c063223cefc3b918c4908b725ad`. Evidence is under the contract foundation evidence directory.

Next implement [immutable original admin-ruling recovery](docs/ORGANIZATION_CONTRACT_ADJUDICATION_RECOVERY_DESIGN_2026-10-15.md),
then public original work/release adapters, reviewed funding/use plus durable
consumed inventory, finite clients/private UI and actual multi-milestone process/
full release gates. Do not deploy this unfinished foundation. Any eventual
migration requires a real production backup and full accepted candidate gates;
the local baseline rehearsal is not that backup. Rollback must preserve original
use, output, consent, release and ledger rows, retain scoped paid recovery, and
never restore generic hashless reviewed approval/payment or inventory recycling.
No publication, real funds, production flags, custody changes, mail or outreach.

## Historical checkpoints (superseded where stated above)

## Internal original credit release verified — migration 77

The contract foundation can now internally release one frozen milestone only
against its exact immutable buyer decision, selected submission ID AND content
hash. A new append-only operation pins the original contract/use/authority,
acceptance, amount and the exact debit/seller credit entry IDs. Exact concurrent
replay returns one original posting; altered/cross-milestone references conflict.
An APPROVED/PAID flag or finite check alone is insufficient. Recovery validates
actual ledger evidence, not state. Seller receives nonwithdrawable account credit.
Public reviewed mark_paid, funding and seller submission remain closed.

Separately authenticated admin buyer-win/seller-win/split/redo policy is retained.
Reviewed resolutions now validate original use and frozen amount inside their
financial transaction, reject existing settlement, and label admin_adjudication
without inventing buyer consent or an explicit-buyer release operation. Actual
admin redo plus identical replacement output requires new exact consent. Immutable
original-reference admin decision recovery is still unfinished; do not claim it.

Current focused checks pass **75/75**, no skips/failures. They include partial
admin refund followed by remaining milestone release, complete two-milestone
internal release, retained upfront fee/gross, exact concurrent replay, no adoption
of admin payouts, changed ledger proof rejection and rollback of state/both credit
postings when the release journal append fails. Initial run had26pass/1fail because
the expected injected database cause was wrapped by Drizzle; the assertion now
inspects its bounded cause chain and verifies rollback. Types/lint/SDK parity and
production build pass. Migration77/replay preserves845 local baseline rows across
133 tables, zero FK anomalies,10 reputation guards,4 output guards,2 acceptance
and2 release guards, and5 actual evidence queries. This is not a production backup.

These controls use genuine disposable local test-token deposits with DIRECT
controlled future funding/use records. They do not prove public reviewed funding,
a complete customer/client journey, a live paid canary or independent adoption.
HTTP stays1.119 locally; accepted capability count stays8/10. No full new contract
predeploy/browser gate is claimed. Source manifest **48** files relative to
e55e151; SHA-256 `6b3f02e02e32e2ecb7425518d8f00f4980201c587c84ce7dcd5aac983474bdee`. Evidence is in
`docs/evidence/reviewed-contract-foundation-2026-10-15/`.

Next preserve original unstarted refunds without recycling reviewed inventory,
finish immutable admin decision recovery and public original work/release adapters,
then reviewed funding/use plus cross-scope consumed inventory, finite client/SDK/
private UI and genuine multi-milestone/process/full release gates. Keep existing
accepted candidates unchanged and all work local. No real funds, production flags,
custody changes, email, outreach or publication authorized.

## Historical checkpoints (superseded where stated above)

## Public exact buyer acceptance and recovery verified — migration 76

The local reviewed-contract adapter now accepts only an authenticated original
buyer command naming version 1, saved client_reference, selected immutable
submission ID AND content hash, and approve:true. Cookie CSRF and named
payments:write remain required. Hashless reviewed approval fails; exact commands
cannot silently fall back to ordinary contract approval. Public mark_paid and
seller submit remain closed, and no reviewed funding exists. Acceptance itself
never releases credit. Count stays 8/10 and HTTP stays 1.119 locally.

Participant-only GET with acceptance_reference recovers the original immutable
decision, current selection/state, held principal and observed_at. Seller-output
client_reference remains a separate selector; combined/repeated selectors fail.
Owner/reviewer review authority exposes no output or decision. Identical bytes
under a new submission ID after redo require new consent. Exact old decision
replay returns its fact without approving replacement output.

Current **86/86 Node cases** and **27 Python cases** pass, no skips/failures.
Both SDKs lose an actual committed HTTP reply, then recover and explicitly replay
one original decision after review revocation, with all principal still held.
These are real transport/adapter controls over direct controlled future-use
records backed by actual disposable local test-token deposits; they are not a
public funding journey, admin redo ruling, live paid canary or customer adoption.
Types/lint/SDK parity/build and production build pass. Initial typecheck overlapped
Next generated-file replacement and failed; sequential post-build rerun passes.
Initial Python sandbox socket denial is recorded; allowed localhost rerun passes.
No migration changed; previous migration76 preservation remains applicable.

Foundation source manifest: **45** files relative to e55e151;
SHA-256 `d2c85a86494de6074f9d6e3ddfc18eae37c4d568bb7b7c4f13989ca4c67ac01f`. Durable evidence is under
`docs/evidence/reviewed-contract-foundation-2026-10-15/`.
The separate e55e151 listing candidate is unchanged and security-blocked.
Next implement frozen original credit release/refund and separate admin-ruling
recovery, then reviewed funding/use, consumed inventory, public seller submission,
finite clients/private UI and complete genuine multi-milestone release gates.
Keep everything local; no funds, production flags, custody, email or outreach.

## Historical checkpoints (superseded where stated above)

## Internal exact buyer decisions verified — migration 76

The separate contract foundation now persists immutable explicit buyer decisions
for exact original submission ID AND content hash, with a saved original reference.
Only the original buyer can issue the internal command; owner/reviewer/seller and
wrong milestone/hash or failed finite output are rejected. Concurrent exact replay
retains one original decision. Redo can retain distinct immutable decisions for
successive submissions of the same milestone; an old decision replay cannot approve
a replacement selection. No money moves on acceptance and original principal stays
held. Public approve/pay remains blocked pending the complete scoped adapter.

Focused acceptance passes **65/65**, zero skips/failures; current types/lint and
production build pass. A strengthened targeted redo control uses IDENTICAL bytes
with a new submission ID, to ensure hash equality alone cannot replay consent;
the final strengthened case passes 1/1, zero skips/failures, in
`/tmp/clawdmarket-contract-exact-acceptance-identical-redo-2026-10-15.log`. Migration 76/replay preserves
845 local baseline rows/133 tables, integrity ok, zero FK anomalies, ten existing
immutable reputation guards, four output guards, two new decision guards and all
five actual evidence queries. These are controlled internal record/decision tests
over genuine disposable local deposits, not public acceptance/funding, an actual
admin redo ruling, a live paid canary or independent adoption. No capability 9.

Source manifest: **45** changed files relative to accepted listing e55e151;
SHA-256 `c93c6eb54c6a0c1f183fad70329ded71bf736ff643ef48a77f36a36a171ca970`. It is not a full release manifest.
Next add authenticated versioned public buyer acceptance and private original-
reference decision recovery, retaining the existing fulfillment interlock for
unsupported actions. Then original credit release/refunds/admin adjudication,
reviewed funding/use, consumed inventory, finite clients/both SDKs/private work UI,
actual multi-milestone process economics and complete release gates. Keep all work
local; no real funds, global production flags, custody changes, mail or outreach.

## Earlier checkpoint evidence

## Private original submission inspection verified

GET `/api/contracts/{id}/milestones/{milestoneId}` now exposes only original
reviewed funded work to its buyer/seller. It returns frozen requirements, selected
original output/hash, held principal and observed_at; exact client_reference
recovers older immutable output with explicit superseded state. Current owner or
selected reviewer cannot read seller output through organization review authority.
Named agent:read credentials can inspect but cannot approve/pay. Unavailable data
returns an error, never invented zero work. Responses are private/no-store.

Current participant/privacy/recovery controls pass 2/2; separate ordinary credit
and canonical API compatibility passes 48/48, all with no skips/failures. Current
types/lint/SDK parity and production build pass in the contract-submission-read
logs. These are focused checks of this readonly addition; the earlier 64-case
submission/interlock gate remains historical evidence, not a new full release.
Migration stays 75. Source manifest is refreshed below. No reviewed funding,
public seller submission, exact buyer acceptance/release or capability 9 is enabled.
The separate e55e151 listing candidate stays accepted, unchanged and security-blocked.
Continue immutable exact-submission buyer decisions before public funding, then
canonical financial/client/UI/recovery acceptance. Keep all work local.

## Earlier foundation checkpoints

## Current original submission checkpoint — migration 75

The local contract continuation now has an INTERNAL original seller submission
append/replay helper and four SQL immutability guards. Exact concurrent references
recover one original submission, changed/cross-milestone requests conflict, and
revocation or a newer selected output cannot rewrite an older submission. Frozen
original requirements govern paid work; current catalog edits do not replace them.
Output metadata explicitly distinguishes finite key presence from semantic accuracy,
observed remote execution, buyer acceptance and financial release. Principal stays
held after submission, including a passing finite report.

The public generic milestone path blocks submit/approve/mark_paid for reviewed
contracts until the scoped operations are integrated. It cannot bypass the original
reference or exact buyer decision through older hashless actions. Ordinary
historical credit contracts retain their behavior. Other reviewed milestone actions
validate original use inside their transaction. No reviewed funding, public work
interface, exact buyer acceptance or release is enabled. HTTP 1.119/count 8 remain;
no capability 9 or independently demonstrated demand.

Complete current focused checks: **64/64**, no skips/failures, in
`/tmp/clawdmarket-contract-submission-interlock-focused-2026-10-15.log`. Types/lint
and current production build pass. Migration 75/replay preserves the original local
845-row/133-table baseline, zero FK anomalies, ten existing immutable reputation
guards, four new output guards and five actual evidence queries. Raw log hashes
and summaries are saved under the contract evidence directory. The source manifest
binds **43** changed files relative to e55e151; SHA-256
`d73cfc314a61cbd7b204b0c767cf0fc589c46fdefe27662eb0abfd2ddd748dba`. It does not replace the accepted listing manifest.

Initial typecheck caught nullable values after a never-returning arrow helper; an
explicit function declaration fixes narrowing. Both focused runtime submission
cases passed initially; all 64 current cases pass after the correction and public
interlock. Tests construct controlled future-use records over actual disposable
local deposits; they do not establish a public reviewed purchase, genuinely lost
submission HTTP reply, real customer activity or a live paid canary. New submission
process/HTTP/SDK/UI and complete outcome acceptance remain required.

Next implement participant-only original submission inspection/recovery and
immutable exact submission-ID/content-hash buyer decisions, preserving separate
admin adjudication and redo history. Then one reviewed credit funding/use transaction,
consumed inventory exclusions, exact original release/refunds, finite clients/both
SDKs/private UI, real multi-milestone process economics and full release gates.
Keep e55e151 listing and bee652c pilot candidates unchanged. No publication, real
funds, global production flags, custody changes, user mail or outreach authorized.

## Historical contract checkpoints

## Shared original gross integrated — local continuation

Current contract source now includes original credit uses in reviewed route,
workflow, task and listing gross checks. The reverse credit budget reader accepts
an explicit credit-only context and reads each original family once, without a
fake external wallet, token or chain-fee ceiling. Credit fees stay in fee-inclusive
USD gross; credit contributes zero external chain-fee units. An exclusion can name
only the checked contract's own original ID. Cancellation/refund cannot recycle
history. No reviewed contract funding API or financial authority is added.

Current full focused run passes **32/32**, zero skips/failures, in
`/tmp/clawdmarket-contract-shared-gross-full-focused-2026-10-15.log`. Both original
reservation orders are covered across all four external families plus the credit
budget; prior unpaid external cancellation remains charged. The earlier integration
regression passes **83/83** original listing payment/review, task authority and
workflow/process cases. Current types/lint/build also pass in the shared-gross
logs. The existing migration 74/local baseline preservation remains applicable;
no schema changed in this step. Evidence still cannot establish a completed
reviewed credit purchase, live paid canary or independent adoption. No capability 9.

Next implement stable immutable seller submission references and exact submission-
ID/content-hash buyer decisions before exposing funding. Preserve authenticated
admin dispute adjudication as a separate financial basis; redo must retain earlier
immutable decisions while requiring a fresh decision for a replacement submission.
Then wire one original credit funding/use transaction, consumed inventory exclusion,
finite clients/SDK/private work UI and complete genuine multi-milestone economic,
process and release gates. Keep e55e151 as the accepted separate listing candidate.

## Historical foundation evidence

## Verified original credit-use foundation — migration 74

The final disjoint compatibility run also passes **38/38** (existing backed
credit and all review process races/kill boundaries). Together with the current
30-case original-use/creation/review/migration run, **68/68** pass with zero skips
or failures on this same source. No full new contract release gate is claimed.

Current read-only use validation passes **30/30**, no failures/skips, in
`/tmp/clawdmarket-contract-original-uses-checked-2026-10-15.log`. Current types,
lint and production build pass. Migration 74/replay preserves the original LOCAL
baseline snapshot (845 business rows/133 tables), integrity ok, zero FK anomalies,
ten immutable guards and five actual evidence queries. This is a disposable local
preservation rehearsal, not a production backup or deployment. Evidence summaries
and log hashes are saved under `docs/evidence/reviewed-contract-foundation-2026-10-15/`.

The reader validates original credit debit/principal/fee recipient, exact original
contract/milestone/reference identity, approval and attribution. Matched original
partial releases/refunds conserve principal and cannot replenish gross history.
Missing use records, orphan sales, contradictory fees and other financial-family
references fail closed. Resetting a prior reservation's state cannot admit a new
review. Current owner/assignment/rails/revocation do not erase historical paid
scope. Tests use actual local test-token deposits plus DIRECT controlled stored-
record construction; no reviewed public funding API/client journey is demonstrated.
Credit's chain-fee totals are exactly zero and do not mix fee units.

No shared route/workflow/task/listing contract gross hook, reviewed funding,
exact-submission buyer acceptance or finite reviewed contract UI/client outcome
exists yet. Continue those dependencies next. HTTP stays 1.119, count stays 8/10;
no capability 9, production flags, publication, real funds, custody changes, mail
or outreach. The accepted listing candidate e55e151 remains separate, unchanged
and security-blocked by the one high unapproved development advisory.

## Earlier foundation checkpoints

## Original credit-use reader under verification — migration 74

The next local foundation adds `organization_contract_uses` and read-only original
reservation validation. It grants no funding or release authority. Each record
binds original authorization/contract/reference/hash, exact fee recipient, gross
whole USD cents and the first funding clock. Validation checks the independently
approved frozen scope, original draft reference, unchanged financial amounts and
milestone IDs, exact organization/department attribution, original credit debit/
held principal/upfront fee, and matched original milestone settlement/refund
entries. Other financial-family IDs, orphan sales and missing original use fail
closed. Paid history does not consult current owner, assignment, rails, catalog
or review expiry; refunds do not replenish gross history and credit has no chain
fee unit. New review admission rejects drafts with an existing reservation or
attribution, even if their mutable state was reset.

This reader is not yet wired into shared route/workflow/task/listing gross gates
and does not implement reviewed funding. Those remain required next steps. The
stored-record tests use actual unforked local test-token deposits and existing
credit ledger functions, then directly construct future original-use records in
a disposable database. This demonstrates validation and conservation controls;
it is not a successful reviewed funding API/client journey, acceptance decision,
production payment, live canary, custody change or independent customer activity.
The first focused run passed29/29. After adding the reset-reservation admission
control, current final focused and preservation/static checks are running in the
`/tmp/clawdmarket-contract-original-uses-*-2026-10-15.log` files. Do not count
uncompleted checks or use the earlier build as acceptance for this newer source.

## Current integrated foundation build verified

The current source after integration passes the production build in
`/tmp/clawdmarket-contract-review-maintenance-build-2026-10-15.log` (exit0;
known MPP warnings). The separate listing candidate e55e151 remains accepted and
unchanged. Contract funding is still unavailable. Next implement historical
original credit-use validation/shared gross accounting before any funding path;
then exact submission/acceptance and financial/recovery acceptance. Do not count
these foundations as another capability or independent adoption.

## Contract backing and maintenance controls — 2026-10-15

The separate local foundation now proves one actual token deposit on an unforked
Base-ID 8453 Anvil node using public dummy keys: 105 minor units credit from one
original 1,050,000-unit token transfer, two exact confirmation API requests and
one credit posting. The approved companion still cannot fund. This is deposited
credit backing/guard acceptance, not a completed reviewed contract, paid live
canary or independent activity. Current evidence:
`/tmp/clawdmarket-contract-credit-backing-final-2026-10-15.log` (1/1, zero skips).

Maintenance now excludes any reviewed contract companion from time-based approval,
including revoked grants, while preserving ordinary historical review-window
policy. A state-only negative control passes time past all review windows without
reviewed approval, credit entries or release. It is not economic proof. The
complete focused original-creation/review/process/credit/migration run passes
**54/54**, zero failures/skips, in
`/tmp/clawdmarket-contract-review-maintenance-focused-2026-10-15.log`; current
maintenance types/lint pass. The earlier production build binds ae3a004 before
this small maintenance correction; current build must be rechecked before any
complete reviewed-contract acceptance. No new capability or funding is enabled.

The listing repair is now fully accepted separately as candidate **e55e151**,
tested source 9d48c39, HTTP 1.119/migration 71: 1,071 Node passes/five skips, 24 Python,
149 Chromium passes/eight skips/zero retries. Security remains blocked. Carry
that repaired history into this continuation while preserving its source-bound
release candidate. Current unfinished contract foundation remains migration 73
and must not be confused with the accepted listing source manifest.

## Private contract review foundation — 2026-10-15

Current separate contract worktree now has migration **73** and credit-only
organization draft review. It freezes the original recoverable DRAFT and ordered
milestone IDs, whole-cent quote/fee/escrow, acceptance specifications, absolute
deadlines, assigned buyer/department/current owner and selected reviewer. DTOs
explicitly say `funding_available:false`; a companion in ANY state blocks generic
funding of its original contract. No reviewed funding/use, payment rail/claim,
acceptance/release authority, client loop or human review page is implemented.
No capability 9/10; HTTP stays 1.119 and this is not a release candidate.

Complete focused run **53/53**, zero failures/skips, includes two separate-process
proposal races and six real before/after-commit SIGKILL boundaries. Original
proposal and exact decision identity survive restart and revocation cannot reopen
funding. Four private behavior cases include fourteen drift scenarios, current
reviewer ownership of participants, privacy, CSRF and bounds, plus existing
creation/credit/migration regressions. Current types/lint and migration/replay to
73 preserve 845 original rows/133 tables, ten immutable guards, five actual queries.
The current production build passes in `/tmp/clawdmarket-contract-review-build-2026-10-15.log` (known MPP dynamic-dependency warnings).
The separate listing repair source 9d48c39 remains frozen while its final enabled
gate runs (browser149pass/eightskip, zero retries already passed). Do not confuse
that candidate's 71 migrations/source manifest with this unfinished foundation.

## Original draft clients — next local checkpoint

TypeScript and Python now expose explicit create/recover original contract draft
commands with mandatory saved references in their client input types. They never
fund, grant organization review, retry an uncertain mutation or extend dates.
Generated metadata uses canonical existing contract operations. TypeScript's
lost-response check reaches the actual local API/database, then performs GET and
explicit exact POST replay; **29/29** focused API/SDK/contract cases pass. Python
has a real local dropped-response fixture (transport only), distinct from actual
application or chain evidence. One initial Python fixture expected the wrong
existing dummy key; the corrected complete Python run passes **26/26** in
`/tmp/clawdmarket-contract-draft-python-final-2026-10-15.log`. Current types,
lint, SDK build and generated parity pass. Complete reviewed-contract authority,
payment, clients/UI and full gates remain unfinished; no capability 9/10.

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

## Private review foundation evidence

Current focused application/review/process/migration evidence:
`/tmp/clawdmarket-contract-review-races-focused-2026-10-15.log`, **53/53**,
zero failures/skips. Current type/lint files are
`/tmp/clawdmarket-contract-review-races-{types,lint}-2026-10-15.log`.
`/tmp/clawdmarket-contract-review-preservation-2026-10-15.log` checks migration
73 and replay on a fresh original baseline copy, all original business rows,
zero FK anomalies, ten immutable guards and five actual query executions.
No authority is inherited and no original creation reference is invented.
Earlier focused run passed45; typecheck caught an optional expiry type, corrected
without changing policy. A test tried to insert a second buyer owner and correctly
hit the single-owner primary key; it now performs an ownership transfer. No
co-ownership behavior or financial execution is claimed. The complete corrected
53-case run includes both process races and all six kill boundaries.

Current owner or selected current reviewer can inspect frozen terms; unrelated
accounts, the assigned buyer and seller cannot use organization review inspection
to read private review data. Review access does not grant participant delivery
access. Current assignment, owner, department, buyer/seller/reviewer bans, reviewer
role, either participant ownership, seller visibility/credit opt-in, original
milestones/quote/acceptance/deadlines and optional linked inventory are checked
before fresh decisions. Exact original proposal/decision replay retains revoked
state; no new reference can replace this contract's existing companion. Reference
lookups are bounded and private; local read contention returns retryable 503.
No submission bytes, source credentials or artifacts enter review DTOs.

This foundation must not be rolled back to a generic-funding application while
ANY organization_contract_authorizations row exists, including pending/revoked.
Retain the generic contract funding guard, original draft lookup and review
inspection/revocation handlers. Do not delete reference/review rows to make an
old release seem compatible. Existing funded contracts retain original release,
refund, dispute and fee semantics. Future reviewed funding must remain separate
from generic paths and cannot be implemented by reusing a marketplace trade,
listing/task claim, route mandate, wallet nonce or synthetic service identity.
