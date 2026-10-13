# Independently reviewed private-provider routing

HTTP 1.115 adds explicit private-provider proposal versions without changing public
v1/v2 authority. Version 3 uses Ethereum L1 native-wei ceilings; version 4 uses
configured Tempo chain 4217 six-decimal pathUSD fees. Each grants one execution,
zero paid retries, and its original daily/monthly/lifetime gross and fee ceilings.

The provider owner first offers an exact organization service share; the current
organization owner accepts that original offer. This direct-service consent is a
prerequisite. It cannot authorize a route by itself. The organization owner then
calls `proposeOrganizationRoute` / `propose_organization_route` with version 3 or
4, `provider_share_ids`, the assigned `agent_id`, an exact embedded `route_request`,
a separate `reviewer_role_id`, spending limits and the immutable mandate. Private
proposals require distinct accepted shares and cannot reuse a previously planned
public route. Every supplied share must resolve to an approved frozen candidate.

The selected independent reviewer inspects the private review URL or the SDK's
original authorization and approves the matching version, `authority_hash` and
one original decision `client_reference`. Public versions 1/2, direct-service
approvals, organization spending credentials, catalog readers, other members and
buyer credentials cannot approve this private grant. Private candidates do not
enter ordinary planning or public discovery. Ordinary route responses redact the
private candidate list, work input and provider requirements; named read-only agent
keys cannot inspect private mandate terms. The reviewer endpoint retains the exact
original scope for its current owner and selected authorized reviewer.

Each frozen share records its ID, service, both original owners, provider agent,
organization, department, original offer and acceptance references/fingerprints,
accepted timestamp, expiry and consent fingerprint. The service execution contract
and price are frozen separately. Approval, reservation, intent and claim recheck
current two-owner consent, original owner links, assigned buyer/department, reviewer,
mandate, contract and every existing financial gate. Reservation resolves the share
internally from the original grant. Passing `provider_share_id` on a routed checkout
remains rejected.

Gross is shared with public grants across L1 and Tempo for the same organization
and buyer. Native wei and Tempo fee units remain separate. Order/capacity, original
use, fee exposure and department budgets commit together; losing reservations roll
back. An L1 worker rechecks its same signed claim after wallet inspection and
journaling immediately before broadcast. Tempo rechecks inside the SDK's actual
RPC send guard, after simulation. These checks do not create replacement signatures.

Either owner can revoke the share. Fresh commitments and sends stop. Existing
claimed bytes, paid proof, full refund, original private review and backed result
recovery retain their original financial state machine. Settlement, cancellation,
revocation and refunds never replenish original gross or reserved fees. A newly
accepted share or newly reviewed grant does not reset that history.

Lost proposal replies recover by the original owner reference. Lost decisions
recover by inspecting/replaying the exact original version, hash and decision
reference. Both TypeScript and Python use the existing ordinary-account methods.
The desktop/mobile review shows original two-owner consent and fee units, clears
private data when inspection is denied and saves only decision identity locally.

Storage extends the existing immutable-scope grant JSON. No historical record,
credential, table or migration is rewritten; migration 65 remains the latest
additive schema. This outcome does not authorize broader product/task/workflow
purchasing or a production rollout.
