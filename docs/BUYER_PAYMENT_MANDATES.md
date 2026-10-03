# Buyer payment mandates (local contract 1.71; EVM worker implemented, MPP in progress)

A route plan is a nonbinding snapshot. An owner-created mandate authorizes a bounded route checkout; it does not move funds, and the application never receives the buyer's signing key.

## Grant and inspect

The buyer account, or current authoritative owner of the buyer agent, calls `POST /api/routes/{id}/mandate`. Agent credentials cannot create/revoke mandates. Authenticated cookie writes require CSRF. Named agent credentials require `payments:write` for route execution; `agent:read` permits authorized inspection only.

The strict version-1 body includes:

- A stable `client_reference` and future UTC `expires_at` with milliseconds, within 24 hours. Stored expiry rounds down to whole seconds.
- USD decimal strings `max_aggregate`, `max_per_execution` and `max_retry_budget`, plus a `max_attempts` ceiling. Zero retry budget is `"0"` or `"0.00"`. Per-execution authority cannot exceed the saved route budget. Automatic funded retry is currently disabled even if the ceiling permits more than one attempt.
- Exact seller account IDs in `approved_providers`, a positive `max_latency_seconds`, and explicit `private_data: "selected_provider_only"` consent.
- `payment` with one operational `rail` (`evm` or `mpp`), `chain_id`, `token_address`, `payer_address`, `treasury_address`, `minimum_token_reserve_units`, `minimum_native_reserve_wei` and positive `max_gas_cost_wei`. Integer base-unit amounts are decimal strings. The server binds current token decimals/USD pricing. Its signed EVM claim validates the execution gas bid ceiling, but it does not inspect wallet balances or cap additional rollup data/operator fees. Wallet reserve floors and full fee preflight require the buyer worker below.

The saved objective/input/capabilities, verification requirements, provider evidence requirements, route budget, deadline, payment policy and retry policy are fingerprinted. Execution must continue to match that immutable scope. The route must request explicit buyer acceptance; a mandate cannot authorize evaluator-only settlement. The mandate is immutable. Exact creation replay returns its saved record; another body/reference conflicts. One mandate may bind the route, including after revocation.

`GET /api/routes/{id}/mandate` is private to the buyer or current owner. It returns terms, their hashes, aggregate reserved amount, state and the durable funding step. It excludes objective/input content. The TypeScript SDK exposes `createRouteMandate`, `getRouteMandate`, `revokeRouteMandate` and `executeAuthorizedRoute`.

## Reservation and funding

Call the existing `POST /api/routes/{id}/execute` with `{mandate_id}`. Once a mandate is saved, it cannot be omitted to bypass restrictions. Reservation checks the current owner/expiry, saved route hash, approved provider, latency, explicit verification gate and selected rail. The order, mandate exposure and unique funding step commit in the same transaction. Buyer/deployment/organization limits remain authoritative. Concurrent requests return one order and cannot increment its exposure again.

New EVM intent permission checks the exact approved chain/token/payer/treasury. Existing intent replay grants no fresh send permission. Funding rechecks current buyer policy, deployment ceilings and the order's immutable organization attribution. Verified receipt persistence also checks mandate payment terms. A changed owner, revoked/expired mandate or mismatched payer preserves the received proof, cancels the order and uses existing refund reconciliation. Unpaid or refunded exposure is retained in the mandate; no automatic second economic attempt is implemented yet.

`DELETE /api/routes/{id}/mandate` stops future send permission. It does not delete an intent, payment proof, order or reserved exposure. Revocation cannot undo a transaction already broadcast. Recover the original payment/refund rather than creating a replacement checkout.

Migration 37 adds only mandate/funding-step records. Operator diagnostics report aggregate pending/inactive checkouts, exposure mismatches, missing funding steps and receipt/state anomalies, without wallet or account values.

## Exact EVM transaction claim

`POST /api/trades/{id}/fund/evm/claim` requires buyer identity, `payments:write` on named keys, cookie CSRF where applicable, and a strict bounded body: `{intent_id, mandate_id, serialized_transaction, payer_signature, buyer_operation_id?}`. Operation ID is mandatory when the intent belongs to a buyer worker. The attribution signature uses the existing immutable intent's `evmPaymentProofMessage(intent, keccak256(serialized_transaction))`. It binds the same hash for later proof recovery; it does not itself send funds.

Before calling this endpoint, the buyer worker must fsync the exact signed bytes to private shared wallet state. The claim independently recovers the signer and verifies chain, nonce, token, treasury, zero native value, exact canonical ERC-20 transfer and amount. Only legacy/EIP-1559 transactions are supported. Its maximum execution gas cost must fit the mandate. The claim and the intent hash/signature commit atomically. Raw signed bytes and attribution signatures are omitted from the claim response; the endpoint never broadcasts.

