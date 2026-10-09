# Bounded organization service purchasing

Local contract 1.95 adds explicit requester and approver grants to organization
members. Membership and `cmo_` keys remain read-only. The actual assigned buyer
agent must use its own payments:write credential to reserve and authorize payment.
Approval supplies no wallet key and broadcasts nothing.

## Exact purchase flow

1. Current owner POSTs `/api/organizations/{id}/purchasing/roles` with version 1,
   stable `client_reference`, active member `account_id`, `role` requester or
   approver, `team_id` (nullable), positive USD `max_purchase` and ISO `expires_at`
   within 90 days. The bound includes the marketplace fee. Roles are immutable;
   change authority by revoking and creating a new reference. GET returns only
   the caller's own grants, or the current owner's bounded inventory. DELETE
   accepts `role_id`. No raw organization credential is accepted.
2. Owner or explicit requester POSTs `/purchasing/requests`: version 1, stable
   reference, exact assigned `buyer_agent_id`, `service_id`, requester grant ID
   (null for owner), selected reviewer grant ID (null for owner review), original
   `order`, and ISO expiry within 24 hours. Order includes original checkout
   reference, objective, private input/provider requirements, explicit
   credit/evm/mpp rail and USD `max_total`; optional expected price. It cannot
   contain an approval ID. Buyer must still belong to the current owner and
   original organization/team/cost center. Quote captures the exact seller,
   execution contract, price and fee. No order, capacity or funds are reserved.
3. Share `/organizations/{id}/purchasing/{requestId}` with the selected reviewer.
   The private page shows exact input, total, rail and cost center. Current owner
   or exact selected approver POSTs `/requests/{requestId}/approval`: version 1,
   stable reference, frozen `request_hash`, `approve:true`, expiry no later than
   the request. Delegated self-review fails. GET request exposes the immutable
   decision/use only to current owner, original requester or current selected
   reviewer. Approver can revoke its decision; owner can revoke any decision.
   Owner/requester can cancel a request. Expired/revoked grants never revive.
4. Buyer sends the exact original order plus `purchasing_approval_id` to existing
   `POST /api/services/{serviceId}/orders`. This consumes one approval inside the
   capacity/listing/trade/order/attribution transaction. Only the saved buyer
   policy approval threshold is cleared. Deployment, buyer/day/month budgets,
   department/organization ceilings, provider evidence, capability, rail and
   verification restrictions must all pass. Routes/workflows, listings/tasks,
   contracts and instant purchases cannot use a direct-service approval.
5. Existing funding/provider/delivery/explicit-review/settlement flows apply.
   Exact original checkout replay recovers its order/trade after policy or role
   changes and closed flags. Cancellation/refunds never make an approval reusable.
   Fresh funding rechecks current ownership, both role memberships/bounds,
   assignment/cost center, quote and expirations. A previously sent payment is
   still recorded using its original hash and enters the existing full-refund
   outbox if current eligibility rejects it. Do not send a replacement payment.

Requests and decisions are private/no-store, vary by authorization/cookie and
have 16 KiB bounded bodies and ten-second stream limits. Cookie writes require
CSRF. Mutation rates are bounded. Management and approval-scoped order writes
use at most six fresh transaction clients with bounded SQLite contention retry;
no shared financial pool changes. Business authorization/state errors fail
without automatic retry. Persist exact bodies and references before any request;
inspect after response loss. SDK contract metadata does not automatically retry
mutations or broadcast funds. Page refresh inspects saved decisions.

## Deployment and recovery

Apply additive migration 58 (`2026-10-09-organization-purchasing-v1`) before code.
It creates grants, requests, decisions and one-use economic links, plus a nullable
service-order approval pointer. Historical orders/payment/financial rows keep
original values. Existing enterprise/reusable-service write flags remain closed
in production. Closing enterprise writes blocks fresh approvals and consumption,
but not authenticated inspection, revocation, checkout replay or original sent
proof/refund recovery. Do not roll back to threshold-unaware code with active
approved checkouts: pause fresh payments first and preserve original obligations.
Never rewrite grants, decision hashes or payment/consumption history.

## Acceptance boundaries

Validation uses guarded disposable SQLite and unforked loopback Anvil with dummy
wallets/token only. The test token implements six-decimal ERC20 transfers and
precision inspection. A real transfer backs the registered buyer's deposit,
approved service reservation, separate provider process restart, exact schema
receipt, explicit buyer acceptance and exactly-once seller credit payout. Seller
credit remains deposited platform credit, not an external seller withdrawal.
A second actual EVM transfer is recovered after decision revocation/closed flags
through the original confirmed full-refund transfer. No live spending, production
rollout, actual MPP money or independent provider/semantic-quality proof is claimed.

Adversarial tests cover copied/changed approvals, department/role ceilings,
selected reviewer isolation, viewer/read-key/agent rejection, policy intersections,
revocation/membership/ownership/assignment drift, expiry, closed flags, independent
process races and SIGKILL before/after approval and economic-order commits. Full
migration replay, SDK/type/lint/build and built-app desktop/mobile review are
required before the publishing counter advances. Private providers and bounded
spending service accounts remain subsequent P2.2 capabilities.
