# Implementation handoff — September 16, 2026

This follows [the site audit](SITE_AUDIT_AND_EXECUTION_PLAN_2026-09-16.md). It records the first implementation package, not a declaration that real-money settlement has been validated. The audit evidence remains at `/home/void/Work/reports/clawdmarket-audit-2026-09-16/` on the original machine.

## Changes in this package

- EVM checkout now creates one buyer-owned, server-persisted payment intent before a transfer. Only the response with `created: true` permits a send. The payer signs a message binding the exact trade, intent, token, amount, recipient, origin, and transaction hash; the verifier checks that signature, sender, time, transfer log, amount, confirmations, and global proof uniqueness. `GET /api/trades/:id/fund/evm/intent` supports recovery. The explicit wallet-rejection path releases only an unsent reservation.
- Marketplace, task workspace, and dashboard use one recoverable EVM checkout component. The transaction hash is saved locally immediately; retries verify the same hash. Unknown wallet outcomes fail closed and require transaction-history recovery instead of another broadcast. Closed/late payments are shown as refund states, not funded work. The payment canary follows the new protocol and no longer modifies a seller payout address; it requires a dedicated seller with one already configured.
- Trade and task funding reject idempotency-key reuse with a different rail or amount. Expired unawarded tasks are not offered as open work, including in pending actions and counts. Synthetic open-task fallbacks were removed, and task API failures return 503.
- Public proof pages distinguish recorded historical completions from linked delivery/payment/payout evidence. Rating and completion trust aggregates require linked work evidence rather than cached historic totals. The homepage illustration is labeled as an example. API examples use the current site's origin.
- The marketplace hire dialog now traps and restores keyboard focus, supports Escape, and exposes the fee estimate before payment.

## Verification completed locally

- `pnpm predeploy`: passed (typecheck, lint, 135 passed unit tests, one Base Sepolia integration test skipped for missing test credentials).
- `pnpm build`: passed on local Node 26 with the pre-existing Node-24 engine and MPP dependency warnings.
- `pnpm test:e2e`: 31 browser/API journeys passed, including wallet sign-in and MetaMask EIP-6963 provider selection. These tests use a mocked wallet/provider and isolated/no-value payment fixtures; they are **not** a real MetaMask or live-money canary.
- Runtime migration idempotency is tested against a temporary legacy database. The local `local.db` was forward-migrated so its browser-wallet tests could run; no production database was touched during local verification.

## Deployment and operational gates

Before release, use the protected-branch PR checks and confirm that the additive `evm_payment_intents` migration runs before the new build is aliased. Record the exact merged commit, deployment run, and post-deploy readiness. Older open browser tabs may have sent a transfer without an intent; those users must reload and recover the existing hash through the new checkout or contact support, never pay again.

Do not characterize green CI as proof that payments work end to end. Still needed: a dedicated, funded low-value canary buyer/seller, a normal pay→deliver→seller-payout canary and a late-refund canary for each enabled rail, balance/receipt reconciliation, signer gas funding and rotation procedure, an operator pause that preserves refund/recovery, an isolated backup restore, owner-approved policies and provider/legal review, and isolated load testing. Do not run the production canary until its configured seller payout wallet and buyer/treasury balances have been verified; the audit's prior green canary run was preflight only.

The remaining product plan is in the audit. In particular, seller publication/capacity, unified work navigation, password recovery, availability onboarding, contrast/typography, and durable webhook delivery are not implemented by this package.
