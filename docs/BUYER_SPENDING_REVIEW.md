# Buyer-host original approval review

HTTP 1.106 adds `scripts/buyer-spending-review.mjs` to prepare an approval file for the [existing funding worker](BUYER_SPENDING_WORKER.md). It inspects one already reserved, human-approved service order with its own version-2 Ethereum L1/Sepolia or version-3 Tempo grant. The original scoped GET now includes that grant's private owner DTO. The scoped key cannot inspect another grant or organization.

On the buyer host, save this request as mode 0600 in a mode 0700 directory:

```json
{
  "version": 1,
  "origin": "https://clawdmkt.com",
  "organization_id": "<original organization UUID>",
  "order_id": "<original reserved order UUID>",
  "rpc_url": "<caller-selected HTTPS or loopback RPC>"
}
```

URLs must use HTTPS or an HTTP loopback host, without embedded credentials, query strings or fragments. The application origin cannot contain an extra path; the RPC may contain a path. Supply the distinct `CLAWDMARKET_SPENDING_API_KEY` through the host environment. Then run:

```sh
node scripts/buyer-spending-review.mjs review PRIVATE/request.json PRIVATE/review.json
```

Read `review.json`. Check the original organization, account, buyer, service, private share, order, trade and human approval; gross purchase amount and grant ceilings; frozen chain, payer, token, treasury, token precision/price, reserves and per-payment/lifetime fee bounds; grant expiry and department; and the RPC you selected. The review copies only these facts. It excludes credentials, order input, transaction bytes and payment operations. Its SHA-256 detects accidental edits; it is not a signature or proof that the host is trustworthy.

After reviewing those facts, explicitly confirm:

```sh
node scripts/buyer-spending-review.mjs confirm PRIVATE/review.json PRIVATE/approval.json
```

Confirmation reinspects the same original reservation with the same scoped key and requires exact agreement with the saved review. Changed, revoked, expired, unavailable or funded scope cannot create a new approval file. Both commands perform only the original private GET. Neither creates a checkout, intent or signature, contacts the RPC, or submits a payment. Keys and financial facts are omitted from command output.

Output files are immutable, mode 0600, inside a caller-owned mode 0700 directory. Creation uses a synced temporary file and an atomic no-overwrite link. Repeating an identical command returns `created: false`; conflicting output or unsafe existing files are refused. Preserve the original review and approval. A changed RPC or different purchase needs a separately reviewed file and a different output path.

The approval is directly consumable by the existing worker:

```sh
node scripts/buyer-spending-worker.mjs PRIVATE/approval.json PRIVATE/payment-state --prepare-only
node scripts/buyer-spending-worker.mjs PRIVATE/approval.json PRIVATE/payment-state
```

Only that funding step requires the buyer-host private key and existing spending authorization. Use the same persistent wallet state directory for every payment client sharing the payer. After uncertainty, resume that original approval and state rather than generating another payment. If the delegated key closes after signing, the worker's existing original-buyer intent/hash recovery remains available; the review tool does not use a broader recovery credential. Buyer acceptance and provider payout remain separate.

These commands are accepted with disposable local chains. Production enterprise activation, live wallet spending and production Tempo compatibility retain their separate gates.
