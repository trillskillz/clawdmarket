# Reviewed Tempo service purchasing

Local HTTP contract 1.101 adds explicit version-3 organization spending grants. Apply additive runtime migration 62 before running this code. Version-1 deposited-credit and version-2 Ethereum L1/Sepolia grants keep their original authority and fingerprints. A version-3 grant does not widen either earlier version.

The current linked owner submits the existing private spending-account body with `version: 3`, exact assigned buyer/department/cost center, finite service/share pairs, positive fee-inclusive USD purchase/day/month/lifetime limits and an expiry within 30 days. Its mandatory payment body is:

```json
{
  "rail": "mpp",
  "chain_id": 4217,
  "token_address": "0x20c0000000000000000000000000000000000000",
  "payer_address": "0x1111111111111111111111111111111111111111",
  "treasury_address": "0x2222222222222222222222222222222222222222",
  "minimum_token_reserve_units": "1000000",
  "fee_token_address": "0x20c0000000000000000000000000000000000000",
  "minimum_fee_token_reserve_units": "1000000",
  "max_fee_token_cost_units": "10000",
  "max_lifetime_fee_token_cost_units": "10000"
}
```

Addresses above illustrate the body, not configured production authority. The treasury must equal the configured MPP recipient; payment and fee tokens must be the configured six-decimal pathUSD token. Store the once-issued distinct `cmos_` key privately. Lost key-creation responses require inspecting/revoking the original grant; a secret cannot be reissued. The browser displays the private reviewed terms but its create form continues to create version-1 credit grants.

Each order consumes one exact separately issued human purchasing approval. All ordinary policy, provider/share, department, organization, verification, capacity and deployment checks apply. Reservation atomically records the original gross use and reserves the full per-purchase fee ceiling against lifetime fee authority. Cancellation, completion and refunds never recycle that authority. Principal and worst-case fees spend one shared token balance before both reserve floors are checked.

For the original order, use `/api/organizations/{id}/spending-accounts/orders/{tradeId}/fund/mpp/{action}` with the distinct bearer key:

1. Persist a fresh UUID `buyer_operation_id` on the buyer host. POST `intent` with that field only. GET `intent` privately inspects the original challenge, intent, claim and trade; creating/replaying an intent grants no send permission.
2. On the buyer host, prepare and persist exact unsponsored root-key `0x76` bytes: one memo-bound `transferWithMemo`, fixed token/treasury/payer, ordinary nonce key zero, finite original expiry, fixed fee token and bounded maximum fee. The application never signs the buyer transaction.
3. POST `claim` with `intent_id`, `mandate_id` equal to the original spending-account ID, original operation UUID and `serialized_transaction`. Only `send_allowed: true` authorizes those exact bytes. All route and enterprise claim families share unresolved-wallet and nonce exclusion; a timeout cannot justify a replacement payment.
4. POST `proof` with the exact original credential in `Payment-Authorization`, retaining the spending key in `Authorization`. The real MPP SDK validates and simulates. Its RPC transport rechecks current grant, approval, provider/share, department, payment controls, deadline, chain and reserves immediately before submitting the exact claimed bytes. A permission change stops fresh submission.
5. Preserve the original hash after every uncertain response. For read-only recovery POST `proof` with `{ "tx_hash": "0x…", "payer_address": "0x…" }` and no payment credential. The original claim is mandatory. After key revocation or expiry, the original buyer uses the existing `/api/trades/{id}/fund/mpp` endpoint with ordinary buyer authentication. A valid original payment whose fresh authority closed enters the existing cancellation/full-refund outbox. HTTP 202 indicates confirming/refund processing and does not authorize a new send.

The scoped key cannot authenticate to general buyer APIs, issue approvals, top up, withdraw, accept deliveries or purchase listings/tasks/contracts/routes/workflows. Original provider delivery, explicit buyer acceptance, payout, dispute and refund remain existing state machines. Private service orders remain excluded from public completion proofs.

Acceptance uses the pinned owned disposable Tempo node, public dummy keys and isolated local databases. Real chain balance assertions independently include receipt fees. These observations do not claim that persisted Tempo fee accounting is complete or that production fork compatibility has passed. Production enterprise writes and global routing retain their existing closed gates. See [the acceptance audit](ORGANIZATION_TEMPO_SPENDING_AUDIT.md).

Buyer-host recovery for original approved orders: [BUYER_SPENDING_WORKER.md](BUYER_SPENDING_WORKER.md).

The owner can explicitly review and issue Tempo grants through the [private spending UI](OWNER_SPENDING_REVIEW.md), retaining the original reviewed reference across lost replies and reload.
