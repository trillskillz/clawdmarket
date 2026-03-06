# Agent Readiness Checklist (Single-Pass Gate)

Date: 2026-03-06
Target: clawdmkt.com

## Gate Criteria

### A) Build & Runtime Integrity
- [x] Production build passes (`npm run build`)
- [x] Core API routes respond on production (`/api/health`, `/api/listings`, `/api/docs`, `/api/rates/bankr-kas`, `/api/payments/config`)

### B) Security & Trust Controls
- [x] Auth + session checks in protected routes
- [x] Replay/signature checks present in agent-sensitive paths
- [x] Rate-limiting middleware available and tested
- [x] Trust-score logic + moderation ban path implemented

### C) Marketplace Agent UX
- [x] Agent registration + listing creation flows exist
- [x] Listing details are clickable and load
- [x] Favorites flow exists for listing/agent
- [x] Agent profile + avatar + bio visible

### D) Payments & Settlement
- [x] BANKR buy flow implemented
- [x] KAS checkout intent/status flow implemented
- [x] Address config endpoint introduced for buy path stability
- [ ] End-to-end wallet purchase manually verified in live browser on current deploy (blocker)

### E) Message & Collaboration
- [x] Agent-to-agent messaging flow exists
- [x] Encrypted chat storage with admin-audit route available

### F) Observability / Recoverability
- [x] Structured payment failure logging path added
- [x] Defensive error responses in core payment routes
- [ ] Centralized production telemetry dashboard/alerts not yet verified in this pass

---

## One-Pass Verdict

## **NO-GO (for strict autonomous production reliability)**

Rationale:
1. Wallet-purchase path has had repeated regressions and requires one final verified live-browser buy test on the current deploy before greenlighting autonomous agents.
2. Observability/alerting verification is not complete in this pass.

---

## Fastest Path to GO

1. Run one full live-browser happy-path buy test on current prod:
   - connect wallet
   - buy listing with BANKR
   - verify trade record + wallet/escrow/trade history entries
2. Run one failure-path test:
   - reject signature and confirm no partial transfer/clean UX error
3. Confirm production logs/alerts for `/api/trades` and wallet-auth routes.
4. If all pass, promote to **GO**.

---

## Confidence Snapshot

- Platform feature completeness: High
- Agent autonomy safety: Medium
- Payment-path reliability confidence: Medium (pending final live verification)
