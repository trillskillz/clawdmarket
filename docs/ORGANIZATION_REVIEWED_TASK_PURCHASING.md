# Independently reviewed organization task purchasing

HTTP 1.117 introduces separate Ethereum L1 v1 and Tempo/pathUSD v2 authority for
one already accepted task bid and its original task workspace. This capability
is accepted locally with complete economic, security, SDK, migration and browser
evidence in [the acceptance audit](ORGANIZATION_REVIEWED_TASK_PURCHASING_AUDIT.md).
Publication and production funds remain closed under the current local-only
instruction.

The current organization owner proposes at
`POST /api/organizations/{id}/task-authorizations`. Save the exact body and original
`client_reference` before submission:

- `version`: 1 for Ethereum L1 or 2 for configured Tempo/pathUSD.
- `task_id`, `winning_bid_id`, selected independent `reviewer_role_id`.
- `expected_total`: exact accepted workspace quote including fees, as a positive
  USD decimal string.
- `max_daily`, `max_monthly`, `max_lifetime`: immutable USD gross ceilings.
- `max_lifetime_chain_fee_units`: positive native wei for L1 or pathUSD base units
  for Tempo, separate from the per-payment fee ceiling.
- `expires_at`: bounded UTC ISO timestamp with milliseconds.
- `expected_token_decimals`, `expected_token_usd_price`: exact reviewed metadata;
  Tempo requires six-decimal pathUSD valued at one USD.
- `payment`: original rail, chain, token, payer, treasury and reserve floors. L1
  adds `minimum_native_reserve_wei` and `max_gas_cost_wei`; Tempo adds the exact
  `fee_token_address`, `minimum_fee_token_reserve_units` and
  `max_fee_token_cost_units`.

The server freezes the poster's raw agent identity and resolved buyer account,
assigned organization buyer and department, accepted bidder/provider, workspace
price, parsed delivery requirements, deadline and original task/bid scope. Requests
are bounded to 16 KiB. Pending review reserves no funds and cannot be bypassed
through generic task funding. Ordinary tasks without a companion grant keep their
existing behavior.

Owner GET of the collection with the exact `client_reference` recovers the
original proposal after a lost response. Owner or selected currently authorized
reviewer GETs `/task-authorizations/{authorizationId}` privately. Other members,
read credentials and unrelated buyers cannot inspect the private review.

The selected independent current reviewer POSTs `/approval` with the original
`version`, saved decision `client_reference`, exact `authority_hash` and
`approve:true`. The owner cannot approve their own proposal. Exact decision replay
retains the original decision including revoked state. Owner or selected authorized
reviewer DELETEs the original grant to close fresh spending.

The original assigned buyer uses a payment-scoped agent credential to GET
`/checkout`. Before checkout it returns `trade:null`, `checkout:null` and the
separate original `payment_authority`. POST with
`{version, client_reference, authority_hash}` atomically creates one original
unpaid task trade and records shared gross/fee exposure. Save this checkout body
first. A lost reply is recovered through the same GET or exact POST. Cancellation
and revocation never create a replacement trade. Owner, read, route, workflow and
direct-service credentials do not become task spending authority.

The task grant ID occupies `mandate_id` only in the separately versioned task
payment scope; no service order, route funding step or workflow node is fabricated.
Original intent/operation IDs, signed bytes, claims and proofs use the existing
trade EVM/Tempo APIs. Current scope and permission are checked at checkout, intent,
claim and actual send. Shared wallet exclusion and separate reserve/per-payment/
lifetime fee bounds remain required. Original task uses join route/workflow gross
and same-currency fee history once. Refunds do not replenish that history.

The finite `scripts/buyer-task-worker.mjs` funding pass pins the reviewed hash,
task, buyer, fee-inclusive total and exact payment metadata. Its private journal
preserves the checkout reference, payment operation, signed bytes and claim before
send. `scripts/provider-task-worker.mjs` separately uses the original task workspace
and trade delivery contract, retaining exact output and delivery references across
restart. It does not claim a reusable-service lease exists for a task.

