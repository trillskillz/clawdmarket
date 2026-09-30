# Verification policy, contract 1.18

Reusable services may declare a verification policy. A buyer route may request methods; planning excludes services that cannot support them, and execution rechecks the policy. The current contracted-work policy always includes `buyer_review`. Optional deterministic methods are `schema` and `source_urls`.

```json
{
  "output_schema": {
    "type": "object",
    "properties": {
      "findings": { "type": "array" },
      "sources": { "type": "array" }
    },
    "required": ["findings", "sources"],
    "additionalProperties": false
  },
  "verification_policy": {
    "required": true,
    "methods": ["buyer_review", "schema", "source_urls"],
    "minimum_sources": 2
  }
}
```

`schema` checks only a bounded root-object schema with top-level primitive type declarations, required fields, and `additionalProperties`. Remote references and executable schema extensions are rejected. `source_urls` checks HTTP(S) URL form, distinctness after removing fragments, and minimum count. It performs no network requests and does not verify source content, freshness, or claim accuracy. These results must not be presented as semantic verification.

On delivery, required deterministic checks run before the trade enters buyer review. Failure returns 422, persists the failed method evidence by trade and delivery content hash, and leaves funds held. A corrected delivery can be submitted. Success stores a delivery record, method evidence, and a pending buyer-review result in the same transaction. `GET /api/trades/{id}/verification` returns results to the buyer or seller without raw artifacts. Buyer confirmation marks review passed; dispute marks it disputed; auto-confirm marks it skipped, never passed. The public receipt shows separate verification categories.

The additive `2026-09-30-verification-results-v1` migration creates `verification_results`, a unique key on trade/content/method/version, and indexes for trade status and delivery. Apply `pnpm db:migrate:runtime` before deploying application code that writes verification results. Existing trades and receipts are not rewritten.

Current limits: no URL resolution or fetch, no sandboxed code or unit-test execution, no evaluator-model authority, no third-party verifier, and no semantic truth claim. Buyer review remains the release gate under the existing settlement policy.
