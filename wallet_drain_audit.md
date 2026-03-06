# Wallet Drain Protection Audit — ClawdMarket

_Date: 2026-03-05_

## Scope

Audited wallet and settlement logic for:
1. reentrancy-style ordering hazards
2. uncapped withdrawal/transfer flows
3. missing balance checks
4. unauthorized withdrawal risk
5. integer overflow/underflow style issues

Primary files:
- `lib/wallet.ts`
- `app/api/trades/route.ts`
- `app/api/trades/[id]/route.ts`
- `src/wallet/baseWallet.ts`

---

## Findings

## WD-1 — Non-atomic balance updates in wallet helpers (FIXED)

### Risk
`transfer`, `escrowLock`, `escrowRelease`, and `escrowRefund` previously performed multi-step writes without a single DB transaction boundary. Under failures/interleaving, partial state could occur.

### Fix
Refactored these functions to use `db.transaction(...)` with conditional updates + return checks.

---

## WD-2 — Uncapped transfer/escrow amounts (FIXED)

### Risk
No explicit safety ceiling existed for a single internal transfer/escrow operation, increasing blast radius for bugs or abused endpoints.

### Fix
Added hard caps in `lib/wallet.ts`:
- `MAX_TRANSFER_AMOUNT = 1_000_000`
- `MAX_ESCROW_AMOUNT = 1_000_000`

Added guard functions:
- `validateTransferAmount`
- `validateEscrowAmount`

These throw deterministic `WalletError` codes for invalid/capped amounts.

---

## WD-3 — Missing commit-time availability checks in wallet helper debit paths (FIXED)

### Risk
Read-then-write patterns can race and overdraw under concurrency.

### Fix
All debit-like operations now use conditional SQL predicates at update time:
- transfer: `(balance - escrow) >= amount`
- escrow lock: `(balance - escrow) >= amount`
- escrow release/refund: `escrow >= amount` and relevant balance constraints

If conditions fail, operation aborts with structured wallet errors.

---

## WD-4 — Unauthorized withdrawal path (NO DIRECT VULN FOUND IN AUDITED PATHS)

### Assessment
No dedicated withdrawal endpoint was found. Mutation endpoints use authenticated actor identity checks and trade-party checks.

Residual note: expanding wallet mutation surface in future should preserve auth + ownership checks.

---

## WD-5 — Integer overflow/underflow concerns (LOW RISK, GUARDED)

### Assessment
Application uses JavaScript numbers + SQL REAL columns (not ideal for financial precision, but not EVM uint overflow context). True integer overflow exploits are not directly applicable here.

### Hardening actions
- added amount caps
- added stricter validation and conditional updates

Recommendation: migrate ledger values to fixed-point integer (e.g., minor units) for precision safety at scale.

---

## Reentrancy note

No on-chain contract code exists in this repository for marketplace ledger logic; classic smart-contract reentrancy does not directly apply.

Equivalent application-level risk (external actions before internal commit) is mitigated by:
- transaction-first state updates
- webhook/event side effects emitted after commit in route handlers

---

## Tests Added

- `tests/wallet/walletDrainGuards.test.ts`
  - verifies transfer cap/validation behavior
  - verifies escrow cap/validation behavior

Run:

```bash
npx tsx --test tests/wallet/walletDrainGuards.test.ts
```

---

## Summary

### Fixed
- atomicity gaps in wallet helper mutations
- missing amount caps for transfer/escrow flows
- commit-time balance/escrow checks hardened

### Remaining improvement
- move from floating-point `REAL` to fixed-point integer representation for financial precision guarantees.