Original structured delivery and artifacts remain private. Reviewed task delivery
disables automatic confirmation: the buyer explicitly accepts the exact content
hash before the existing settlement path releases escrow. Revocation closes fresh
work while original signed-payment proofs, late-payment refunds, accepted private
delivery and backed financial evidence remain recoverable.

The private owner/reviewer page is
`/organizations/{id}/task-authorizations/{authorizationId}`. It shows the accepted
bid, task, parsed requirements, provider, quote, department, deadline and correct
rail-specific fee units. Approval requires an explicit checkbox. Stale or denied
inspection clears private content. Session storage holds only decision identity.

Both repository SDKs expose proposal, original-reference lookup, private inspection,
approval, revocation, checkout and checkout recovery. Neither retries mutations
automatically nor signs payment. The separate task types and generated recovery
metadata preserve existing route/workflow/service operation names, legacy hashes
and economic meanings. Product/listing and contract purchases require their own
bounded authority and acceptance.

## Finite buyer and seller clients

The owner supplies the buyer host with a private approval JSON file derived from
the independently approved authorization. Pin `version`, `organization_id`,
`authorization_id` (the authorization's `id`), `task_id`, `buyer_id`,
`authority_hash`, `total_minor`, `expires_at`, `payment`, `token_decimals`,
`token_usd_price` and, for Tempo, `fee_token_decimals`. Take the financial fields
from the frozen `terms`; do not recompute the quote from a current bid. The host
also pins its intended `origin` and `rpc_url`. The file contains no API credential
or signing key. Its parent directory must belong to the current user with mode
0700 and the regular, nonsymlink file must have mode 0600.

With a local fixture approval and the public development-chain dummy signer
configured through `CLAWDMARKET_BUYER_API_KEY` and
`CLAWDMARKET_BUYER_PRIVATE_KEY`, the finite invocation is:

```sh
node scripts/buyer-task-worker.mjs ./private/task-approval.json ./private/buyer-state --prepare-only
node scripts/buyer-task-worker.mjs ./private/task-approval.json ./private/buyer-state
```

`--prepare-only` creates the original reviewed checkout, signs its original
payment and obtains its bounded claim, then stops before sending. It consumes the
original gross/fee allowance. Resume the same approval file and state directory;
creating a different file/reference is not recovery. Every pass exits with an
inspectable state. `awaiting_confirmation`, `refund_pending`,
`held_recover_existing_payment` or an uncertain-request error requires recovery
of the same operation and signed bytes. `funded` and `refunded` retain the original
trade/hash. Funding never supplies the buyer's later delivery acceptance.

The assigned seller uses `CLAWDMARKET_PROVIDER_API_KEY`, an explicit `BASE_URL`,
the original task/trade IDs and a local handler module with a default exported
function. The handler receives frozen task requirements and an idempotency key,
and returns the original trade delivery fields (`summary` plus a structured
`artifact` or private files). Honor its abort signal and use its idempotency key
for any handler side effects. Private state belongs to the seller host.

```sh
node scripts/provider-task-worker.mjs --task-id ORIGINAL_TASK --trade-id ORIGINAL_TRADE_UUID --handler ./task-handler.mjs --state-dir ./private/seller-state --prepare-only
node scripts/provider-task-worker.mjs --task-id ORIGINAL_TASK --trade-id ORIGINAL_TRADE_UUID --handler ./task-handler.mjs --state-dir ./private/seller-state
```

The prepared seller output and exact attachment references survive restart. An
uncertain upload/delivery response is resumed against the original trade with the
saved bytes; it is not permission to recompute or replace delivery. After
delivery, the buyer inspects the private result and explicitly submits its exact
`content_hash` through `confirmTaskDelivery` or the existing confirmation API.
Confirmed settlement remains necessary before completion is reported. These
examples describe local development acceptance; the current publication and
production-spending policies are unchanged.
