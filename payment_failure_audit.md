# Payment Failure Handling Audit — ClawdMarket

_Date: 2026-03-05_

## Scope

Audited payment-related paths for three required guarantees:

1. Failed transactions are logged with context
2. Post-failure fund state is explicit (refund / escrow held / no funds moved)
3. Caller receives structured error JSON

Reviewed paths:
- `POST /api/trades` (`app/api/trades/route.ts`)
- `PATCH /api/trades/:id` (`app/api/trades/[id]/route.ts`)
- shared helper: `lib/payment-failure.ts`

---

## Findings before changes

1. **Inconsistent error response shape**
   - Mixed `{ error, code }` and generic `{ error }` responses.
   - Not guaranteed to be machine-friendly across all failure branches.

2. **Failure logging was incomplete**
   - Some errors only logged to console.
   - Missing consistent structured context (buyer/seller/amount/token/error/timestamp/state).

3. **Fund-state ambiguity in some failures**
   - Several failure branches didn’t explicitly state whether funds moved, were held, or refunded.

---

## Fixes applied

## 1) Added shared payment failure helper

File: `lib/payment-failure.ts`

Added:
- `paymentError(error_code, message, extra?)` → standardized JSON error shape:
  - `{ success: false, error_code, message, ...extra }`
- `logPaymentFailure(context)` → persists structured failure events to `analytics_events` (`event_type=payment_failure`)
- `resolveFailureState(...)` → deterministic fund-state classification helper

Context logged includes:
- buyer_id
- seller_id (when available)
- amount
- token
- route
- trade/listing ids
- error code/message
- state (`refunded | escrow_held | no_funds_moved`)
- timestamp

---

## 2) Hardened POST /api/trades failures

File: `app/api/trades/route.ts`

Updated branches:
- listing missing
- listing not active
- insufficient funds
- race/atomic claim errors (`LISTING_ALREADY_CLAIMED`, `INSUFFICIENT_FUNDS_AT_COMMIT`)
- internal error catch

For each branch:
- logs structured `payment_failure`
- returns structured error payload with `success: false`, `error_code`, `message`
- marks state as `no_funds_moved` where no debit/escrow was finalized

---

## 3) Hardened PATCH /api/trades/:id failures

File: `app/api/trades/[id]/route.ts`

Updated branches:
- atomic transition conflict (`TRADE_ALREADY_UPDATED`)
- internal error catch

For each branch:
- logs structured `payment_failure`
- returns structured error payload
- uses `escrow_held` state for update-time failures involving pending trade settlement/dispute context

---

## Tests added

File: `tests/payments/paymentFailureHandling.test.ts`

Covers:
- structured `paymentError` contract
- deterministic `resolveFailureState` behavior

Run:

```bash
npx tsx --test tests/payments/paymentFailureHandling.test.ts
```

---

## Path-by-path status

| Path | Logging | Fund state explicit | Structured error |
|---|---|---|---|
| `POST /api/trades` (pre-commit failures) | ✅ | ✅ (`no_funds_moved`) | ✅ |
| `POST /api/trades` (race conflicts) | ✅ | ✅ (`no_funds_moved`) | ✅ |
| `PATCH /api/trades/:id` atomic conflict | ✅ | ✅ (`escrow_held`) | ✅ |
| `PATCH /api/trades/:id` internal failure | ✅ | ✅ (`escrow_held`) | ✅ |

---

## Notes / remaining work

- Current failure logging stores events in `analytics_events`; for high-volume production deployments, consider a dedicated immutable payment-failure table.
- Refund flow is still policy-driven (disputed trades are escrow-held, not auto-refunded). This is explicit in state and responses, avoiding ambiguous outcomes.
