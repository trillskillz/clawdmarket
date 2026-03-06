# Race Condition Audit — ClawdMarket

_Date: 2026-03-05_

## Scope

Audited async marketplace transaction flows for:

1. simultaneous claims on the same listing
2. payment/status ordering hazards
3. non-atomic DB writes
4. in-memory state risks in multi-instance deployment

Primary files reviewed:
- `app/api/trades/route.ts`
- `app/api/trades/[id]/route.ts`
- `app/api/listings/route.ts`
- `lib/rate-limit.ts`

---

## Findings and Fixes

## RC-1 — Double-claim race on listing purchase (FIXED)

### Scenario
Two buyers submit `POST /api/trades` near-simultaneously for the same active listing.

### Risk
Both requests could pass pre-check (`listing.status === 'active'`) before either updates listing status, creating duplicate trades.

### Potential outcome
- Duplicate trades for one listing
- inconsistent seller/buyer expectations
- financial reconciliation complexity

### Fix applied
In `app/api/trades/route.ts`, changed listing claim to atomic conditional update inside transaction:

- `UPDATE listings SET status='sold' WHERE id=? AND status='active' RETURNING ...`
- if no row returned → throw `LISTING_ALREADY_CLAIMED` and return `409`

Applied to both on-chain and ledger settlement paths.

---

## RC-2 — Buyer balance race at commit time (FIXED)

### Scenario
Buyer balance validated before transaction. Another request could spend funds before commit.

### Risk
Overspend or invalid escrow lock assumptions under concurrent trade creation.

### Potential outcome
- negative or inconsistent buyer balance outcomes
- escrow lock with stale pre-check assumptions

### Fix applied
In ledger path transaction, replaced unconditional wallet debit with atomic conditional update:

- `UPDATE wallets ... WHERE user_id=? AND balance >= totalCost RETURNING ...`
- if no row returned → `INSUFFICIENT_FUNDS_AT_COMMIT` (`402`)

This enforces sufficiency at commit point.

---

## RC-3 — Non-unique provisional transaction reference rewrite (FIXED)

### Scenario
Ledger path previously wrote transactions with temporary `reference_id = listing_id` and later bulk-updated to `trade.id`.

### Risk
Under race/retry patterns, broad update by listing reference could touch unintended rows.

### Potential outcome
- transaction-to-trade linkage corruption
- audit trail ambiguity

### Fix applied
Reordered transaction flow:
1. atomically claim listing
2. create trade first
3. write escrow/fee transactions directly with `reference_id = trade.id`

Removed bulk `reference_id` rewrite step.

---

## RC-4 — Trade completion double-release race (FIXED)

### Scenario
Two parties (or retried requests) call `PATCH /api/trades/:id` to mark same pending trade completed.

### Risk
Both flows could pass stale `pending` pre-check and execute release side effects twice.

### Potential outcome
- duplicate escrow release records
- inflated seller balance

### Fix applied
In `app/api/trades/[id]/route.ts`, made status transition atomic:

- `UPDATE trades ... WHERE id=? AND status='pending' RETURNING ...`
- if no row returned → `TRADE_ALREADY_UPDATED` (`409`)

Ensures one successful state transition.

---

## Multi-instance / in-memory state audit

## RC-5 — In-memory rate limiter store (OPEN)

### Scenario
`lib/rate-limit.ts` uses process-local memory store.

### Risk
In multi-instance deployments, limits can be bypassed by request distribution across instances.

### Outcome
Not fixed in this patch (outside race-critical DB transaction scope), but should be migrated to shared backend (Redis/Turso table) for strict cluster-wide enforcement.

### Recommended remediation
- replace in-memory map with Redis token-bucket/sliding-window implementation
- preserve existing response headers + `Retry-After`

---

## Tests Added

### `tests/race/race-condition.test.ts`

Covers:
- reproducing old listing-claim race behavior
- verifying atomic claim semantics allow exactly one winner
- reproducing old completion race behavior (double release)
- verifying atomic status update allows single completion/release

Run:

```bash
npx tsx --test tests/race/race-condition.test.ts
```

---

## Summary

### Fixed
- listing claim race
- commit-time balance race
- broad transaction reference rewrite hazard
- trade completion double-release race

### Still open
- in-memory rate-limit state is not multi-instance safe

Overall readiness after fixes: **improved significantly for transactional integrity under concurrency**, with rate-limit backend migration still recommended before scale-out.
