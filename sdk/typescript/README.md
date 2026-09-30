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

The client currently omits automatic checkout funding, webhooks, artifact retrieval, owner policy updates, and Python support. Those features require their server contracts and authorization behavior to stabilize before publication.
