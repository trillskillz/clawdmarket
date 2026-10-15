# Next dependency: independently reviewed marketplace listing purchasing

The requirements below remain the full acceptance scope. Reviewed task purchasing
is accepted locally and the intervening dependable-product/pilot candidate is
preserved at `bee652c`. A separate integrated review-only listing foundation now
supports proposal/inspection/decision/revocation, with no checkout or payment
authority and no 8/10 increment. See the
[current foundation record](ORGANIZATION_LISTING_REVIEW_DRAFT_CHECKPOINT.md).
All work and evidence remain local under the current publication policy.

The next first scope is one current public fixed-price marketplace listing,
quantity one, one exact reviewed purchase and one original external marketplace
trade, over Ethereum L1 or configured Tempo/pathUSD. The actual listing schema
has seller, category, title, description, USD price and status; it has no service
execution contract, output schema, provider dispatch lease or accepted task bid.
Do not represent this purchase as a reusable service, workflow child or task.
Contract escrow is a different obligation and follows separately.

## Existing boundaries

`POST /api/trades` resolves the authenticated buyer, original client reference,
public seller visibility and current active listing. The supported quantity is
one; partial fills are rejected. The server derives the price and platform fee,
selects an operational rail and atomically changes the listing to sold, creates
the trade and records organization attribution. Existing exact-reference replay
can recover that trade. The reviewed path must additionally compare the frozen
listing fields and approved payment terms inside the transaction, rather than
inherit a quote calculated from an earlier read.

`originalPrivateServiceListing` and `originalReviewedTaskListing` already prevent
original private-service and reviewed-task synthetic listings from being adopted
through ordinary marketplace checkout. Preserve those exclusions at proposal,
review, reservation and payment. A bounties category by itself is not evidence of
task authority. Listing approval cannot grant service, private share, task,
workflow or contract access.

Current buyer EVM/Tempo worker claims require an original route funding step,
spending-account use or separately versioned task use. A plain listing trade has
none of them. Add distinct listing claims and derive their payment scope from
the original listing authority/use; never fabricate a route, service order,
workflow run or task workspace. The existing external intents, proofs, escrow,
payout/refund outboxes and reconciliation remain authoritative.

Plain listing delivery uses `submitTradeDelivery` with the original seller,
encrypted delivery, artifacts and content hash. Its default verification is
buyer review; no task requirements or service output contract exists. Proposal
must therefore include a separate bounded agreed delivery contract, freeze it in
the authority and enforce it through original trade delivery. The reviewed buyer
must accept the exact delivery hash explicitly; inherited ordinary auto-confirm
timers cannot release an independently reviewed purchase. Use a distinct finite
seller client over original trade delivery, with persisted original output and
attachment references across restart. A listing is not a leased provider job.

Unpaid ordinary listing cancellation can return a listing to active. Reviewed
listing recovery must keep its original trade and original signed-byte identity.
Do not replace that trade, recycle its historical exposure or allow ordinary
checkout to adopt its frozen obligation after cancellation. Decide how one
reviewed companion blocks its original buyer's generic purchase before implementing
the schema. Pending review must not reserve a public listing against unrelated
buyers. Another buyer can still claim the ordinary active listing, after which
reviewed checkout fails on current availability. Once a reviewed use consumes
the listing, keep original-use exclusion after cancellation; owner/reviewer
revocation must not erase a potentially late payment.

## Authority and exposure

Freeze current organization owner, assigned organization buyer agent and resolved
account, original department/cost center, selected independent current reviewer,
public seller and exact listing identity/content/price/category, delivery contract,
fee-inclusive USD total, approval expiry, payment rail/chain/token/payer/treasury,
token metadata and reserve floors. Keep native L1 wei distinct from Tempo pathUSD
base units, with separate per-payment and lifetime fee ceilings. Require fresh
review for changed terms; exact proposal, decision and checkout references recover
their original result after an uncertain response.

The internal listing-use validator must join the original grant, listing, trade
and immutable organization attribution and reject orphaned or substituted uses.
It must exclude service/spending/task/workflow identity collisions and retain
the original historical price, buyer, seller, fees and chain units after revocation
or subsequent editable listing changes. Current eligibility is a separate check
at fresh checkout, intent, claim and actual send.

Join validated listing uses into all existing reviewed route/workflow/task gross
and same-currency fee checks once. Add their original contributions to organization
and buyer budgets without duplicating the existing trade attribution. A refund
does not replenish original gross or fee history. Share the original wallet claim
and consumed-nonce exclusions across route, spending-account, task and listing
claims in both directions. Read, direct-service, task and workflow credentials
cannot become listing spending authority.

## Complete outcome required for the next capability

Demonstrate actual original L1 and Tempo payment, separate buyer/seller process
restarts, explicit accepted delivery and confirmed payout, plus exact revoked
late-payment refunds. Race generic and reviewed listing reservation; prove price,
seller, owner, reviewer, department, gross, same-currency fees and shared-wallet
changes fail closed. Test genuine before/after-commit process deaths and lost
proposal/decision/checkout responses in both SDKs without replacement identities.

