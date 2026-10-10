# Buyer delivery review acceptance — 2026-10-10

Acceptance complete at existing HTTP **1.99**; substantive batch **10/10**.

The private original buyer reviews exact output and verification, retrieves only
fixed-origin bounded private artifacts with independent size/SHA-256 checks, and
makes one explicit existing hash-bound acceptance. Untrusted output is inert,
provider URLs are never retrieved, and current owner links grant no agent-route
access. Stale, unavailable, inconsistent, corrupt or unauthorized inspection clears
private content and cannot command. Cookie commands require CSRF. Lost responses
require manual original-state inspection without replaying a buyer decision.

Real built-app HTTP and dummy-chain token transactions prove original provider
delivery, an acceptance committed with a deliberately lost 202 response, pending
payout with held capacity/no receipt, exactly one confirmed seller payout, one
capacity release and one original backed receipt. Keyboard and 1280/390-pixel
private browser checks pass. Existing late payment/refund recovery also passes.
No live wallets, production data or rollout flags were used in local acceptance.

Final gates: 704 passed automated tests, five expected skips (709 total), 13 Python
client tests, type/lint/SDK checks and production build. Six actual-chain buyer
browser tests and 70 remaining browser/API journeys pass without retries; four
retired legacy-credit/instant cases are expected skips. Legacy additive migration
replay is idempotent through ID 60. One initial existing workflow fallback HTTP 402
failed in the concurrent run; the same scenario passed unchanged in isolation and
in the final clean full rerun. Its original failed log remains preserved.

See acceptance details/evidence in
[ROUTING_LAYER_MASTER_PLAN.md](../ROUTING_LAYER_MASTER_PLAN.md) and operational
behavior in [BUYER_DELIVERY_REVIEW.md](BUYER_DELIVERY_REVIEW.md). The user's explicit
2026-10-10 instruction authorizes publishing all accumulated commits as one combined
GitHub/Vercel batch after this part. Required CI, additive migration-first deployment,
production smoke, readiness, reserves and private browser verification still govern
publication. Wider paid activation and independent production evidence remain gated.


Combined release packaging check: the first automatic Vercel preview failed
TypeScript because `.vercelignore` omitted the new buyer workflow worker imported
by acceptance tests. The upload allowlist now includes that worker, and predeploy
refuses its exclusion. An isolated tracked-source copy with excluded scripts removed
passed route type generation and TypeScript checking. Application code and economic
behavior are unchanged; the corrected head must pass GitHub and Vercel checks before
merge. Evidence: `/tmp/clawdmarket-combined-preview.log` and
`/tmp/clawdmarket-combined-packaging.log`.
