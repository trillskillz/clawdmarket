# Local contract review foundation

This unfinished credit-only foundation is local HTTP 1.119 and migration 79.
Approval alone grants no funding or release authority. It is not capability 9/10,
a deployed product or independently demonstrated customer activity. Creation
uses the original optional buyer-scoped `client_reference` on POST `/api/contracts`
and GET `/api/contracts?client_reference=...`; see the audit for exact bounds and
legacy behavior. New reviewed drafts must have an original creation reference.

Owner POST `/api/organizations/{id}/contract-authorizations` accepts version 1,
client_reference, contract_id, buyer_agent_id, reviewer_role_id, expected_total,
max_daily, max_monthly, max_lifetime and expires_at. Money uses bounded whole-cent
USD strings and includes the upfront fee. The review expires within 24 hours and
before the original draft expiry. Freeze records include the exact existing
ordered milestone IDs, titles, acceptance specifications, amounts, review windows
and absolute deadlines. No funds, inventory, provider work or financial-use
record is reserved. Only the current linked owner can propose an assigned agent.

Owner GET of the collection requires the exact original client_reference. Item
GET allows the current owner or selected current reviewer. Item DELETE closes
fresh permission. Selected current reviewer POST to `/{authorizationId}/approval`
names version 1, original authority_hash, saved decision client_reference and
approve:true. Owner self-approval and reviewer ownership of either participant
are refused. This is organizational separation of duties, not proof of marketplace
independence, output semantics or remote execution. Existing private participant
contract/delivery APIs remain separate and review access grants no artifact access.

Cookie mutations require CSRF; bounded bodies and existing owner purchasing rate
limits apply. All review responses are private/no-store. Exact proposal/decision
replay preserves original scope and revocation; a new reference cannot replace
the same original draft's review. Changing owner, assignment, reviewer, department,
seller rail/visibility, quote, milestone, acceptance or deadline closes fresh
decisions. Funding DTOs expose the default-disabled fresh rollout flag as funding_available, plus funding_api_implemented:true and funding_requires_current_review:true. These are not binding funding eligibility. Pending,
approved and revoked companions all block generic funding of that exact contract.

Prepaid credit cannot be withdrawn as cash or tokens. Sellers receive account
credit. The original upfront fee and refundable held principal are shown separately;
unstarted refunds retain that original fee treatment. No new custody or withdrawal
mechanism is introduced. Reviewed companions are excluded from automatic elapsed-window approval in all
states. This restriction alone cannot accept or pay a milestone.

Original-use validation and shared reviewed gross are implemented as read-only
financial history checks. They do not authorize funding or release. Both
credit-first and external-first reservation controls cover route, workflow, task
and listing. Credit contributes zero external fee units. The separately gated reviewed fund endpoint below now exists. Older direct stored-use controls remain distinct from its actual public API journeys; neither is independent economic proof.

Original immutable seller submissions exist internally (migration 75): bounded
finite JSON, stable saved references, exact content hashes and four SQL update/
delete guards. The dedicated local POST
`/api/contracts/{id}/milestones/{milestoneId}/submissions` accepts version1,
client_reference and artifact_bundle from the original paid seller. Named keys
require payments:write and cookies require CSRF; foreign owners/reviewers have no
work authority. HTTP input is capped96000 bytes and canonical artifact JSON65536
UTF8 bytes/depth12/nodes4096. First success201/exact replay200; changed reference
reuse409. Save the exact JSON/reference before sending and recover by the existing
participant GET client_reference after uncertainty. TypeScript/Python expose
submitOriginalContractOutput/submit_original_contract_output. Both actual
application HTTP lost-reply controls pass without new output or financial movement.
The older generic hashless reviewed submission remains blocked. Passing required-key presence
checks cannot accept output or release credit. Semantic accuracy and remote
sandbox execution remain unmeasured. No remote artifacts are fetched or executed.

