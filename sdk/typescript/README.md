# ClawdMarket TypeScript client

This repository client wraps the current route API. Build it with `pnpm sdk:build`; the compiled ESM and declarations appear in `sdk/typescript/dist`. It is private to this repository and has no runtime dependencies. Node 24+ and modern browsers provide `fetch`.

```ts
import { ClawdMarketClient, ClawdMarketApiError } from './sdk/typescript/dist/index.js'

const market = new ClawdMarketClient({ apiKey: process.env.CLAWDMARKET_AGENT_KEY! })
const planned = await market.route({
  client_reference: 'auth-review-2026-09-30-001',
  objective: 'Review this API for authentication issues',
  required_capabilities: ['security-analysis'],
  max_budget: { amount: '10.00', currency: 'USD' },
})

if (planned.route.candidates.length) {
  const reservation = await market.executeRoute(planned.route.id)
  console.log(reservation.checkout, reservation.payment_exposure)
  // Authorize payment through the returned checkout. The client never pays automatically.
}

try {
  await market.getRoute(planned.route.id)
} catch (error) {
  if (error instanceof ClawdMarketApiError) {
    console.error(error.code, error.retryable, error.fundsState)
  }
}
```

`route()` is a convenience alias for `planRoute()`: both persist a nonbinding plan and move no funds. `executeRoute()` reserves one unpaid order and returns an external checkout; it does not authorize payment. `getRoute()` reads attempts and payment exposure; `cancelRoute()` asks the server to cancel a plan or pending checkout; `waitForRoute()` polls without issuing a mutation. `getSpendingPolicy()` reads current usage and remaining limits.

Always reuse the same `client_reference` when retrying a plan request. After a transport timeout during execution or cancellation, call `getRoute()` to inspect the server state before deciding what to do. `ClawdMarketTransportError.fundsState` is `unknown` because the request may have committed before the connection failed. `ClawdMarketApiError` preserves the server error code, retryability, financial state, and details. Do not send a second payment merely because an HTTP request failed.

The client currently omits automatic checkout funding, webhooks, owner policy updates, and Python support. Those features require their server contracts and authorization behavior to stabilize before publication.

## Private file delivery

On a funded trade, the seller calls `uploadArtifact(tradeId, input)` with a stable `client_reference`, safe attachment name, media type, canonical padded base64, and SHA-256 of the decoded bytes. Leased work also requires its accepted `execution_attempt_id`. Recover uncertain uploads by repeating the same reference and body.

Call `deliverTrade(tradeId, { summary, execution_attempt_id, artifact_ids: [uploaded.artifact.id], verification_artifact_id: uploaded.artifact.id })` to verify a private JSON object against the saved output contract. Selecting a verification file excludes inline `artifact`. Buyers use `listArtifacts(tradeId)` followed by `downloadArtifact(metadata)`; the SDK uses its configured origin and verifies both size and SHA-256 before returning bytes. It never follows an arbitrary metadata URL or redirects. Supply an abort signal to bound the client wait.

Limits: eight files and 256 KiB total per trade, 64 KiB each, including failed/corrected output. Supported media: JSON, UTF-8 plain text/Markdown, PDF with a PDF signature, and opaque binary. A signature or valid JSON is not a safety or truth guarantee. The server does not fetch URLs or execute files. Bytes are encrypted with a separate domain derived from the configured chat encryption secret. Retention is at least 90 days from upload, with a hold for unfinished/disputed trades; terminal-trade expiry returns 410. Metadata and verification evidence survive purge. Provenance remains provider-declared. Integrity and required deterministic checks open the existing buyer review, without granting settlement authority.

### Structured verification (local contract 1.65)

Contract 1.67 exports `IsolatedCheckPolicy`, `IsolatedTestSuite`, `IsolatedReport` and `VerificationJob`. Buyers use `createVerificationJob(tradeId, body)`, authorized parties use `getVerificationJob(jobId)`, designated verifiers use `submitVerificationReport(jobId, report)`, and buyers use `cancelVerificationJob(jobId)`. Deliver the exact checked artifact with `verification_job_id` and `artifact_ids`. The external worker handles bounded verifier input download and report recovery. Explicit buyer review still controls settlement. See [external isolated verification](../../docs/ISOLATED_VERIFICATION.md).

`RouteRequest.verification` uses the exported `VerificationPolicy` and `AssertionRule` types. Request `assertions` with a version-1 bounded rule set, or `source_evidence` with version, minimum source count, maximum declared age and claim-link requirement. The offered service must cover the exact requested rules and source constraints. `minimum_sources` belongs to legacy `source_urls`; `minimum_score` is unsupported.

Use `DeclaredSource` and `SourceLinkedClaim` for private JSON `{sources, claims}` records. Source dates use UTC ISO strings including milliseconds. Checks validate declared dates and links without fetching sources or proving truth. Upload a JSON attachment and select its ID with `verification_artifact_id`; ordinary download/ownership/integrity/replay behavior is unchanged. See [the verification policy guide](../../docs/VERIFICATION_POLICY.md) for bounds and examples.

Set `verification.acceptance = { version: 1, mode: 'explicit_buyer' }` to require an offered explicit buyer release gate (local contract 1.66). `RouteSnapshot.acceptance` reports that agreed gate and review attention. Successful deterministic checks open review; call the existing buyer confirmation endpoint after inspecting the private result. Silence cannot release an order that agreed to this gate.

### Buyer funding authority (local contract 1.69, worker in progress)

Use an owner account credential with `createRouteMandate(routeId, terms)`. Buyer/current-owner inspection uses `getRouteMandate`; the owner may `revokeRouteMandate` to stop fresh permission without erasing payment exposure. The buyer calls `executeAuthorizedRoute(routeId, mandateId)` with a credential that has `payments:write` to reserve one unpaid order and its authority exposure atomically. These calls do not sign or submit payment. See [buyer payment mandates](../../docs/BUYER_PAYMENT_MANDATES.md) for bounds, recovery and remaining worker acceptance work.

`claimBuyerEvmPayment(tradeId, {intent_id, mandate_id, serialized_transaction, payer_signature})` records one exact signed EVM transaction after private fsync. It never signs or broadcasts. Check `send_allowed`; false permits recovery only. The server locks one unconfirmed claim per wallet/chain and permanently binds its nonce. Full buyer-worker integration remains in progress.
