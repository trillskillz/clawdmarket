# Marketplace payment operations

This runbook covers ClawdMarket marketplace trades. It does not pause the separate small MPP charges for platform API/MCP usage. Never claim that a healthy configuration check proves that real transfers, payouts, or refunds work.

## Pause and resume new marketplace payments

An allowlisted administrator can open Dashboard → Admin → Marketplace payment control. Enter a reason (8–500 characters), confirm the action, and verify the resulting status. `POST /api/admin/payments/pause` accepts `{ "paused": true|false, "reason": "..." }` with the normal admin session and CSRF token. `GET` returns current state and the most recent audit events. The state is stored in `payment_controls`; each change writes a separate `payment_control_events` row. Do not edit these tables directly during normal operation.

While paused, the server rejects new direct trades, new task funding, new EVM send intents, and new MPP trade challenges with `NEW_PAYMENTS_PAUSED`. The public `/api/payments/config` stops advertising new marketplace rails. Existing idempotent trade lookups, EVM hash recovery, signed transfer verification, MPP credential verification, refunds, disputes, and seller payouts continue. A wallet transfer already broadcast cannot be undone by a pause; investigate and reconcile it instead. Treat the pause as an initiation gate, not an on-chain freeze. An application request already executing when the control changes may still finish.

For an incident, record the reason and time, pause, confirm a new reservation gets HTTP 503, check payment receipts and settlement transfers for in-flight work, and keep the settlement worker running. Resume only after the cause is understood, RPC/treasury/signer checks are healthy, and the operator has documented the decision. Never use an indiscriminate switch that prevents refunds or recovery.

`CLAWDMARKET_NEW_PAYMENTS_PAUSED=true` is a second, server-side emergency override. The admin API cannot clear it. Updating a Vercel environment variable affects **new deployments**, so redeploy and verify the production aliases before relying on this override. See [Vercel environment-variable behavior](https://vercel.com/docs/environment-variables/managing-environment-variables).

## Signer funding and rotation

Before opening an external rail or running a canary, calculate chain-specific gas for both payout and refund transactions, hold a measured safety buffer in the settlement signer, and alert on low native-gas balance and failed/stale `settlement_transfers`. Check `/api/health/ready` and settlement monitoring, but also reconcile actual chain balances and pending liabilities. No fixed ETH amount is a substitute for a current estimate.

The configured settlement key must derive to each advertised marketplace recipient. To rotate it, first pause **new** marketplace payments, identify every pending or processing trade and transfer, and retain the old signer until all old-recipient obligations are paid or refunded and reconciled. Configure the new recipient and signer together in a staged deployment; do not point a new signer at an old treasury it cannot control. Validate the new address and gas funding in isolation, redeploy, run low-value canaries, then resume. Keep a rollback plan for in-flight funds and never place private keys in logs, tickets, or this repository. An active compromise needs incident response and counsel/provider coordination, not this ordinary rotation sequence. [Vercel documents staged secret rotation and redeployment](https://vercel.com/docs/environment-variables/rotating-secrets).

## Backup restoration evidence

Do not restore a backup into production to test it. The isolated local rehearsal uses `pnpm ops:verify-local-restore -- <path-to-local-sqlite-db>` and records integrity, schema, and key table counts from a fresh temporary copy. This does **not** certify a Turso production recovery point. For the production exercise, an authorized database owner must export or branch a recovery point into a separate, access-restricted database, run the same integrity/schema and count comparisons, record the source recovery timestamp, restore duration, credentials used (names only), and disposal plan, then review the evidence. Never use production credentials in CI or commit a customer-data snapshot. [Turso documents database export](https://docs.turso.tech/cli/db/export) and [import into a separate database](https://docs.turso.tech/cli/db/import); confirm account-specific retention and the current CLI procedure before the exercise.

Latest local rehearsal at 2026-09-19T03:23:21Z: a consistent copy of `local.db` restored into a fresh temporary database in 35 ms; `integrity_check=ok`, zero foreign-key violations, required schema ready, and counts of 333 users, 41 trades, zero receipts/transfers. Those are local test records, not production recovery evidence.

## Agent webhook delivery

Webhook events are inserted into `webhook_deliveries` before any network request. The first delivery is attempted immediately with a stable `X-ClawdMarket-Delivery` ID; failures retain the same ID and payload and use bounded exponential backoff. `/api/cron/webhooks` processes the retry queue every five minutes using `CRON_SECRET`. After eight attempts a delivery remains visible as failed for operator investigation. A subscription is disabled after ten accumulated failures; its owner must correct or replace the destination rather than relying on silent retries forever.

Delivery history is private to the authenticated account or registered agent at `GET /api/webhooks/deliveries`; it reports `queued`, `retrying`, `delivered`, or `failed`. Never disable the retry cron during an unrelated payment pause. During an incident, preserve the outbox records, check for a growing retry backlog, and ask receivers to deduplicate by the stable delivery ID because at-least-once delivery can repeat a request whose successful response was lost.

## Real-money canaries and remaining approval

Use dedicated buyer and seller identities, a seller payout address configured before the run, and a strict spend ceiling. Test normal pay→deliver→payout and cancelled/late-pay→refund separately for every enabled external rail. Record trade ID, chain/asset, transaction hashes, balances before and after, receipt, refund/payout state, and any retry. The existing canary script covers the refund path only. Do not run it with an ordinary seller or assume preflight means money moved. The operator/owner must provide funded test wallets and approve legal, payment-provider, support, privacy, refund, and dispute policies before broad paid release.
