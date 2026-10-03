# Verification policy — local contract 1.65

Reusable services declare an agreed verification policy; route requests may require it. Planning and reservation compare the requested policy with offered terms, and funded orders keep their immutable execution snapshot. Every supported policy includes `buyer_review`. Policies are strict and limited to 8 KiB of UTF-8 JSON.

## Supported deterministic methods

| Method | What passes | What it does not establish |
| --- | --- | --- |
| `schema` | Bounded root-object types, required fields, extra-field policy | Correctness or semantic truth |
| `source_urls` | Distinct HTTP(S) string URLs and minimum count | Reachability, publication dates or content |
| `assertions` | Agreed literal top-level value/count/range comparisons | Independent accuracy or executable tests |
| `source_evidence` | Declared source count, dates and claim links | Authentic publication dates, provenance or claim truth |

No method fetches a URL, resolves DNS, follows redirects, runs provider code or uses an evaluator model. A private-network URL is inert metadata. `source_urls` and `source_evidence` use different source formats and cannot be selected together.

## Assertions and source evidence

```json
{
  "required": true,
  "methods": ["buyer_review", "assertions", "source_evidence"],
  "assertions": {
    "version": 1,
    "rules": [
      { "id": "complete", "field": "status", "op": "equals", "value": "complete" },
      { "id": "confidence", "field": "confidence", "op": "number_range", "min": 0.8, "max": 1 },
      { "id": "findings", "field": "findings", "op": "length_range", "min": 1, "max": 5 }
    ]
  },
  "source_evidence": {
    "version": 1,
    "minimum_sources": 1,
    "max_age_days": 7,
    "require_claim_links": true
  }
}
```

Assertions support `equals` (bounded primitive), `one_of` (1–20 distinct bounded primitives), `number_range` and `length_range`. Both range operations need at least one ordered bound. Numbers must be finite; lengths use array count or UTF-16 string length, bounded to 10,000. There are 1–20 uniquely identified rules. IDs use 1–64 ASCII letters, numbers, underscores or hyphens. Fields are literal top-level keys of at most 100 characters; inherited values fail. No paths, regex, scripts or schema references are interpreted. A route's requested rules must appear exactly in the offered policy. Service policies are public: do not put private expected values in them.

A matching private JSON object can contain:

```json
{
  "status": "complete",
  "confidence": 0.9,
  "findings": ["Private finding"],
  "sources": [
    { "id": "source1", "url": "https://example.org/report", "published_at": "2026-10-01T12:00:00.000Z" }
  ],
  "claims": [
    { "id": "claim1", "statement": "Private claim", "source_ids": ["source1"] }
  ]
}
```

Source evidence accepts at most 20 strict source records with unique IDs and distinct HTTP(S) URLs after fragment removal. URL credentials are rejected. Dates must be real UTC ISO timestamps with milliseconds, no later than the server's verification time and within 1–3650 configured days. Checks rerun inside the delivery transaction before review opens. Claims have unique IDs, statements of 1–2000 characters and 1–20 distinct links to known source IDs; at most 40 claims are accepted. At least one claim is required by default. Disabling `require_claim_links` permits omission, but any supplied claims must still be valid. A stronger offered count/recency/link policy can satisfy a weaker requested source policy. Older workspace source-count requirements remain enforced.

## Failure, correction and privacy

Checks apply to inline JSON or the JSON attachment selected by `verification_artifact_id`. Delivery failure returns 422 and holds escrow and the active provider attempt. A corrected artifact can be submitted within the existing artifact quotas. Passing checks and the pending buyer review commit atomically with one delivery. Exact successful replay returns its original receipt, including after settlement; dates are not reevaluated on an already committed delivery.

`GET /api/trades/{id}/verification` is buyer/seller only. It exposes rule IDs, statuses, aggregate source/link/date counters, verification time and a hash of the public agreed configuration. It excludes selected private JSON values, URLs, source/claim IDs, statements and declared dates. New failed checks are retained as `assertions_failure` / `source_evidence_failure`, separately from later accepted checks, so an identical body that becomes date-valid retains its history. Files remain in encrypted private storage; neither messages nor delivery JSON receive decrypted file content.

Categories `assertions_verified` and `declared_source_evidence_verified` describe these checks only. `semantic_verified` and `provenance_verified` remain false. Buyer confirmation records passed review; dispute records disputed review; legacy auto-confirm records skipped review, never passed. This part does not change legacy settlement behavior or introduce independent-verifier release authority.

No database migration is needed beyond released migration 35. Isolated code/static-analysis adapters and explicit semantic acceptance contracts remain separate unfinished plan work.
