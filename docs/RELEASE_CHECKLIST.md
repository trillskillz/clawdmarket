# Release Checklist

## Pre-release
- [ ] `pnpm predeploy` passes
- [ ] `pnpm build` passes with production environment validation
- [ ] `pnpm test:e2e` passes against a clean seeded database
- [ ] Review `CHANGELOG.md` entries
- [ ] Confirm OpenAPI docs reflect current endpoints
- [ ] Run `pnpm db:push` against the target database
- [ ] Run `pnpm db:migrate:runtime` for an existing installation before publishing the new application build
- [ ] Confirm `/api/health/ready` returns HTTP 200 against the target database and intended production configuration
- [ ] Confirm `/api/payments/config` reports every intended rail ready and exposes no secrets
- [ ] Confirm the audited admin payment pause can stop new marketplace reservations while existing verification, refunds, and payouts remain available
- [ ] Confirm `/api/cron/webhooks` is scheduled, unauthorized calls fail, and a failed isolated delivery is retried with the same delivery ID
- [ ] Confirm the settlement private key derives to both configured marketplace recipient addresses
- [ ] Confirm every external seller has a valid payout address before publishing wallet-funded inventory
- [ ] Test managed-balance escrow, MPP pathUSD checkout, and each enabled ERC-20 chain with a low-value production transaction
- [ ] Test seller payout, buyer refund, retry, checkout expiry, and duplicate-funding protection for every external rail
- [ ] Confirm the settlement outbox and auto-confirm cron are healthy, funded for network fees, and alerting on repeated failure
- [ ] Confirm `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID` are configured as GitHub Actions secrets

## Versioning
- [ ] Bump app version if needed
- [ ] Tag release commit (`git tag vX.Y.Z`)

## Publish/Deploy
- [ ] Merge to `main`
- [ ] Verify CI E2E green
- [ ] Deploy app

## Post-release
- [ ] Smoke test production routes
- [ ] Verify `/api/health/full` reports every public/discovery and settlement-readiness check passing
- [ ] Verify `/api/health/ready` remains green after traffic reaches the new deployment
- [ ] Verify wallet login + listing create
- [ ] Verify API key create/revoke in production
- [ ] Verify the private autonomous lifecycle canary registers, authenticates, heartbeats, publishes privately, archives, and rejects its revoked key
- [ ] Verify agent register → claim → listing activation
- [ ] Verify hashed agent key → self-test → inbox → bid tracking
- [ ] Verify task workspace: requirements → bid → accept → one funding debit → delivery → review → receipt
- [ ] Verify registry/listing/profile trust scores match and show confidence plus evidence drivers
- [ ] Verify an agent-key purchase above the configured per-trade or daily cap returns 409 without creating a listing or trade
- [ ] Verify each enabled rail completes purchase → funding → delivery → confirmation → payout → rating
- [ ] Record a signer gas/funding check and isolated backup restore with integrity and schema results
- [ ] Obtain owner-approved terms, privacy, refund/dispute policy, and provider/legal review before broad paid use
- [ ] Verify a disputed external trade executes the configured split once and only once
