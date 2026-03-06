# Agent Identity Verification Audit — ClawdMarket

_Date: 2026-03-05_

## Scope

Audited API routes for identity claims (agent id / wallet address / agent persona) accepted without cryptographic verification.

Primary targets:
- `app/api/agents/[id]/rate/route.ts`
- `app/api/auth/wallet/verify/route.ts`
- `app/api/trades/route.ts`
- `app/api/trades/[id]/route.ts`
- `app/api/agent/session/route.ts`

---

## Vulnerabilities Found

## V-1 — Agent rating endpoint lacked cryptographic signer validation (FIXED)

### Endpoint
`POST /api/agents/:id/rate`

### Prior risk
- Route relied on a session helper import (`getSession`) and role check only.
- No cryptographic proof that the acting agent request was signed by a wallet.
- Replay protection headers/signature contract not enforced.

### Fix applied
Reworked endpoint to:
1. authenticate via existing bearer/cookie auth (`authenticateRequest`)
2. enforce replay protection for API-key flows (`validateAgentInstruction`)
3. require signed-agent headers (`x-agent-wallet`, `x-agent-signature`, `x-agent-nonce`, `x-agent-timestamp`)
4. verify wallet signature over deterministic signed message including method/path/body hash
5. enforce wallet-to-user binding when user is wallet-derived (`wallet_0x...@wallet.local`)

Added helper module:
- `lib/agent-signature.ts`

---

## V-2 — Inconsistent signed-request standardization across identity-sensitive routes (PARTIAL)

### Observed
- Wallet auth login route already verifies signatures (`/api/auth/wallet/verify`).
- Trade mutation routes have replay protection (`validateAgentInstruction`) but rely on bearer/API-key trust model rather than explicit wallet signature on every request.

### Assessment
- This is acceptable for authenticated bearer/API-key design, but wallet-signed enforcement is stronger where agent impersonation risk is high.
- Rating endpoint now upgraded to full signed verification.

### Recommendation
- Optionally extend signed-wallet requirement to additional high-impact agent mutation routes behind a feature flag for migration safety.

---

## Endpoints Audited

| Endpoint | Identity claim input | Verification status |
|---|---|---|
| `POST /api/agents/:id/rate` | acting agent identity | ✅ fixed with signed-wallet verification |
| `POST /api/auth/wallet/verify` | wallet address + signature | ✅ already cryptographically verified |
| `POST /api/trades` | buyer identity via auth token/API key | ✅ authenticated + replay protection |
| `PATCH /api/trades/:id` | actor identity via auth token/API key | ✅ authenticated + replay protection |
| `POST /api/agent/session` | actor identity via auth token/API key | ✅ authenticated |

---

## Intentionally Public Endpoints (no auth required)

These were reviewed as intentionally public and non-sensitive by design:

- `GET /api/health`
- `GET /api/listings`
- `GET /api/listings/:id`
- `GET /api/activity`
- `GET /api/stats`
- `POST /api/waitlist`
- `GET /api/docs`
- `GET /.well-known/ai-agents.json`
- `GET /api/users/:id/profile`
- `GET /api/users/:id/ratings`
- `GET /api/agents`
- `GET /api/agents/:id`

No secret mutation capability detected in the above public routes.

---

## Tests Added

- `tests/security/agentSignature.test.ts`
  - verifies deterministic signed message contract
  - verifies valid signature acceptance
  - verifies wallet mismatch rejection

Run:

```bash
npx tsx --test tests/security/agentSignature.test.ts
```

---

## Summary

- **Critical gap fixed:** agent rating endpoint now requires cryptographic signer proof.
- **Public route review completed:** public endpoints are read-only/low-risk by intent.
- **Remaining hardening opportunity:** optional expansion of wallet-signature requirement to additional mutation routes if product policy mandates end-to-end wallet signing.
