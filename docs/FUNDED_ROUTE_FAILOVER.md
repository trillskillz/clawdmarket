# Funded route failover (local contract 1.76)

The buyer route worker can move from a failed provider to a saved approved fallback after the existing trade refund/resolution is authoritative. The original objective, input, requested capabilities, verification policy, approved providers, terms hash, payment rail and wallet reserves remain pinned. Provider code stays on the provider host. Production proof and global rollout remain deferred; the new capability is local.

## Approve retry before the first checkout

Create the plan with `retry_policy.max_attempts` between one and three and an appropriate `deadline_seconds`. The plan ceiling includes saved candidate checks. The owner mandate separately limits economic orders with `max_attempts`, grants a positive `max_retry_budget`, and sets `max_aggregate` to cover every fee-inclusive checkout. Both ceilings apply. At one attempt or zero retry budget, the worker keeps the single-provider behavior.

Gross exposure never decreases after a refund: the original checkout plus all fallback checkouts must fit `max_aggregate`; all fallback checkouts must fit `max_retry_budget`. Per-execution limits apply to each checkout. The existing buyer/agent/organization budgets and service approvals are rechecked transactionally. Current buyer retry policy and the saved objective deadline are checked again before fresh funding permission. Wallet token and gas/fee reserves remain enforced by the existing buyer adapters.

## Reconcile the failed provider

Observe the original trade/provider attempt. Provider decline, lease expiry, acknowledgment timeout, verification failure or an overdue deadline cannot alone release escrow or authorize fallback. Use the existing buyer dispute and authorized resolution/refund paths. This router cannot invent a refund or resolve a dispute.

Supported reconciliation requires:

- Exact original verified funding for the saved rail, chain, token, payer and checkout amount.
- A terminal full-buyer resolution or a cancelled payment with a confirmed original refund.
- Exact refund asset, chain, original payer destination, treasury source, amount and confirmed transaction hash.
- Recorded release of the original capacity slot and no seller-payout instruction, including a failed or pending instruction.
- Every earlier economic attempt reconciled, plus no remaining uncertain wallet claim.

An existing full-buyer dispute resolution refunds the seller principal and retains the existing platform fee. Cancelled late-payment reconciliation refunds the full verified checkout. Those distributions are preserved and all original amounts still consume the gross mandate limits. Split or seller resolutions do not qualify. Missing receipt, unpaid cancellation, HTTP timeout, pending refund or a status flag without proof fails closed. The current implementation supports confirmed refund reconciliation; it does not allocate a second outstanding reserve or infer payment absence from chain lookup.

## Run and recover

Repeat the normal command:

```sh
node scripts/buyer-route-worker.mjs private-approval.json private-shared-state
```

A shared Linux kernel route lock protects the journal from competing buyer processes. After a qualifying refund, the worker saves a retry operation UUID and archives the original trade/decision before reserving or signing. The next funding worker has a separate durable journal tied to that operation and original previous trade; every old journal/hash stays intact. Unknown responses and SIGKILL resume the same operation/order/intent/signed transaction. A previous decision cannot accept the fallback delivery. Review and explicitly accept the new current delivery hash.

Buyer-only `GET /api/routes/{id}/retry` inspects original financial reconciliation. `POST` requires `payments:write` on named agent credentials, buyer identity and cookie CSRF, with this strict body:

```json
{
  "version": 1,
  "mandate_id": "<original approved mandate UUID>",
  "previous_trade_id": "<failed original trade UUID>",
  "retry_operation_id": "<saved stable UUID>"
}
```

A replay returns that operation's original checkout. Another concurrent operation cannot create a second fallback. Reservation rechecks all prior refunds, current linkage, capacity, full capability and verification requirements, price, policy, mandate expiry/ownership, gross budgets and remaining objective deadline inside the economic transaction. Prior economic sellers are excluded. Only the original saved candidate set may be used. The deadline begins at original verified funding and does not restart when another provider is funded.

Migration 43 adds retry funding records without rebuilding or deleting the original one-step table. Buyer-only attempt inspection and final backed receipts link each economic order, mandate step, intent, funding receipt, refund/payout, capacity release and failure category. Receipt pricing includes the gross total across attempts. Operator audits inspect aggregate exposure, payment claims, retry proof/link anomalies and the original deadline; private payment values never leave diagnostics.

Local contract 1.78 adds [routing admission and monitoring](ROUTING_ADMISSION_CONTROL.md). New routed reservations and send authority can return `ROUTE_EXECUTION_PAUSED`; resume the same route/operation after health recovery. Existing original-payment proofs, delivery review and settlement remain available.