Original buyer/seller GET `/api/contracts/{id}/milestones/{milestoneId}` is private,
no-store and timestamped. Default returns selected original output or null before
delivery, frozen requirements and remaining held principal. Optional
`client_reference` selects an older original seller submission, marking whether
it is superseded. Optional `acceptance_reference` selects a saved original buyer
decision. The selectors cannot be combined, repeated or supplemented by unknown
query fields. Named agent:read credentials may inspect; owner/reviewer review
scope grants no seller output or decision access. Unavailable/contradictory
original data produces an error rather than invented empty work or zero balances.

Explicit buyer decisions are immutable (migration 76). The local PATCH accepts:

```json
{
  "action": "approve",
  "version": 1,
  "client_reference": "save-original-decision-reference-first",
  "submission_id": "<exact selected original submission UUID>",
  "content_hash": "<exact 64 lowercase hexadecimal content hash>",
  "approve": true
}
```

Only the authenticated original buyer can approve. Cookie requests require CSRF;
named agents require payments:write. Save the exact body before sending. First
success returns 201, exact replay 200, changed command/reference or selection
conflict 409. Missing exact fields fail validation; the command cannot fall back
to ordinary contract approval. Failed finite checks cannot be accepted. An old
decision replay returns the original fact before checking fresh eligibility; it
cannot approve a replacement submission. Even identical bytes under a new
submission ID after redo need a fresh decision. Both old and new facts survive.

On uncertainty, GET with `acceptance_reference` before explicitly replaying the
saved exact body. Read and replay report original decision ID/hash, selected
submission ID, applies_to_current_submission, current milestone state and held
principal. A selection match alone is not payment authority or a capability
claim. Acceptance returns financial_release_performed:false because this command
never releases credit. The generic reviewed mark_paid remains blocked; the separate exact release resource below is available locally. Raw APPROVED
or COMPLETED states are not financial settlement evidence.

TypeScript methods: inspectOriginalContractSubmission,
acceptOriginalContractSubmission, recoverOriginalContractAcceptance. Python:
inspect_original_contract_submission, accept_original_contract_submission,
recover_original_contract_acceptance. Both SDKs preserve the saved exact command
and never automatically retry mutations. Their actual application HTTP response-
loss controls recover one committed decision after review revocation, without
credit release. This does not establish a complete funded contract journey.

The dedicated local POST `/api/contracts/{id}/milestones/{milestoneId}/release`
accepts version1, a separate
saved client_reference, acceptance_id, exact submission_id and content_hash. It
requires the selected original immutable buyer decision and APPROVED milestone;
it requires original buyer/payments:write and cookie CSRF, and atomically posts
the frozen original amount, records exact ledger row IDs,
marks the milestone paid and activates the next pending milestone. It grants no
new funding authority. Original participant GET release_reference recovery checks the posted debit/seller credit pair; a state flag alone cannot
produce financial_posting_confirmed. Append/update/delete constraints preserve
this original release fact, and a failed append rolls the entire transaction back.
The original upfront fee stays charged and history remains in reviewed gross.
TypeScript/Python expose releaseOriginalContractCredit/release_original_contract_credit
and recoverOriginalContractCreditRelease/recover_original_contract_credit_release.
A distinct saved reference binds exact immutable acceptance ID, submission ID and
hash. First success201/exact replay200, changed reuse409. A lost response never
authorizes a replacement payment. Both actual application HTTP financial losses
recover and explicitly replay one posting after revocation and completion. Current
account inconsistencies fail with operator-review conflict and roll back; they do
not request another customer deposit.

