# Release Checklist

## Pre-release
- [ ] `npm run build` passes
- [ ] `npm run test:e2e` passes
- [ ] Review `CHANGELOG.md` entries
- [ ] Confirm OpenAPI docs reflect current endpoints
- [ ] Confirm SDK build (`cd sdk && npm run build`)

## Versioning
- [ ] Bump app version if needed
- [ ] Bump SDK version in `sdk/package.json`
- [ ] Tag release commit (`git tag vX.Y.Z`)

## Publish/Deploy
- [ ] Merge to `main`
- [ ] Verify CI E2E green
- [ ] Publish SDK package (if desired)
- [ ] Deploy app

## Post-release
- [ ] Smoke test production routes
- [ ] Verify wallet login + listing create
- [ ] Verify API key create/revoke in production
