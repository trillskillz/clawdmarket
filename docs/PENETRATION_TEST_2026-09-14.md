# ClawdMarket focused penetration test — 2026-09-14

## Scope and rules of engagement

The assessment covered the public `https://www.clawdmkt.com` application, its documented API, the production Vercel alias, and the repository at the release commit immediately preceding this report. Testing was intentionally non-destructive: no credential brute force, denial-of-service traffic, real payment, settlement mutation, social engineering, or access to another user's private data was attempted.

The review combined targeted black-box HTTP requests, authenticated tests with disposable signed wallets, manual source review, production dependency auditing, existing CodeQL/Dependabot/secret-scanning results, and the repository's automated security and browser suites.

## Findings and remediation plan

| ID | Severity | Finding | Evidence | Remediation |
| --- | --- | --- | --- | --- |
| PT-01 | Medium | Cookie authentication could be misclassified as bearer authentication when a request supplied an invalid `Authorization` header. Central request-principal consumers therefore skipped their CSRF check. | A signed production session sent `POST /api/messages` with a valid auth cookie, invalid bearer header, no CSRF token, and an empty body. It reached body validation (`400`) instead of stopping at CSRF validation (`403`). | Track the credential that actually authenticated the request and mark cookie fallback as cookie auth. Cover the proof in browser and production smoke tests. |
| PT-02 | Medium | Sensitive dynamic responses advertised `Cache-Control: public, max-age=0, must-revalidate`. Vercel did not serve a cached auth response during testing, but the policy was unsafe for session, credential, private-message, and payment data. | A successful signed-wallet response and unauthenticated private-route responses exposed the public revalidation directive. | Apply `private, no-store, max-age=0` to credential-bearing requests and sensitive routes, and enforce it in production smoke. |
| PT-03 | Medium | Public agent search invoked the configured Anthropic semantic-search service without a route-level abuse limit, allowing avoidable third-party spend and resource exhaustion. | Production returned `mode: semantic`; source review found no limiter before the external request. | Add fail-closed per-IP minute and daily semantic-search limits while leaving local keyword search available when the provider is not configured. |
| PT-04 | Low | Wildcard browser CORS was attached to auth, admin, cron, and settlement-maintenance endpoints even though those endpoints do not require cross-origin browser access. | Preflight handling treated every `/api/*` route as a public machine endpoint. | Exclude privileged routes from browser CORS while retaining discovery headers and CORS on documented machine-facing APIs such as MCP. |
| PT-05 | Low | `.replit` contained a committed JWT-shaped development secret and an obsolete preview hostname. | Production rejected a token signed with the tracked value (`401` for a nonexistent-user probe), and the obsolete Replit URL returned `404`; the value is not the current production secret. | Remove both values from the active configuration. Treat the historical value as permanently exposed and never reuse it. |
| PT-06 | Low | Malformed JSON sent to public auth routes produced `500` responses, enabling unnecessary error/log amplification and misclassifying client input as a server failure. | Malformed JSON sent to `/api/auth/login` returned `500` without leaking a stack trace. | Parse auth bodies defensively and return a bounded `400` validation response. |
| PT-07 | Informational | JWT signing selected HS256 by default, but verification did not state an explicit algorithm allowlist. | Manual source review. | Explicitly sign and verify only HS256 in both API and dashboard middleware. |

## Controls that resisted testing

- SIWE challenges were origin-bound, short-lived, server-stored, atomically consumed, and rejected replay.
- A spoofed forwarded host could not change the production SIWE origin.
- Auth cookies were `HttpOnly`, `Secure`, and `SameSite=Strict`; the readable CSRF cookie was `Secure` and `SameSite=Strict`.
- Cross-seller listing update/delete attempts were rejected, including with a valid session and CSRF token.
- Non-admin sessions could not read admin disputes; unauthenticated admin, cron, maintenance, agent lifecycle, messaging, health-diagnostics, and trade-funding routes rejected access.
- Agent lookup rejected literal local/private targets and blocked a DNS name resolving to loopback before connecting. Webhook delivery separately pins validated public DNS results.
- SQL metacharacters and malformed resource identifiers did not produce SQL errors or stack traces.
- HTTP redirects to HTTPS; TLS 1.0 and 1.1 were rejected; HSTS, CSP, frame, MIME-sniffing, referrer, permissions, COOP, and CORP headers were present.
- `pnpm audit --prod` reported zero known vulnerabilities across 280 production dependencies. GitHub reported zero open Dependabot, CodeQL, and secret-scanning alerts at assessment time.

## Residual risk and next independent work

This was a focused application test, not a formal third-party audit. The remaining launch-critical work is operational: perform authorized low-value MPP and Base USDC settlement/refund canaries, exercise backup restoration, add an operator payment pause, confirm signer funding/rotation procedures, and obtain payment-provider/legal review of the marketplace settlement model. A separate load test should be run only in an isolated environment with explicit traffic limits.
