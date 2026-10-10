# Reviewed external service purchasing — local HTTP 1.100

Version-2 organization spending accounts add separately reviewed Ethereum L1
(chain 1) and Sepolia (11155111) service payments. Version-1 credit accounts
retain their exact original fingerprint and deposited-credit scope. `cmo_`
read keys remain read-only. Migration 61 adds two default-preserving account
columns and a separate external transaction claim table; it does not rewrite
existing grants, orders, receipts or route claims. Production writes remain closed.

The current owner uses the existing private, CSRF-protected spending-account
management API with `version: 2` and all version-1 buyer, department, cost-center,
service/share, gross USD ceiling and expiry fields. A mandatory `payment` freezes
`rail: evm`, `chain_id`, `token_address`, `payer_address`, `treasury_address`,
`minimum_token_reserve_units`, `minimum_native_reserve_wei`, positive
`max_gas_cost_wei` and `max_lifetime_gas_cost_wei` decimal integer strings.
Configured token decimals and USD price are also frozen. Changing any authority
requires a new reviewed grant; secrets are issued once and HMAC-stored.

Only legacy or EIP-1559 canonical ERC-20 transfers are accepted. Blob, sponsored,
batched and rollup payments are excluded from this version: a supported L1
transaction's signed gas limit times its maximum gas price bounds its native
fee. The lifetime gas allowance reserves that complete per-purchase ceiling
for every original checkout, even if it is cancelled, refunded or never sent.
Gross USD purchase/day/month/lifetime allowances include marketplace fees and
never recycle after refunds. Native gas budgets use wei, separately from USD;
there is no assumed native-token/USD conversion.

## Original payment and recovery

The separate `cmos_` credential consumes an existing exact human approval using
`POST /api/organizations/{id}/spending-accounts/orders`. External grants create
one **unpaid** order; they do not debit credit or broadcast. They cannot approve
requests, accept deliveries, withdraw, top up, buy other product families, or
authenticate through general buyer APIs.

Use the following dedicated endpoints, with the same spending bearer key:

```text
POST /api/organizations/{id}/spending-accounts/orders/{tradeId}/fund/evm/intent
GET  /api/organizations/{id}/spending-accounts/orders/{tradeId}/fund/evm/intent
POST /api/organizations/{id}/spending-accounts/orders/{tradeId}/fund/evm/claim
POST /api/organizations/{id}/spending-accounts/orders/{tradeId}/fund/evm/proof
```

Persist an original `buyer_operation_id` UUID and exact intent request before
calling the intent endpoint. Include the frozen chain/token/payer. An intent
replay never grants send permission. The wallet operator must durably save its
exact signed bytes, hash and attribution signature before claiming. The claim
body uses the existing EVM fields, with `mandate_id` equal to the **original
spending account ID**, plus the original operation. A claim authorizes only
those exact bytes and verifies the fixed payer, transfer, token, treasury,
amount and gas ceiling. It reads the configured chain's current token/native
balances and requires both reserve floors. RPC failure holds fresh permission.
No application server receives wallet private keys or signs transactions.

Only `send_allowed: true` permits those saved bytes. At this boundary owner
control, linked buyer assignment, active department, bans, expiry, revocation,
private provider consent, human approval, all policy ceilings, original gross
usage and gas exposure are checked again. One unresolved wallet claim is
allowed across enterprise EVM, route EVM and route Tempo families. Cancellation,
expiry and network errors never release that hold. Only the original verified
receipt marks it confirmed. Wallet operators must still serialize all their
other wallet activity; an on-chain balance snapshot cannot lock a wallet.

After broadcast uncertainty, inspect the original intent/claim and reconcile
its hash. Never create another operation or transaction. The proof endpoint
reuses the existing ERC-20 verification, escrow, provider dispatch and refund
outboxes. An already-sent payment after authority closes is verified and
refunded through its original outbox; it is not permission for another send.
Revoked/expired keys stop authenticating. The original buyer's existing
payments credential retains intent, claim and proof recovery through the
general trade endpoints, including `send_allowed: false` claim replay.

A funded order retains its original private service/share attribution through
revocation, provider restart, explicit original-buyer review, exactly-once
seller payout and capacity release. Owner inventory distinguishes grant versions
and displays frozen external payment terms without secrets. The current human
grant form creates credit grants; external grants require the explicit API body.
These controlled dummy-chain results do not prove independent production demand,
production execution or any live wallet payment.

## Acceptance

`tests/api/organization-purchasing.test.ts` uses separately owned unforked
loopback Anvil chains for existing Base-shaped credit deposits and actual L1
external purchasing. All keys are public dummy fixtures. The guarded database
is local `/tmp/clawdmarket-workspace-test-*` with an empty Turso authentication
token. Tests check version isolation, immutable replay, wallet/fee terms,
reserves, changed department ceilings, private payout, late full refund,
fee-retaining dispute refund, cross-process gross/gas reservation races and
SIGKILL at original intent/claim/broadcast/verified-receipt boundaries.
The master plan records the final acceptance evidence and publishing counter.

Buyer-host recovery for original approved orders: [BUYER_SPENDING_WORKER.md](BUYER_SPENDING_WORKER.md).

The owner can explicitly review and issue configured L1 grants through the [private spending UI](OWNER_SPENDING_REVIEW.md), retaining the original reviewed reference across lost replies and reload.