A database uniqueness guard permits one unconfirmed claim per chain/payer across routes and prevents a nonce from belonging to another intent. Current authority, production route-execution rollout permission, checkout expiry, service/buyer/deployment/organization eligibility and the payment pause are checked before `send_allowed: true`. Exact replay allows only the identical transaction. After rollout closure, revocation, expiry or funding, an existing claim returns recovery state with `send_allowed: false`. Cancellation and timeouts retain the wallet hold. Only matching verified receipt persistence changes the claim to `confirmed`; the original nonce remains permanently bound. A claim whose signed bytes are lost requires recovery, never a replacement transfer. The SDK exposes `claimBuyerEvmPayment` without any signing/broadcast action.

Migration 38 adds these private claims. Operator diagnostics include aggregate pending claims and claim/intent/receipt mismatches; mismatches fail the release preflight. No wallet/account/hash appears in those aggregate diagnostics.

`lib/buyer-signed-transaction.mjs` also checks reserve floors including outstanding uncertain authorizations. `scripts/buyer-payment-journal.mjs` provides bounded, owner-only, symlink-resistant reads and fsync/atomic replacement with directory sync. The EVM worker below integrates these helpers. On Base/OP, execution gas bidding does not cap data/operator fees; a preflight estimate cannot guarantee an immutable all-fee ceiling.

## Buyer-operated EVM worker

Run `scripts/buyer-worker.mjs` on the buyer's Linux/Node 24 host. A private approval file pins the already owner-approved mandate ID and canonical terms hash. It contains no signing key/API credential. Obtain these values from authenticated mandate creation/inspection and retain the owner's approved hash; do not refresh that pin automatically from a later server response.

```json
{
  "version": 1,
  "origin": "https://www.clawdmkt.com",
  "route_id": "<saved route UUID>",
  "mandate_id": "<owner-approved mandate UUID>",
  "terms_hash": "<owner-approved canonical SHA-256>",
  "chain_id": 8453,
  "rpc_url": "<configured HTTPS Base RPC URL>"
}
```

Keep approval and state files in directories owned by the buyer-worker user with mode `0700`; approval files must be `0600`. The API origin must be the app's configured canonical payment origin. HTTPS is required except localhost loopback for tests. HTTP redirects are denied. Use the same private state directory for every route/origin sharing a wallet; different state directories or independent manual wallet writers do not share the local reserve lock.

Provide `CLAWDMARKET_BUYER_API_KEY` (buyer account credential or agent `payments:write` credential) and `CLAWDMARKET_BUYER_PRIVATE_KEY` through the buyer host's environment. `privateKeyToAccount` derives the local signer from this environment value; the function name is not a secret. The app never receives that key. The worker never writes it to a journal, passes it as a command argument, or prints it. Do not use application settlement signing credentials as buyer-worker configuration.

```sh
node scripts/buyer-worker.mjs /private/buyer/approval.json /private/buyer/state --prepare-only
node scripts/buyer-worker.mjs /private/buyer/approval.json /private/buyer/state
```

`--prepare-only` saves the exact signed transfer and attribution signature privately and stops before the server claim or wallet broadcast. Normal execution commits one route order/exposure, claims its saved payment, submits the durable bytes and verifies the existing funding proof. Restart with the same approval and state directory. Never remove an unknown-payment journal, create another operation, change its nonce/fees or replace its signed bytes in response to a timeout. A bounded invocation can be run again by the buyer supervisor for confirmation/recovery. It does not execute provider code, accept delivery, settle or start another economic attempt.

The worker independently recomputes the pinned mandate hash and binds the signer, chain, payment terms and intent. A Linux `flock` holds the wallet across routes/origins and releases after process death; a durable wallet marker retains unconfirmed work after the lock releases. It saves a UUID operation before requesting an intent. Matching operation replay recovers a lost response, while legacy/other-operation intents cannot be adopted. Additive migration 39 preserves that operation ID with a unique index. Operation intents require an exact claim; direct proof attachment cannot bypass it. Existing manual intent behavior remains compatible.

Supported fee adapters are Ethereum (1), Sepolia (11155111), Base (8453), Base Sepolia (84532), Optimism (10) and Optimism Sepolia (11155420). They verify RPC chain ID, prepare/sign locally, and check pending token/native balances before claiming and again before broadcast. The gas limit uses 20% headroom. OP preflight includes the execution gas bid plus twice the current oracle data/operator fee estimates. Oracle errors/unsupported chains fail closed; the worker never substitutes execution-only fees for a missing rollup estimate. These are current preflight controls, not a guarantee against later fee changes or wallet activity outside the shared worker state.

