# Enterprise chain fee coverage audit

HTTP **1.107** is acceptance-complete locally, substantive part **1/10** after the
verified PR #255 production release.

The inspector reads original v2/v3 gross-use links, payment receipts and every
treasury attempt. It has no RPC or mutation path and no credential input. Shared
strict fee parsing retains the existing model and arithmetic; no stored historical
receipt or completed workflow aggregate is rewritten. Original payment state,
spending authority and routing admission remain separate.

Original account/use/order/buyer, frozen rail/chain/token/payer or treasury and
strict receipt identity must agree. Buyer charges must fit the original reviewed
fee ceiling; treasury charges are separate. Fixed native ETH and Tempo pathUSD
groups retain exact integer subtotals with null actual totals for missing, invalid
or empty observations. Historical null observations produce no invariant alert.
Charged failed attempts are costs, not settlement completion. Contradictions emit
fixed private alerts without IDs, wallets, hashes, credentials or raw terms. A
10,001-record sentinel fails unavailable rather than publishing a truncated total.

Accepted evidence, using Node 24 and guarded disposable databases:

- `/tmp/clawdmarket-enterprise-chain-fee-predeploy.log`: **754 cases, 749 passed,
  zero failed, five expected skips**, **679094.2114 ms**. Actual EVM/Tempo economics,
  isolated verification, TypeScript, generated SDK parity/build, 17 Python cases,
  lint and representative legacy migration regressions passed.
- `/tmp/clawdmarket-enterprise-chain-fee-economic-focus.log`: **four cases passed**,
  **37078.7 ms**. Actual L1 and Tempo original late-payment full refunds reconcile
  buyer gas and treasury fees to original receipt and balance deltas, keeping Tempo
  refund principal separate. Revoked grants retain those observations. A charged
  reverted original Tempo refund adds its real fee without completion, replacement
  bytes or capacity release. Corrupted hash observations are excluded/alerted;
  restored historical nulls leave partial totals unknown. Missing fee storage
  produces fixed monitor failure/private HTTP 500 without schema leakage.
- `/tmp/clawdmarket-enterprise-chain-fee-logic-focus.log`: **ten cases passed**,
  retaining both original strict fee models and proving role/chain separation,
  exact large-integer arithmetic, smallest-unit display, unknown coverage,
  changed original identity/linkage/model/ceiling refusal and the bounded sentinel.
- `/tmp/clawdmarket-enterprise-chain-fee-build.log`: production build passed with
  existing dependency warnings. Built administrator routes exercise the shared
  codec and inspector; their libraries are included in the Vercel build.
- `/tmp/clawdmarket-enterprise-chain-fee-browser.log`: **all 11 built Chromium
  journeys passed in 48.8 s**, with no retry. Original owner grant/workflow reviews,
  canonical API aliases, exact fee display, missing/corrupt/repaired observations,
  private aggregate alerts, 390px layout and clearing costs on logout passed.
  The guarded browser fixture models stored fees for presentation only; actual
  disposable-chain tests establish economic provenance. Subsequent fixture edits
  remove a draft comment and adjust whitespace only; syntax was rechecked.
- `/tmp/clawdmarket-enterprise-chain-fee-migration-replay.log`,
  `/tmp/clawdmarket-enterprise-chain-fee-db-check.log` and
  `/tmp/clawdmarket-enterprise-chain-fee-queries.log`: repeated disposable migration
  replay and fixed integrity/query checks passed with **62 IDs, integrity ok,
  zero foreign-key anomalies**, and all four evidence-query compilations.

Temporary source-copy syntax/model checks were preparation, not application or
economic acceptance. No new migration is required; runtime schema DDL remains
forbidden. The accepted complete gate contains no failing diagnostics.

Production remains independently verified **PR #255 / HTTP 1.106**, SHA
`6a4d335fafa11cdccb1efbee2aaa699881f07cbd`. The subsequent public read-only
`/tmp/clawdmarket-tempo-enterprise-production-version-rechecked.log` confirms both
domains' direct manifest/OpenAPI version 1.106, readiness ready and canonical www
pages. This new part stays local under the resumed ten-part publishing gate;
no live wallet spending, top-up, rollout change, GitHub push or deployment is
included. Continued planning audits the separate routed-grant boundary and does
not count as another completed capability.
