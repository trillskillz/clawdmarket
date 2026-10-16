# Next contract funding boundary (dependency notes, no payment authority)

The migration73 review foundation cannot fund. Complete this boundary before
exposing a reviewed fund endpoint, advertising execution, or counting capability9.
Current accepted listing release repair remains separate at 71 migrations. Keep
all work local and preserve the original deposited-credit custody/accounting.

The original reviewed contract needs a separate use row bound to its authorization,
contract, original funding request/reference/hash, authority hash, buyer and gross
whole USD cents. The existing credit `purchase` reservation and organization
contract attribution must commit in the same original funding transaction. There
must be exactly one use per original contract and no marketplace trade, service
order, route mandate, EVM/Tempo claim or wallet nonce fabricated to represent it.
Credit fees are part of gross USD exposure, not wei or Tempo fee-token units.

Existing `readOriginalOrganizationRouteExposure`, `organizationWorkflowExposure`,
`organizationTaskExposure` and `organizationListingExposure` return gross windows
and separate external fee totals. Their read-only payment argument currently
requires external payment metadata for fee filtering. Extend only those pure
readers to accept an explicit credit-only context for gross reads. Do not create a
fake external rail/token, weaken original external evidence checks or allow credit
in any external payment/claim parser. Credit funding does not consume an external
fee allowance. Add a separate original-contract-use exposure reader and include
its gross once in each fresh route/workflow/task/listing/contract gate. If delegated
service grants have separate lifetime semantics, preserve that policy and retain
the existing global buyer/organization/department ceilings.

The contract use reader must check original credit reservation deltas, exact
buyer/organization/agent/department attribution, frozen gross/fee/principal and
original contract/milestone IDs. Refunded, cancelled, disputed and completed uses
remain in original gross history. Bound scans and fail closed on orphaned,
contradictory or cross-scope rows. Do not double-count the new use and its existing
contract attribution inside the same reviewed gross calculation; existing global
buyer/department checks continue independently. Historical use validation must
not call the fresh DRAFT-only/unexpired snapshot function. Current owner, seller
preferences and mutable public catalog cannot erase an already funded refund or
fulfillment obligation.

A linked public listing has a second inventory boundary. Free review reserves no
inventory against unrelated buyers. Fresh reviewed funding must atomically claim
the current listing and preserve exact seller/scope exclusions. After a reviewed
contract consumes it, original cancellation/expiry/refund must not relist or recycle
that listing, even after manual status reactivation. Add original reviewed-contract
listing exclusion consistently to catalog SQL, detail/edit, generic checkout,
task/service adoption and contract creation/funding. Keep ordinary historical
contract relisting/refund behavior unchanged where no reviewed use exists.

Before any reviewed funding, freeze exact-submission acceptance and recovery:
append a stable seller submission operation/reference/hash without backfilling
legacy rows; require original buyer acceptance naming exact selected submission
ID and content hash; exclude reviewed contracts from automatic review-window
approval. Structural key checks, declared artifact metadata and elapsed time
cannot authorize payment. Preserve the original selected submission and decision
across lost replies and restarts. Owner/reviewer access never grants private
seller artifacts or buyer acceptance authority. Preserve original partial
milestone release/dispute/refund arithmetic, including the charged upfront fee.

Acceptance must include all shared gross reservation orders and actual separate
process races; genuine deposit-backed disposable credit with multiple milestones;
original submission/acceptance/funding response loss in both SDKs; process deaths
on both sides of commits; time past every review deadline without fabricated
acceptance; partial payout/refund and revocation; new owner/assignment/department/
rail/deadline constraints; full preservation, isolated verification, types/SDK/
lint/build and private browser gates. Seeded unbacked credit, RPC success flags,
controlled cohort counts and readiness checks do not substitute for economics,
independent customer activity or a live paid canary. The high braces advisory,
provider inbox delivery, actual participant admission, publication, treasury budget
and recruitment dependencies stay separate and unresolved until real evidence or
explicit authorization resolves them.

## Submission and dispute dependency discovered in current code

The existing admin contract-dispute resolver can issue original buyer-win refunds,
seller-win releases, split releases or redo. Preserve that separately authenticated
adjudication policy; it must never be relabeled explicit buyer acceptance. For a
reviewed contract, validate the original reviewed use, frozen original milestone
amount and original credit reference inside the same resolution transaction.
Ordinary historical wallet/credit contracts retain their original behavior.

Redo can return an unpaid milestone to ACTIVE after an earlier buyer acceptance.
Therefore an immutable future acceptance ledger must permit distinct decisions
for different original submission IDs of the same milestone. Do not overwrite or
delete the older decision, or enforce a single acceptance row per milestone that
would prevent an authorized redo. Selected submission ID plus exact content hash
must scope every new approve/pay command. An old decision's exact replay can return
its historical fact, but cannot approve/pay a replacement selected submission.
Once paid/refunded, existing terminal state and unique original milestone financial
reference prevent another release. A new submission following changes/redo needs
a new saved operation; a lost original submission reply must recover its old ID
and bytes before any new computation. Reviewers/owners still receive no private
seller artifact or buyer acceptance authority.

Current inspected code has no standalone human contract page and no private
submission GET route. The finite reviewed contract work interface must therefore
add participant-only bounded original submission inspection/recovery as part of
the eventual complete outcome. Human/client surfaces must show pending credit
release versus confirmed original credit settlement and distinguish finite key
checks, explicit acceptance, admin adjudication and actual financial posting.
Do not advertise remote sandbox execution, semantic accuracy, marketplace
independence or withdrawability based on those records.
