# Buyer payment mandates (local contract 1.69; funding worker in progress)

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

## Exact EVM transaction claim (worker integration in progress)

`POST /api/trades/{id}/fund/evm/claim` requires buyer identity, `payments:write` on named keys, cookie CSRF where applicable, and a strict bounded body: `{intent_id, mandate_id, serialized_transaction, payer_signature}`. The attribution signature uses the existing immutable intent's `evmPaymentProofMessage(intent, keccak256(serialized_transaction))`. It binds the same hash for later proof recovery; it does not itself send funds.

Before calling this endpoint, the buyer worker must fsync the exact signed bytes to private shared wallet state. The claim independently recovers the signer and verifies chain, nonce, token, treasury, zero native value, exact canonical ERC-20 transfer and amount. Only legacy/EIP-1559 transactions are supported. Its maximum execution gas cost must fit the mandate. The claim and the intent hash/signature commit atomically. Raw signed bytes and attribution signatures are omitted from the claim response; the endpoint never broadcasts.

A database uniqueness guard permits one unconfirmed claim per chain/payer across routes and prevents a nonce from belonging to another intent. Current authority, checkout expiry, service/buyer/deployment/organization eligibility and the payment pause are checked before `send_allowed: true`. Exact replay allows only the identical transaction. After revocation, expiry or funding, an existing claim returns recovery state with `send_allowed: false`. Cancellation and timeouts retain the wallet hold. Only matching verified receipt persistence changes the claim to `confirmed`; the original nonce remains permanently bound. A claim whose signed bytes are lost requires recovery, never a replacement transfer. The SDK exposes `claimBuyerEvmPayment` without any signing/broadcast action.

Migration 38 adds these private claims. Operator diagnostics include aggregate pending claims and claim/intent/receipt mismatches; mismatches fail the release preflight. No wallet/account/hash appears in those aggregate diagnostics.

`lib/buyer-signed-transaction.mjs` also checks reserve floors including outstanding uncertain authorizations. `scripts/buyer-payment-journal.mjs` provides bounded, owner-only, symlink-resistant reads and fsync/atomic replacement with directory sync. These are building blocks, not a runnable automatic funding worker. Its caller must hold a shared kernel wallet lock, validate journal scope, estimate all fees and recover exact bytes. On Base/OP, execution gas bidding does not cap data/operator fees; a preflight estimate cannot guarantee an immutable all-fee ceiling.

## Remaining acceptance work

The server/SDK authority and persistence boundary is implemented and locally tested. The buyer-operated worker still needs to integrate the reserve/journal/claim building blocks, enforce a shared kernel wallet lock, handle full fee preflight, persist MPP credentials before submission, and prove uncertain-submission recovery using the original proof. EVM and MPP adapters must use existing intent/proof/receipt APIs and remain outside the application host. Tests must prove the complete authorized funding transition through worker restarts without a second payment.

This checkpoint does not complete P0.5 or increment the ten-part publishing counter. No real wallet access, spending, deploy or GitHub push is authorized by this implementation. The paid production canary/global rollout remains deferred under the user's no-spending instruction.
