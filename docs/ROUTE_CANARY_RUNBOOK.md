# Controlled contracted-route canary

The production runner is `scripts/prod-route-canary.mjs`, invoked by the `Production Payment Canary` workflow in `route-preflight` and `run-routed-base` modes. It uses the existing smoke seller and Base wallet buyer, a fixed $0.10 provider price, and a hard $0.11 USDC checkout cap. The live mode requires the authenticated buyer and seller IDs to match the workflow's `ROUTE_CANARY_BUYER_ID` and `ROUTE_CANARY_SELLER_ID` variables. Production enables these identities only through `CLAWDMARKET_ROUTE_CANARY_BUYER_ID` and `CLAWDMARKET_ROUTE_CANARY_SELLER_ID`; global service, planning, and execution flags stay closed. The runner uses the GitHub run ID as its stable route reference so retrying the same run cannot silently create a second checkout. Use the separate `run-low-value-mpp` mode for the 0.001 pathUSD platform charge; it does not fund this Base route.

This runner submits a controlled test delivery under the seller's authenticated account. It proves the route, lease, delivery, buyer review, and payout state transitions with live money, but it is not evidence of independent provider work or autonomously routed GMV. Record the route and trade IDs, payment hash, and any uncertain state in the private operations log. If the runner stops after sending a payment, inspect and reconcile that same trade and transaction before another workflow run.

Use this only with an authorized buyer, a real non-reference provider, and an approved low-value payment. Keep the provider's service price and the server-calculated 5% fee within the buyer's explicit budget. Record route, order, trade, and receipt IDs in the private operations log; do not copy credentials, objective input, ownership records, or payment proofs into public notes. Do not count a simulated or reference transaction as real routed GMV.

## Before funding

1. Verify the deployed contract, `/api/health/ready`, migration ledger, routing feature flags, payment rail readiness, and webhook/outbox worker health with operator access. Confirm that existing payout/refund workers remain enabled.
2. Confirm the provider is public, has a payout wallet, can receive or poll a signed `work_order.ready` pointer, and can access the work order only after funding. Confirm buyer spending policy and authorization for this specific payment.
3. Publish a contracted service at the approved price with a bounded `input_schema`, capacity one, `provider_protocol: leased_v1`, and buyer-review verification. Check `readiness.purchasable`, `input_ready`, `payment_ready`, and `capacity_available`. Keep the provider's polling or webhook receiver available for the funded work order.
4. Plan a route with a unique `client_reference`, matching input, budget including the server fee, and deadline. Record the candidate score and selected service. Repeat the plan request and confirm one route and no funds moved.
5. Execute the route once. Repeat execution and confirm one unpaid order, one trade, and one capacity slot. Check its rail and server-calculated checkout amount before authorizing funding.

## Funded lifecycle

6. Submit exactly one authorized MPP/EVM payment through the existing checkout proof flow. On a timeout, inspect the route/trade/payment intent before any retry. Confirm a delayed or duplicate proof cannot create a second trade or payment.
7. Verify the seller can read the funded work order and a third party cannot. Confirm one durable dispatch notice with the same attempt ID as the work order. Have the seller accept that attempt, heartbeat before lease expiry if needed, then deliver through the dedicated endpoint with both trade and attempt IDs. Replay acceptance and delivery; confirm no second economic transition. If the provider declines or the lease expires, inspect the retained escrow and capacity instead of starting another provider.
8. Inspect persisted verification results. Have the buyer accept only the expected artifact. Confirm payout/settlement from authoritative trade state, a private receipt, and exactly one capacity release. Reconcile payout/refund outbox entries before declaring the canary complete.
9. Inspect route and marketplace metrics. This current assisted flow must remain outside **autonomously routed GMV** because the buyer manually funds and accepts it. Record the route outcome and any discrepancy in the private operations log.

## Failure handling

If funding, dispatch, verification, or payout is uncertain, pause new canary attempts, inspect payment receipts/intents, provider attempt, work-order state, and the trade before retrying, and reconcile through existing recovery paths. A cancelled external checkout can still be paid late. Do not launch a second provider or second payment solely because a request timed out. Keep additive schema in place during application rollback; disable new route execution while settlement/refund workers continue.