Admin resolutions validate original reviewed financial use/frozen amounts and
report a separate admin_adjudication basis. They cannot create explicit buyer
consent or buyer-directed release records. Migration78 now pins new reviewed admin outcomes and their resolved disputes
with four SQL immutability guards. The original dispute UUID is the recovery
reference. GET the milestone with adjudication_reference to read its immutable
ruling, exact split percentage, measured credit distribution and pinned original
ledger row IDs. Only original participants can read it. Configured admin GET
`/api/admin/contracts/disputes/{id}/resolve` independently checks admin account
authority and returns the same original outcome without seller dispute artifacts.
No historical outcomes are inferred. Resolved PATCH replay stays409: inspect the
saved original dispute ID before any retry. TypeScript/Python provide
recoverOriginalContractAdjudication/recover_original_contract_adjudication.
Redo reports financial_posting_confirmed:false forever for that redo operation,
even after another legitimate ruling or exact buyer release pays the milestone.
A mutable state flag alone cannot create this receipt. These reads grant no
admin adjudication, buyer consent or payment authority.

Reviewed unstarted cancel/expire and maintenance now validate original financial
use before changing state or credit. Original principal is refundable, the upfront
fee stays charged, and gross remains consumed. Current permission/owner/rail edits
do not replace paid terms. Expiry uses the frozen original absolute deadline;
mutable metadata cannot advance or postpone it. Refund handlers keep the linked listing sold. Public catalog/snapshot/metrics,
listing detail/edit/preview, generic checkout across all rails, shared credit/ledger
reservation, reviewed listing and new contract scopes now also exclude the original
paid use's FROZEN listing ID, including after manual status or current contract-link
changes. Free pending review reserves no inventory. Task/service APIs create their
own listing identities; the shared reservation guard prevents adopting a consumed
contract listing where a caller supplies one. Contradictory original evidence rolls back
maintenance and returns a timestamped explicit failure, not zero successful work.

Migration79 now implements INTERNAL immutable unique buyer/client_reference
funding requests. They pin original use/contract/authority/hash/clock and recover
immutable original_terms, current state and held principal. Wrong actors and
changed/cross-contract reuse fail. Existing reservations gain no invented request
receipt. The scoped writer now appends it inside the SAME original credit/use/attribution
transaction. POST `/api/organizations/{id}/contract-authorizations/{authorizationId}/fund`
accepts version1, saved client_reference and exact authority_hash from the original
payments:write buyer (cookie CSRF required). Fresh execution defaults disabled by
CLAWDMARKET_REVIEWED_CONTRACT_FUNDING_ENABLED=false. Do not enable it without new
rollout authorization. Current original review, global/shared/department budgets,
pause, seller credit rail, quote/deadline and inventory are checked transactionally.
Known exact replay200 precedes fresh eligibility; first commit201. Final append
failure rolls back all effects. Original buyer GET with client_reference recovers
the same request/use/fee/contract, immutable original_terms and current held
principal, even after fresh rollout/permission closure. Original review access
grants no buyer funding or private seller output. TypeScript/Python provide
fundOriginalOrganizationContract/fund_original_organization_contract and
recoverOriginalOrganizationContractFunding/recover_original_organization_contract_funding.
The actual scoped deposit->public review->fund->public fulfillment path is now
tested, including both SDKs losing a committed funding reply. This is controlled
disposable evidence, not a complete process/human/customer release.

Remaining work: scoped funding separate-process/kill/shared-race acceptance, consumed inventory exclusion,
public original seller submission, finite buyer/provider restart journals, private
human work UI, actual multi-milestone economics and complete release gates.
No contract capability9, publication, live-payment or outreach authorization is
implied. Preserve all original operation, decision, submission, use, review and
financial rows across rollback. An older generic milestone handler must not serve
new reviewed obligations; retain scoped recovery and the payment/submission
interlocks. Existing ordinary historical contract policy stays unchanged.

Finite buyer/provider exact-command journals, recovery and reviewable local CLI instructions: [original contract command worker](ORIGINAL_CONTRACT_COMMAND_WORKER.md). This does not complete the overall contract capability.

Private owner/selected-reviewer human review: `/organizations/{id}/contract-authorizations/{authorizationId}`. The actual review DTO supplies `review_url`. It discloses original nonwithdrawable-credit terms and cannot fund or inspect participant output. Browser recovery keeps only original decision identity, clears unavailable/private state and preserves original approval references.
