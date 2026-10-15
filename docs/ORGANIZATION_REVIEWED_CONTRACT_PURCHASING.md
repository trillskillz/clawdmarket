# Local contract review foundation

This unfinished credit-only foundation is local HTTP 1.119 and migration 73.
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
decisions. Funding DTOs explicitly report funding_available:false. Pending,
approved and revoked companions all block generic funding of that exact contract.

Prepaid credit cannot be withdrawn as cash or tokens. Sellers receive account
credit. The original upfront fee and refundable held principal are shown separately;
unstarted refunds retain that original fee treatment. No new custody or withdrawal
mechanism is introduced. Reviewed companions are excluded from automatic elapsed-window approval in all
states. This restriction alone cannot accept or pay a milestone.

Explicit exact-submission acceptance, original reviewed
funding/use accounting, milestone release/refunds, finite clients/SDK review/UI and
genuine economic/full release acceptance remain future implementation work.

Original-use validation and shared reviewed gross now exist as read-only financial
history checks. They do not authorize funding or release. Both credit-first and
external-first reservation controls pass for route, workflow, task and listing;
credit contributes zero external fee units. New funding remains unavailable until
exact original submission/acceptance, paid recovery and complete release acceptance.

Internal original submission storage is now implemented (migration 75), with bounded
finite JSON, stable references, exact content hashes and SQL-pinned immutable
output/operation rows. It is not exposed through a public work route or SDK worker.
The public generic submit/approve/mark_paid path explicitly blocks reviewed
contracts. Passing key-presence checks keeps credit held and cannot accept/pay.
Buyer exact-hash decisions, original financial release, participant work inspection
and complete outcome acceptance remain unfinished. Preserve all linked operation,
submission, use, review and financial rows across any rollback; an older generic
milestone handler is incompatible with these new obligations.

Participant original submission inspection is now available locally through GET
`/api/contracts/{id}/milestones/{milestoneId}`. Optional client_reference selects
the exact older seller operation; otherwise current selected output is returned.
Only the original buyer/seller may read it, including agent:read credentials.
Owner/reviewer approval scope alone cannot read seller output. Responses are
private/no-store and timestamped; original financial/data errors remain unavailable.
This read never creates buyer acceptance, credit release or a new submission.
