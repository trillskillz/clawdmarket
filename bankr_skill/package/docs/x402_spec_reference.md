# x402 Spec Reference (ClawdMarket Integration)

_Last updated: 2026-03-05_

This document summarizes the x402 protocol requirements needed to implement BNKR payment rails for ClawdMarket.

## Sources

### Primary protocol sources
- x402 repo: https://github.com/coinbase/x402
- x402 README: https://raw.githubusercontent.com/coinbase/x402/main/README.md
- x402 v2 spec: https://raw.githubusercontent.com/coinbase/x402/main/specs/x402-specification-v2.md
- x402 HTTP transport v2: https://raw.githubusercontent.com/coinbase/x402/main/specs/transports-v2/http.md

### Bankr sources checked
- Bankr site: https://bankr.bot
- Bankr org: https://github.com/bankr-bot
- Bankr trading agent repo: https://github.com/bankr-bot/bankr-trading-agent

> Note: At audit time, publicly accessible Bankr pages did not expose a formal x402 API spec with canonical endpoint contracts. For implementation, we should treat the Coinbase x402 v2 spec as normative and verify any Bankr-specific facilitator URL/auth requirements directly with Bankr team docs/support.

---

## 1) Exact HTTP header format for x402 requests/responses

x402 over HTTP v2 uses **base64-encoded JSON payloads** in headers.

### A. Server → Client (payment challenge)
- **Header:** `PAYMENT-REQUIRED`
- **When:** server returns `402 Payment Required`
- **Value:** base64(JSON `PaymentRequired`)

`PaymentRequired` core shape:
```json
{
  "x402Version": 2,
  "error": "PAYMENT-SIGNATURE header is required",
  "resource": {
    "url": "https://api.example.com/premium-data",
    "description": "Access to premium market data",
    "mimeType": "application/json"
  },
  "accepts": [
    {
      "scheme": "exact",
      "network": "eip155:84532",
      "amount": "10000",
      "asset": "0x...",
      "payTo": "0x...",
      "maxTimeoutSeconds": 60,
      "extra": { "name": "USDC", "version": "2" }
    }
  ],
  "extensions": {}
}
```

### B. Client → Server (payment authorization)
- **Header:** `PAYMENT-SIGNATURE`
- **When:** retrying protected request with payment attached
- **Value:** base64(JSON `PaymentPayload`)

`PaymentPayload` core shape:
```json
{
  "x402Version": 2,
  "resource": { "url": "https://api.example.com/premium-data" },
  "accepted": {
    "scheme": "exact",
    "network": "eip155:84532",
    "amount": "10000",
    "asset": "0x...",
    "payTo": "0x...",
    "maxTimeoutSeconds": 60
  },
  "payload": {
    "signature": "0x...",
    "authorization": {
      "from": "0x...",
      "to": "0x...",
      "value": "10000",
      "validAfter": "1740672089",
      "validBefore": "1740672154",
      "nonce": "0x..."
    }
  },
  "extensions": {}
}
```

### C. Server → Client (settlement result)
- **Header:** `PAYMENT-RESPONSE`
- **When:** successful 200 response (or failed payment response)
- **Value:** base64(JSON `SettlementResponse`)

`SettlementResponse` core shape:
```json
{
  "success": true,
  "transaction": "0x...",
  "network": "eip155:84532",
  "payer": "0x..."
}
```
Failure example:
```json
{
  "success": false,
  "errorReason": "insufficient_funds",
  "transaction": "",
  "network": "eip155:84532",
  "payer": "0x..."
}
```

---

## 2) Agent wallet handshake process

x402 itself does not mandate a branded "Bankr handshake" primitive; the practical handshake is:

1. **Client requests protected resource** (no payment header yet).
2. **Server replies 402 + PAYMENT-REQUIRED** containing acceptable payment requirements.
3. **Agent wallet selects one `accepts[]` option** (scheme/network/asset/amount/payTo).
4. **Wallet signs authorization payload** (exact EVM commonly uses EIP-3009 transfer-with-authorization + EIP-712 signature fields).
5. **Client retries original request with PAYMENT-SIGNATURE header** carrying base64 `PaymentPayload`.
6. **Server verifies (locally or via facilitator `/verify`)**.
7. **Server settles (directly or via facilitator `/settle`)** and returns data + PAYMENT-RESPONSE.

Operationally for ClawdMarket:
- Treat **wallet signature + nonce + validity window** as handshake proof.
- Enforce replay resistance by nonce tracking / one-time authorization semantics.

