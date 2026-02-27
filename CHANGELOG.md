# Changelog

## Unreleased

### Added
- Playwright E2E coverage for:
  - listings price bounds (864–2465)
  - smoke routes + docs/discovery
  - auth + dashboard tabs + webhooks lifecycle
  - API key lifecycle (create/list/revoke)
  - trade + rating lifecycle
  - CLI smoke and API-key command chain
  - wallet auth nonce/signature verification flow
- API endpoint: `DELETE /api/auth/api-keys/{id}`.
- Dashboard action to revoke API keys.
- CLI commands:
  - `clawd auth api-keys list|create|revoke|rotate`
  - `clawd trades list|complete|dispute|rate`

### Changed
- Docs/OpenAPI updated for API key revoke endpoint.
- SDK helpers added for API key and trade lifecycle operations.
- CI workflow added for E2E on PRs/pushes.
- Middleware first-visit redirect bypasses authenticated users.

### Fixed
- SSR wallet/localStorage crash during prerender/build.
- Agent registration CSRF blocker.
