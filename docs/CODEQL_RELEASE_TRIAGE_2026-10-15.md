# Cumulative release CodeQL triage

PR274's first analysis produced three high and22 medium annotations. Required
Analyze (actions), Analyze (javascript-typescript) and Analyze (python) jobs passed;
the separate Advanced Security aggregate failed. This document does not turn a
failed result green or dismiss findings automatically.

- URL-prefix check in `e2e/organization-listing-work.spec.ts`: changed to exact
  parsed URL origin equality. It counts forbidden test requests rather than
  authorizing access, but precise host comparison is still the correct test.
- Exception disclosure/XSS in local test HTTP transports: replace serialized
  exception text with a constant controlled-transport error. Test failures remain
  failures; stack text is no longer returned over HTTP. No production handler was
  changed to hide operational errors. Existing JSON response behavior is retained.
- `lib/registered-agent-auth.ts` legacy SHA256 compatibility: confirmed API-token
  context, not password storage. Current credentials use keyed HMAC-SHA256 with
  server pepper and cryptographically random24-byte tokens. The compatibility
  lookup hashes historical random128-bit tokens and upgrades successful matches
  to HMAC. Password authentication uses bcrypt separately. Changing historical
  digest identities here would break credential recovery; no unrelated override,
  password-hash downgrade or blanket analysis exclusion is introduced. This
  preexisting warning remains visible (repository alert12).
- `lib/contract-exact-acceptance.ts` SHA256 request identity: confirmed receipt
  integrity/idempotency context. Inputs are the original contract/milestone IDs,
  database-derived buyer identity, authority hash and finite exact-consent input.
  Registered authentication returns `user_agent_${agentId}`, never the API token.
  No password or bearer token enters this digest. The immutable v1 financial
  identity must remain compatible. This is a dataflow classification false
  positive, not a password-storage remediation or unresolved password exposure.

After the actual test repairs, rerun analysis and record the remaining exact
result. Dependency auditing remains unchanged and clean after removing the
braces path. Do not confuse clean dependency results with this separate analysis.