---

## 3) Payment verification flow (receiver confirmation)

Per x402 facilitator interface:

### Endpoint
- `POST /verify`

### Request
```json
{
  "x402Version": 2,
  "paymentPayload": { "...PaymentPayload...": "..." },
  "paymentRequirements": { "...PaymentRequirements...": "..." }
}
```

### Expected response
- Valid:
```json
{ "isValid": true, "payer": "0x..." }
```
- Invalid:
```json
{ "isValid": false, "invalidReason": "insufficient_funds", "payer": "0x..." }
```

### Receiver-side checks to enforce
- `x402Version === 2`
- `accepted` exactly matches one advertised requirement (amount, network, asset, payTo)
- signature is valid
- authorization window currently valid (`validAfter <= now <= validBefore`)
- nonce not replayed
- payer has capacity/funds per scheme rules

---

## 4) Settlement confirmation format

### Endpoint
- `POST /settle`

### Request
- Same structure as `/verify` request.

### Response (canonical)
```json
{
  "success": true,
  "payer": "0x...",
  "transaction": "0x...",
  "network": "eip155:8453"
}
```

Failure:
```json
{
  "success": false,
  "errorReason": "insufficient_funds",
  "payer": "0x...",
  "transaction": "",
  "network": "eip155:8453"
}
```

### HTTP transport mapping
- Success: typically `200`
- Payment failure / required: typically `402`
- Invalid payload: `400`
- Internal failures: `500`

---

## 5) Required token standards / chain requirements

From x402 v2 + exact EVM scheme notes:
- Network identifier format: **CAIP-2**, e.g. `eip155:8453` (Base mainnet), `eip155:84532` (Base Sepolia).
- EVM exact flow expects token/payment scheme compatibility with authorization semantics used by facilitator implementation (commonly EIP-3009 style for exact EVM in x402 refs).
- Token support is facilitator-dependent.

Known network examples from spec `/supported` examples include:
- `eip155:8453` (Base mainnet)
- `eip155:84532` (Base Sepolia)
- plus other EVM/Solana networks

### Bankr-specific BNKR requirements
- Public docs retrieved did **not** provide a canonical BNKR x402 contract/address table in machine-readable spec form.
- Therefore, treat BNKR contract address and required facilitator endpoints as **deployment configuration values** to be sourced from Bankr’s official developer docs/support channel before production rollout.

---

## 6) Error codes and meaning

Standard x402 error codes (spec section "Error Handling"):

- `insufficient_funds` — payer balance/allowance cannot satisfy payment
- `invalid_exact_evm_payload_authorization_valid_after` — auth not active yet
- `invalid_exact_evm_payload_authorization_valid_before` — auth expired
- `invalid_exact_evm_payload_authorization_value_mismatch` — amount mismatch
- `invalid_exact_evm_payload_signature` — invalid signer/signature
- `invalid_exact_evm_payload_recipient_mismatch` — recipient mismatch
- `invalid_network` — unsupported chain/network
- `invalid_payload` — malformed payment payload
- `invalid_payment_requirements` — malformed requirements object
- `invalid_scheme` — unsupported/unknown scheme identifier
- `unsupported_scheme` — facilitator does not implement requested scheme
- `invalid_x402_version` — unsupported protocol version
- `invalid_transaction_state` — chain transaction rejected/failed
- `unexpected_verify_error` — unhandled verify failure
- `unexpected_settle_error` — unhandled settle failure

---

## 7) Practical implementation guidance for ClawdMarket

1. Normalize all x402 data to v2 schema before processing.
2. Parse base64 headers defensively and reject malformed JSON with structured errors.
3. Validate `accepted` against originally-issued requirements (strict equality on key payment fields).
4. Use facilitator `/verify` then `/settle`; do not treat verification as settlement.
5. Return structured internal errors that map to x402 error semantics.
6. Store anti-replay evidence (nonce/tx reference) in idempotency store.
7. Keep chain/token config externalized:
   - facilitator base URL
   - supported CAIP-2 networks
   - BNKR token contract (per-network)
   - receiver address (`payTo`)

---

## 8) Open questions requiring Bankr confirmation

Before production go-live, confirm with Bankr:
- official facilitator base URL(s)
- auth method for facilitator APIs (if any)
- canonical BNKR contract addresses per network
- required finality depth / confirmation policy
- any Bankr-specific extensions in `extensions` field
- rate limits and quota/error semantics beyond x402 core spec

If Bankr publishes docs later, update this file and pin exact URLs + version/date.
