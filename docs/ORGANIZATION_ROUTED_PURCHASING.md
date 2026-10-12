# Reviewed organization routes

An organization owner can propose one public-provider Ethereum L1 purchase for
an independently selected purchasing approver. The proposal freezes the original
objective, private input, candidates, owner-linked agent, department, cost center,
mandate, expiry, token, wallet, treasury, reserve floors, gross ceilings and gas
ceilings. It creates no checkout and moves no funds. The first version allows
one execution and zero paid retries; private providers and Tempo require separate
authority and acceptance.

The ordinary human account client proposes using either an existing owned
`route_id`, or the exact `agent_id` and `route_request`. Save the complete original
proposal and its `client_reference` before sending. A proposal may defer only
the buyer's independent-approval threshold. Every other provider, buyer, payment,
schema, verification, budget, deadline and capacity restriction still applies.
Pending candidates explicitly report `requirements_satisfied: false` and
`approval_required: true`. Current production reputation ordering is retained.

The private response supplies `review_url` and the original `authority_hash`.
Open `/organizations/{organizationId}/route-authorizations/{authorizationId}`
while signed in as the current owner or selected reviewer. Inspect the private
work and original limits. Only the selected independent reviewer can approve;
they must explicitly confirm the review. Save the original decision reference
and hash. A lost reply requires inspecting that same proposal before replaying
the same decision. A new decision reference cannot replace an existing decision.
The interface stores only decision identity in session storage and clears private
work when inspection is denied, the tab loses visibility, or its review expires.

TypeScript ordinary account methods are `proposeOrganizationRoute`,
`recoverOrganizationRoute`, `inspectOrganizationRoute`,
`approveOrganizationRoute` and `revokeOrganizationRoute`. Python equivalents use
snake_case. Recovery uses the exact original proposal reference. Inspection
includes the original immutable `decision`, or null while undecided. Neither
client retries mutations automatically or signs wallet transactions. Organization
read keys and existing `cmos_` direct-service keys gain no routing authority.

After review, the original buyer uses the existing route execution and funding
workers with the original mandate. Reservation atomically consumes one original
authority use together with its order, trade, capacity and department budgets.
Current owner, agent assignment, team, reviewer role, frozen service contract,
mandate and decision are checked again before checkout and fresh funding.
Historical candidate approval labels never authorize a payment.

Daily and monthly gross windows use UTC. Gross and maximum original gas exposure
are shared across reviewed grants for the same organization and buyer. Revocation,
unpaid cancellation, settlement and refunds do not replenish those exposures.
The shared buyer wallet lock and original server payment claims prevent replacing
an unreconciled payment. Delivery requires the existing explicit buyer decision
and confirmed payout before a backed completed route receipt is returned.

Either authorized participant can revoke fresh spending. Keep the original buyer
credential, intent, signed bytes, transaction hash and proof for recovery. The
buyer can reconcile a previously claimed payment and its existing full refund;
revocation does not authorize a new signature, broadcast or order. This capability
does not enable any production execution/payment flag or fund a live canary.

Storage is additive runtime migration 64,
`2026-10-12-organization-route-authorizations-v1.sql`. Reputation migration 63
and its immutable evidence guards remain in place. Local contract is 1.112;
production remains the accepted 1.111 release until protected publication.

Local contract 1.114 adds separately reviewed version-2 Tempo proposals and
decisions with their own fee-token terms; the version-1 L1 hashes and native-wei
meaning stay original. Gross is shared across both rails, while Tempo fee units
use additive migration 65. See [Tempo authority and evidence](ORGANIZATION_ROUTED_TEMPO_PLAN.md).
