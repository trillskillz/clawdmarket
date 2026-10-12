# Enterprise service clients — local HTTP 1.105

The repository TypeScript and Python clients expose current-owner grant review
and exact approved service purchasing over existing enterprise endpoints. They
consume generated operation metadata and use their configured origin only.
No schema migration or new purchasing authority is introduced.

Use a current owner account JWT with `inspectSpendingAccounts`,
`createSpendingAccount` and `revokeSpendingAccount` in TypeScript, or their
snake-case names in Python. Save the exact reviewed body and `client_reference`
before creation. Original-reference inspection can find a grant beyond the
bounded inventory. Creation returns `api_key` once; original replay returns
null. Inspection cannot recover the secret. After a lost reply, inspect the
original reference and explicitly replay only the saved body when appropriate.
See [owner review](OWNER_SPENDING_REVIEW.md).

Use a separate client constructed with the distinct `cmos_` key. Call
`organizationSpending(organizationId)` or
`organization_spending(organization_id)` to obtain the restricted surface. It
only exposes exact approved direct service reservation/inspection and original
L1/Tempo payment intent, claim and proof operations. It has no owner, provider,
general buyer acceptance, dispute, routing or wallet commands. Read credentials
cannot create this surface. The server independently verifies current scope,
grant, human approval, service/share, buyer/department limits and reserves.

```ts
const scoped = new ClawdMarketClient({ apiKey: savedSpendingKey, baseUrl: origin })
  .organizationSpending(savedOrganizationId)
const reservation = await scoped.orderService(savedApprovedServiceRequest)
const original = await scoped.getOrder(String(reservation.order.id))
// Persist the operation ID before reserving payment authority.
const intent = await scoped.createTempoPaymentIntent(String(original.trade.id), savedOperation)
```

```python
scoped = ClawdMarketClient(saved_spending_key, origin).organization_spending(saved_org_id)
reservation = scoped.order_service(saved_approved_service_request)
original = scoped.get_order(reservation['order']['id'])
intent = scoped.create_tempo_payment_intent(original['trade']['id'], saved_operation_id)
```

Typed grant inputs distinguish credit version 1, separately reviewed L1 version
2 and Tempo version 3. External terms retain mandatory original gross, reserve,
per-purchase and lifetime fee ceilings. Reviewed metadata fields travel as a
pair; the server checks them before grant insertion. Typed claims require the
original operation and account ID (`mandate_id`) alongside caller-saved signed
bytes. The clients generate no references, challenges, signatures, transaction
bytes, nonces or replacement payments.

L1 methods are `createEvmPaymentIntent`, `getEvmPaymentIntent`,
`claimEvmPayment` and `verifyEvmFunding`; Python uses their snake-case names.
Tempo uses `createTempoPaymentIntent`, `getTempoPaymentIntent`,
`claimTempoPayment` and `verifyTempoFunding`. Python Tempo creation accepts the
saved operation ID directly. Hash proof is read-only verification of the
already sent original payment. Persist and independently review canonical
bytes before claiming. Inspect `send_allowed` without inferring permission
from a read or matching replay. Wallet signing and durable journals remain on
the buyer host; the [buyer spending worker](BUYER_SPENDING_WORKER.md) implements
that workflow.

`submitOriginalTempoCredential` / `submit_original_tempo_credential` explicitly
submits the exact caller-saved original `Payment` header. It preserves account
authentication in `Authorization` and places the credential only in
`Payment-Authorization`, with no JSON body. The server may broadcast the original
claimed bytes through the Tempo SDK after current authority checks. The clients
themselves never sign or call chain RPC. Empty, multiline, non-Payment or
oversized headers fail before HTTP. Keep keys, credentials, exact bytes, private
output and complete error payloads out of logs.

After grant revocation/expiry the scoped client stops authenticating. Use a
separate original buyer client's existing `getBuyerEvmPaymentIntent` /
`getBuyerMppPaymentIntent` and `verifyBuyerEvmFunding` /
`verifyBuyerMppFunding` methods (snake-case in Python). They inspect the original
obligation and reconcile its original hash without authorizing another claim
or payment. HTTP 202 `late_payment_refund_processing` remains unfinished; the
queued trade reports `payout_status: processing` until the original refund
confirms. Transport errors retain unknown funds state. Neither language retries
mutations automatically or turns retryability into replacement permission.

Local acceptance covers real private L1/Tempo service purchases, provider
restart, explicit original buyer review/payout, revocation before original
receipt recovery and confirmed original full refunds in both languages.
Production enablement, independent providers, live funds and broader delegated
product/routed purchases retain their existing gates.

Ordinary owner/reviewer clients also support separately reviewed public-provider
routes through `proposeOrganizationRoute`, `recoverOrganizationRoute`,
`inspectOrganizationRoute`, `approveOrganizationRoute` and `revokeOrganizationRoute`
(Python uses snake_case). Preserve the complete proposal, original reference,
authority hash and decision version. Neither language automatically retries a
mutation. L1 proposals use version 1 and lifetime gas wei; Tempo proposals and
decisions use version 2 and `max_lifetime_fee_token_cost_units`, chain 4217 and
explicit original pathUSD reserve/per-payment fee fields. The underlying mandate
retains version 1. Existing direct-service credentials keep their original scope.
See [reviewed routes](ORGANIZATION_ROUTED_PURCHASING.md) and
[Tempo routing](ORGANIZATION_ROUTED_TEMPO_PLAN.md).