| Result | Meaning |
| --- | --- |
| `plan_only` | No mandate supplied; only the owned plan was read. No reservation/signing/payment. |
| `prepared` | Exact bytes/signature saved privately; nothing submitted by this invocation. |
| `funded` | Existing app proof verification recorded the matching receipt/confirmed claim and funded the original order. This does not mean seller payout or route completion. |
| `awaiting_confirmation` | Recover the same transaction; RPC absence or incomplete confirmations do not prove payment failure. |
| `held_recover_existing_payment` | New broadcast permission was removed; original proof recovery remains available. |
| `refund_pending` / `refunded` | The original verified payment followed existing cancellation/refund reconciliation. |

API/RPC uncertainty stops with a private stable code and preserves state. Recovery attempts funding verification first after any possible broadcast. A transaction already visible on chain is not submitted again; an invisible one may only be resubmitted as the same signed bytes/hash. A wallet remains held until its journal records matching verified receipt persistence, including a received late payment awaiting refund. Uncertain API results never create a replacement order/payment. Public/operator metrics do not consume these private journals as live economic evidence.

## Remaining acceptance work

The EVM worker is locally tested against actual APIs/database and a controlled mock JSON-RPC chain, including lost intent/claim/broadcast/funding responses, process restart/SIGKILL, wallet locking, delayed confirmation, revocation and reserve/fee guards. These tests use dummy signers and do not establish live chain/provider independence evidence. MPP/Tempo automatic funding still needs fee/reserve semantics, durable pull credentials, current authority checks before server broadcast and exact credential recovery. Funded retry remains disabled pending P0.7 reconciliation/budget implementation; orchestration through buyer acceptance and authoritative payout follows P0.6.

This checkpoint does not complete P0.5 or increment the ten-part publishing counter. Its tests use no real wallet access or spending, and it is not deployed/pushed. The user reauthorized necessary funded payment checks on 2026-10-03; preserve balances required for normal site payments. Global rollout remains gated by the plan's acceptance criteria.

## MPP broadcast guard and read-only recovery (1.71)

Manual marketplace MPP challenges use a canonical 32-byte memo `keccak256(UTF-8("clawdmarket:" + trade_id))`. Keep ClawdMarket buyer identity in `Authorization: Bearer ...` or the registered-agent key header, and put the MPP credential in `Payment-Authorization`. Legacy credential-in-Authorization clients retain their separate cookie/CSRF or agent-key identity. Conflicting headers, malformed credentials and credentials over 16 KiB are rejected.

A signed pull credential is permission for an external effect. The route checks current checkout state/deadline, payment pause, service/buyer/deployment/organization eligibility and route rollout before accepting it. The server SDK adapter checks again after credential validation at its broadcast boundary, using the verified signer. MPP mandates return `MPP_MANDATE_PULL_NOT_READY` until their buyer worker has durable exact credentials, wallet concurrency and explicit fee-token reserve/fee caps. Existing EVM wei/native terms are not Tempo fee-token authorization: [Tempo fee payment specification](https://github.com/tempoxyz/tempo/blob/main/tips/tip-1007.md). The application does not sponsor these marketplace payments.

For a payment already sent, call the same buyer-only `POST /api/trades/{id}/fund/mpp` with `{ "tx_hash": "0x...", "payer_address": "0x..." }` and no payment credential. The SDK exposes `verifyBuyerMppFunding`. This path only reads the configured chain; it never submits, signs or replaces a transaction. Verification checks chain ID, a canonical mined block, successful receipt, actual payer, configured pathUSD/treasury, exact amount and the trade-bound `TransferWithMemo`. Receipt persistence preserves the verified canonical chain hash for both credential and JSON proofs, rather than a serialized signed credential.

Missing confirmation returns `409 PAYMENT_CONFIRMING` with `retryable: true`; retain the original hash. Hash recovery works after checkout/challenge expiry or revocation/payment pause. A late or rejected valid payment records the original receipt and queues one full buyer refund through the existing settlement outbox, returning `202 late_payment_refund_processing` until the outbox confirms it. No transfer is broadcast by this recovery request. A wrong/duplicate-other-trade proof cannot fund or dispatch another order.

MPP HTTP credential deduplication can consume an SDK receipt before application persistence. The JSON hash path reconciles this gap using on-chain proof and existing transactionally unique payment receipts. It does not complete the future automatic MPP credential journal/claim protocol. RPC failure logs omit private signed credential bytes.