Verify private owner/reviewer desktop/mobile review and original buyer/seller
delivery privacy; ordinary listing/task/service/workflow regressions; additive
migration/replay with original row preservation, ten immutable reputation guards
and five actual evidence queries; complete enabled security/economic checks,
SDK parity, types, lint, production build and browser journeys. Schema, endpoint,
dependency audit or passing mock payment alone does not increment acceptance.

## Contract purchasing remains separate

`POST /api/contracts` currently creates a deposited-account-credit DRAFT and
milestones. Funding in `PATCH /api/contracts/{id}` locks the original backed credit
through `lockContractFunds`; milestone approval/payment and refunds use the
contract credit ledger, not marketplace trades or external trade intents. The
newer credit path cannot authorize funding from legacy unbacked wallet balances.

Before any later reviewed contract capability, audit original contract and
milestone hashes, deposited-credit authority, organization/department attribution,
aggregate milestone/fee exposure, submission privacy and buyer acceptance,
maintenance auto-release, disputes and original refund recovery. Do not route
contract funding through listing/task claims or claim L1/Tempo contract support
from the marketplace's rails. Contract creation also lacks the listing proposal's
original-reference recovery contract; solve that explicitly in its own scope.

## Concrete first implementation boundaries

Use a separate `listing-authorizations` organization resource with proposal,
original-reference lookup, private inspection, independent approval, revocation,
buyer checkout and checkout recovery. Proposed authority names are
`organization_listing_v1` (L1) and `organization_listing_v2` (Tempo); these names
are design decisions, not advertised current operations. Keep the existing
`payments:write` credential requirement and an internally validated original
listing scope. The owner/reviewer inspection DTO and buyer payment DTO have
different recipients; the owner cannot use private review access to spend as
the assigned buyer.

The frozen listing projection includes its ID, seller, category, title,
description and original USD price. Record `status` separately as eligibility:
fresh proposal/reservation requires active, while fresh payment for an original
reviewed pending trade requires its exact sold listing. Changing the listing
to expired or back to active cannot authorize a replacement reviewed trade.
Original financial recovery validates the historical frozen projection and
original use rather than requiring current listing text, owner or eligibility.

Agree a bounded delivery contract at proposal, using the existing parsed
text/JSON, required-key, declared-source and explicit acceptance primitives.
Freeze those requirements privately in the grant/use and enforce them in the
actual original trade delivery and confirmation path. Do not pretend that the
ordinary public listing already advertises a service output schema or semantic
verification policy. Declared source URLs are not fetched or independently
verified. Preserve normal private artifact ownership, hash, retention, review
and dispute rights.

Allow one active companion review per original buyer/listing pair and one consumed
original listing use. Proposed review takes no funds and grants no inventory hold.
Generic reservation must inspect a companion belonging to that authenticated
buyer and any consumed original use in its existing financial transaction; a
preflight-only guard does not establish atomic exclusion. Proposal must check
for an already committed listing trade and fail instead of adopting it. If
revoked before consumption, a later separately reviewed grant may be proposed;
if consumed, retain original-trade exclusion and historical spend forever.
A companion cannot let its buyer escape independent review by revoking it and
using generic checkout; a new reviewed proposal remains available before
consumption. These are the first finite scope's rules, not a relisting/inventory
feature. Unrelated buyers retain ordinary public availability while a review is
pending, and their original commitments can make that review no longer executable.

The review/inventory acceptance matrix must distinguish those principals:

| Concurrent requests | Required outcome |
| --- | --- |
| Original buyer generic checkout versus that buyer's review proposal | Exactly one commits; a committed review prevents that buyer's generic checkout. |
| Unrelated buyer generic checkout after a pending review | Ordinary purchase can commit; the pending review provides no public inventory hold. |
| Original reviewed checkout versus unrelated ordinary checkout | Exactly one original marketplace trade commits through listing availability; the losing operation creates no use. |
| Two different buyers' pending review proposals | Both can exist privately; neither consumes inventory or funds. |
| Any generic checkout after original reviewed use and cancellation | No replacement trade may adopt the consumed reviewed listing. |

Tests must inspect the actual listing/trade/use rows, not equate two simultaneous
pending reviews with two financial commitments. Bound proposal rates and expiry,
but do not use those operational limits as a substitute for the inventory rule.

The additive storage needs a separate immutable-scope grant and original-use
ledger, plus original EVM claim, Tempo intent and Tempo claim tables. Original
use binds the authority hash, original checkout request hash/reference, trade,
listing, reviewed buyer/seller, amount and maximum fee/chain/currency. Use unique
listing/trade references to prevent duplicate obligations; retain the same wallet
and nonce exclusions across all claim families. None of these tables should
backfill authority into a historical listing or existing financial transaction.

Before counting acceptance, add a genuine separate-process matrix across each
existing reviewed family: listing versus task, standalone route and workflow;
both L1 and Tempo; gross and same-currency fee ceilings; both reservation orders
and actual simultaneous requests. After cancellation, the original losing
request must still be denied with no second trade or replenished allowance.
Corrupt/orphan original uses must fail closed in every family's exposure reader.
Retain ordinary catalog visibility while keeping grant, private requirements,
delivery, payer, decision references and historical payment claims private.
