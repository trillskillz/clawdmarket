# Buyer-host enterprise payment recovery

`node scripts/buyer-spending-worker.mjs APPROVAL.json PRIVATE_STATE_DIRECTORY [--prepare-only]` funds one already reserved and exactly human-approved organization service order. It supports reviewed version-2 Ethereum L1/Sepolia and version-3 Tempo grants under HTTP 1.101. It creates no checkout or approval, accepts no delivery, signs no payout, and performs no top-up. Provider work and explicit original buyer acceptance remain separate.

Create the immutable approval file on the buyer host after reviewing the owner's original grant and approved reservation. Keep it mode 0600 inside a mode 0700 directory. Required fields are:

```json
{
  "version": 1,
  "origin": "https://clawdmkt.com",
  "organization_id": "<original organization UUID>",
  "account_id": "<original spending-account UUID>",
  "authority_hash": "<original gross use authority_hash>",
  "grant_version": 3,
  "buyer_id": "user_agent_<original assigned buyer>",
  "order_id": "<original order UUID>",
  "trade_id": "<original trade UUID>",
  "service_id": "<approved service UUID>",
  "purchasing_approval_id": "<exact human approval UUID>",
  "payment": { "rail": "mpp", "chain_id": 4217 },
  "token_decimals": 6,
  "token_usd_price": 1,
  "total_cost": "1.05",
  "max_purchase": "1.05",
  "rpc_url": "<reviewed HTTPS or loopback RPC>"
}
```

The illustrative `payment` object must contain every original reviewed grant field, including fixed payer/token/treasury, reserve floors and per-payment/lifetime fee bounds. Copy its actual private owner DTO without changing terms; see the [L1](ORGANIZATION_EXTERNAL_SPENDING.md) or [Tempo](ORGANIZATION_TEMPO_SPENDING.md) grant guide. Obtain the original `authority_hash` from the scoped order GET's `use` or current owner history. UUID placeholders above are not executable credentials. Exact cents, origin, order/service/approval/account IDs, authority hash, buyer, rail and token precision/price are pinned before signing.

Supply `CLAWDMARKET_SPENDING_API_KEY` with the distinct `cmos_` key and `CLAWDMARKET_BUYER_PRIVATE_KEY` only on the buyer host. Optionally supply the original buyer's payment credential in `CLAWDMARKET_BUYER_API_KEY` for recovery after delegated-key revocation/expiry. No key enters the approval file, journal, arguments or output. Application code receives only signed bytes/proof, never a buyer private key. Do not run against live wallets without their separate spending authorization.

Use one persistent private state directory for every client sharing a payer, including existing route/workflow clients. The Linux kernel wallet lock excludes competing processes and releases after process death. A durable active-wallet reference prevents another original payment while recovery is unresolved. The client fsyncs and atomically replaces its journal before intent creation, claim and external submission. Preserve that directory and approval file across retries; a timeout or stale credential never authorizes a new nonce, new operation or regenerated signed payment.

`--prepare-only` saves the original intent, canonical signed bytes, attribution signature or exact MPP credential and hash without claim/submission. The normal command rechecks the server's original intent and exact claim, chain/balance/reserves, and current delegated send permission. EVM submits exact buyer-host bytes; Tempo submits the exact credential through the guarded SDK endpoint. Lost intent, claim, SDK or RPC responses require rerunning the same approval and state directory. Current server authority always restricts submission.

After a delegated key closes, a saved signed payment and original buyer credential permit read-only original intent/hash recovery through existing buyer APIs. The client uses that ordinary credential only for GET intent and POST original hash proof; it cannot use it to create a new intent, claim or broadcast. Never substitute another account's key. Closed authority preserves original obligations and the existing refund outbox. `awaiting_confirmation`, `held_recover_existing_payment` and `refund_pending` retain unresolved state; a refund is complete only with authoritative confirmation. `funded` confirms payment into escrow, not delivery quality or seller payout.

The API and payment state machines are unchanged. Production activation, independent provider participation and complete persisted Tempo fee observations retain their separate gates. Acceptance evidence is recorded in the routing master plan.
