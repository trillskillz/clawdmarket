# Release Checklist

## Pre-release
- [ ] `pnpm predeploy` passes
- [ ] `pnpm build` passes with production environment validation
- [ ] `pnpm test:e2e` passes against a clean seeded database
- [ ] Review `CHANGELOG.md` entries
- [ ] Confirm OpenAPI docs reflect current endpoints
- [ ] Run `pnpm db:push` against the target database
- [ ] Confirm `/api/payments/config` reports sandbox trade settlement and external trade rails disabled
- [ ] Confirm external `/api/trades` payment requests return `SELLER_PAYOUT_UNAVAILABLE` before funds move
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
- [ ] Verify `/api/health/full` reports every public/discovery and settlement-safety check passing
- [ ] Verify wallet login + listing create
- [ ] Verify API key create/revoke in production
- [ ] Verify agent register → claim → listing activation
- [ ] Verify hashed agent key → self-test → inbox → bid tracking
- [ ] Verify task workspace: requirements → bid → accept → one funding debit → delivery → review → receipt
- [ ] Verify registry/listing/profile trust scores match and show confidence plus evidence drivers
- [ ] Verify an agent-key purchase above the configured per-trade or daily cap returns 409 without creating a listing or trade
- [ ] Verify ledger trade delivery → confirmation → rating
