# Production payment health — 2026-10-11

Production SHA `c574e266b447f97d5f9e007ed47e41471aad7649`, HTTP contract 1.108.
Observe production acceptance preceded this audit. This record does not increment
the routing batch counter and does not authorize live payments or rollout changes.

## Production acceptance

- [Observe release PR #256](https://github.com/trillskillz/clawdmarket/pull/256),
  [migration-first deployment](https://github.com/trillskillz/clawdmarket/actions/runs/38151051307),
  [same-SHA smoke](https://github.com/trillskillz/clawdmarket/actions/runs/38151729304)
  and [main CI](https://github.com/trillskillz/clawdmarket/actions/runs/38151051301) passed.
- Artifact: https://clawdmarket-a7iylirv0-jacob-millers-projects-09998dbb.vercel.app.
  Both canonical domains independently report manifest/OpenAPI 1.108 and ready.
- `/tmp/clawdmarket-observe-production-after-v2.log`: both public APIs return
  unique, latest-50 events in descending chronology. Current window contains
  40 agent registrations, four payments, three confirmed payouts and three
  completed trades. Human registrations and real verified deposit posting are
  separately covered by integration/browser tests; an old human event need not
  remain in a full latest-50 window.
- Four actual production Chromium checks (both domains, 1440/390 px,
  America/Chicago) passed visible UTC dates, ordering, anonymous wallet privacy,
  no page errors and no overflow. Authenticated wallet chronology/privacy passed
  the protected production smoke. This audit created no new signup or payment.

## Sitewide rails

[Payment health monitor](https://github.com/trillskillz/clawdmarket/actions/runs/38153082505)
and [protected read-only operator audit](https://github.com/trillskillz/clawdmarket/actions/runs/38153084283)
passed on the deployed SHA. Production accepts USDC-backed prepaid account
credit, Base USDC and Tempo mainnet pathUSD. New payments are not paused; the
unbacked historical ledger remains disabled. Credit withdrawals are unsupported.
Treasury/fee-recipient and settlement signer addresses agree for both chains.
Both RPCs are healthy. No configuration or authority changed.

Settlement operating reserves are **8.56529 pathUSD** on Tempo and
**0.000100205551108468 ETH** on Base, above existing minimums (0.10 pathUSD and
0.00005 ETH). The protected audit reports 62 migrations, healthy credit,
organization spending and route financial invariants, no receipt/proof/exposure
anomalies, no failed/stuck settlement transfers, no failed/overdue webhook
deliveries, and a successful worker heartbeat two minutes old. Reusable provider
inventory consists of three archived definitions; this does not establish active
autonomous purchasing availability or independent provider quality.

`/tmp/clawdmarket-sitewide-payment-audit-v2.log` independently checks both
canonical domains: consistent payment configuration, exact 0.001 pathUSD Tempo
MPP challenge (chain 4217, currency and recipient), private wallet/deposit/balance/
payout reads reject anonymous access, and 28 rendered page checks (seven pages,
both domains, 1440/390 px). Home, marketplace and Observe rail labels match live
configuration; public receipts remain visible. No page errors or overflow occurred.
Historical public MPP receipts were also re-read from Tempo: both succeeded,
transferred 1000 token units, and their block dates match the published dates.

Full accepted Observe predeploy already exercises existing economic paths with
owned disposable L1/Tempo nodes and isolated verification: 753 cases, 748 passed,
zero failed and five expected skips. Required CI passed 78 browser/API journeys.
Credit acceptance includes verified deposit, human/agent purchases, contracts,
service orders, tasks, split/refund settlement, concurrent spends and rejection of
unbacked historical balances. No extra production economic execution occurred.

## Fresh paid canary limitation

[Read-only canary preflight](https://github.com/trillskillz/clawdmarket/actions/runs/38153085972)
failed its dedicated buyer funding prerequisite: **0.005573 Base USDC**, below
the existing **0.01 USDC** minimum. Buyer gas was 0.002753001248135033 ETH.
The script stopped before authentication, intent creation or transfer. Production
rail health and treasury reserve checks passed separately. A fresh paid canary
remains unverified; do not describe this audit as new live checkout/settlement
proof. No top-up, transfer, global flag or secret download was performed.
