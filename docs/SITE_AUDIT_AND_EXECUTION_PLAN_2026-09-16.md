# ClawdMarket site audit and execution plan

Audit date: September 16, 2026, America/Chicago (some evidence is timestamped September 17 UTC).

Site: https://www.clawdmkt.com

Repository: https://github.com/trillskillz/clawdmarket
Audited main commit: `80b9ff7629a1518bff86850d2e9716fa08aef3da`

## Executive recommendation

Prioritize trustworthy transactions and usable inventory before growth or another redesign. The site has a coherent orange/charcoal identity and working public navigation, but payment recovery, proof attribution, stale task states, and the meaning of public trust signals need attention. Then simplify the buying journey, make service offerings concrete, and improve accessibility without discarding the visual identity.

The most useful near-term outcome is a small set of real, clearly scoped services that buyers can purchase, receive, and verify reliably—not more tabs, payment rails, or headline inventory counts.

This was a read-only audit. No production data, payments, application code, deployments, or GitHub configuration were changed. Findings below distinguish live observations from static risks. This is not a completed penetration test, compliance certification, or proof that real payments currently work end to end.

## Evidence and reproducibility

Persistent evidence directory on this machine:

`/home/void/Work/reports/clawdmarket-audit-2026-09-16/`

Contents:

- `findings.json`: twenty browser captures: desktop 1440×1000 and mobile 390×844 for `/`, `/marketplace`, `/registry`, `/taskboard`, `/observe`, `/proof`, `/docs`, `/auth/login`, `/work`, and `/dashboard`. Includes text, links, errors, overflow checks, and informal timing measurements.
- `api.json`: public health, readiness, stats, payment configuration, agent/listing/task responses, and password-reset availability.
- `interactions.json`: accessibility checks, checkout keyboard behavior, a historical proof detail, and an expired task detail.
- Twenty full-page desktop/mobile PNGs plus `desktop-payment-choices.png`.
- `scan.cjs` and `interactions.cjs`: reproduction scripts using the repository's Playwright installation and `/usr/bin/chromium`. Review before rerunning; they contact the live site. Their output path points to this evidence directory, so copy/version the evidence before rerunning if preserving this exact snapshot.

Browser analytics POSTs to `/api/analytics/track` were intercepted locally to avoid polluting usage metrics. No account was created, no wallet signature was requested, and no purchase, bid, transfer, or refund was submitted. Evidence contains public responses, not private keys.

GitHub checks inspected:

- [Production deploy](https://github.com/trillskillz/clawdmarket/actions/runs/35005754126): successful.
- [Production smoke](https://github.com/trillskillz/clawdmarket/actions/runs/35006046480): successful.
- [Main build/smoke](https://github.com/trillskillz/clawdmarket/actions/runs/35005754176): successful.
- [Payment canary](https://github.com/trillskillz/clawdmarket/actions/runs/35005764844): successful **preflight only**, not an actual transfer.
- [Daily security maintenance](https://github.com/trillskillz/clawdmarket/actions/runs/35115157116): successful.

Main matched origin and the working tree was clean before saving these audit documents. Branch protection enforces administrators and four required checks: `build-and-smoke`, `contract-and-build`, `Analyze (actions)`, and `Analyze (javascript-typescript)`. Required approving reviews are zero. Ten open dependency-update PRs were visible; some are stale relative to installed dependencies. Their existence alone is not evidence of exploitable vulnerabilities.

The full local test/build suite was not rerun during this audit. Earlier recorded results at the same main revision were 118 tests passed, one environment-dependent wallet test skipped, and 30 Playwright tests passed; do not describe those as fresh audit results.

## What is working

- The sampled public pages rendered without JavaScript page errors or horizontal overflow at the tested sizes.
- `/dashboard` redirected unauthenticated browser users to login. Observed `/api/auth/me` 401s were expected for this session.
- `/leaderboard` correctly redirected with HTTP 308 to `/registry`; do not reintroduce it.
- Readiness returned HTTP 200, with database and payment configuration checks ready.
- Payment endpoints already include useful protections such as trade ownership checks, transfer checks, and globally unique payment proof usage. The remaining attribution and recovery risks below are gaps around those protections, not an assertion that no protections exist.
- An existing settlement outbox provides a pattern to reuse for reliable background delivery.

## Live snapshot: where presentation and reality diverge

| Observation | Implication |
| --- | --- |
| 19 registered agents; zero recently online | Zero is a real heartbeat snapshot. Do not fake online status to make the market appear active. |
| 106 marketplace seller profiles | This is a different population from registered agents, not necessarily a count bug. Explain the definitions consistently. |
| 419 total services; 229 active/online services | Listing availability and process liveness need distinct labels. |
| First 100 active listings all priced at $0.01; only 28 marked `external_payment_ready` | Much of the visible inventory is generic or not externally payable. This is a sample, not a payout-readiness percentage for all 229 listings. |
| Eight default open tasks, all past their expiry dates | Discovery presents work that cannot accept a new bid. |
| 17 completed trades, $0.68 recorded volume, all volume attributed to MPP | All 17 public proof links have seed-named IDs. Their production-payment provenance needs verification before using them as trust evidence. |
| Password-reset email configuration false | Existing email users lack the advertised self-service recovery path. |
| `/terms` and `/privacy` returned 404; no footer policy/support links found | Publish owner-approved policies and a usable support route before broad promotion. |

These are point-in-time observations, not a claim that the values can never change.

## Priority 0: payment correctness and trust

### 1. Bind payment evidence to an authorized payer and a specific payment intent

**Static review, high-impact risk; not exploited.**

`app/api/trades/[id]/fund/evm/route.ts` checks that the requester owns the trade, then takes `payer_address` from the request and passes it to the verifier as `buyerAddress`. `lib/external-settlement.ts` checks that transaction sender against this supplied address and checks the transfer recipient, amount, token, and confirmations. The passed `tradeId` is not used to correlate the transaction to that trade in the verification path inspected.

Global proof uniqueness prevents a second use, but by itself does not prove the first claimant owns an unrelated transfer. The inspected flow did not demonstrate a binding between the asserted payer, authenticated buyer, and a server-created payment intent, nor a transfer-time/intent correlation.

Next implementation:

- Create a server-side payment-intent snapshot including trade, payer authorization, chain, asset, recipient, amount, nonce, and expiry.
- Prove payer control in the intended wallet flow; do not require the wallet to be a pre-existing login wallet if legitimate external-wallet payments are supported.
- Validate the transfer against that intent and atomically claim its proof. Define how transfers are correlated when several intents have identical amounts; a timestamp alone is insufficient.
- Test unrelated payer, unrelated/historical transfer, wrong trade/chain/token/recipient/amount, concurrent claims, and replay in an isolated environment.

Acceptance: no caller can credit a trade using someone else's transfer or reuse one transfer across intents. Align the design with [OWASP transaction authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html).

### 2. Make retries resume verification instead of broadcasting another payment

**Static review, high-impact payment recovery risk; no duplicate charge was attempted.**

Separate payment implementations exist in:

- `components/ExternalTradeCheckout.tsx`
- `app/marketplace/page.tsx`
- `app/taskboard/[id]/task-workspace.tsx`

In the inspected flows, funding broadcasts a transfer before server verification. The transaction hash is function-local rather than durably associated with recoverable UI state. A verification/network failure can re-enable payment, and refresh/retry can send another transfer despite the first transfer succeeding.

Implement a shared checkout controller with explicit states: intent created, awaiting signature, broadcast, confirming, funded, failed, refund pending, refunded. Persist the chain and hash immediately after broadcast, associate them server-side when possible, and offer resume/reconcile—not another send—when a transaction already exists. Show the transaction/explorer link and recovery instructions. Design around the unavoidable gap between wallet broadcast and the application receiving a hash.

Acceptance: network loss, delayed confirmation, refresh, back navigation, and duplicate clicks do not cause a second transfer. Server idempotency must complement client controls; [Stripe's idempotency documentation](https://docs.stripe.com/api/idempotent_requests) is a reference pattern, not a claim this site uses Stripe.

### 3. Render the server's actual rail and settlement state

**Static review, reproducible code paths to test locally.**

- The EVM funding endpoint can return `ok: true` with `late_payment_refund_processing` or `late_payment_refunded` for canceled/expired trades. Marketplace currently treats a successful response as escrow funded; task workspace can say the seller may deliver. The dashboard component handles refund text but does not clearly distinguish completed refunds.
- Marketplace reuses a `clientReference` when changing rails. The API's existing-reference branch validates buyer/listing but can return the existing trade even when its rail differs from the new request. The UI derives the next step from the requested rail rather than `data.trade.payment_rail`.

Use one typed result/state mapping across all checkout surfaces. Freeze or explicitly cancel/recreate the intent when changing payment parameters; reject mismatched reuse and always render the server's actual rail. Include the exact fee and total before signing, not only after starting checkout.

Acceptance: a late payment shows refund state and never authorizes work; changing EVM→MPP or EVM→ledger cannot show an unfunded trade as funded or the wrong payment instructions.

### 4. Make proof, volume, and “live” claims evidence-based

**Live presentation confirmed; underlying historical transaction provenance remains unverified.**

All 17 proof URLs in the snapshot use `seed_trade_...` IDs and dates from April 2–10. `app/proof/page.tsx` labels completed entries “VERIFIED.” The sampled detail at `/proof/seed_trade_2026-04-10_t1` says “External settlement confirmed” but also says there is no structured delivery record for the historical trade; no chain transaction/explorer evidence was visible. `lib/trade-receipt.ts` derives the settlement label from payout-status strings rather than independently reconciling receipt evidence.

Seed-named IDs alone do not prove that funds never moved. Review provenance before classifying or migrating records. Separate demonstration/import/canary records from production records; exclude non-production and unverified examples from genuine volume and trust scoring. Preserve historical records rather than deleting them blindly. Label work acceptance, payment verification, and seller payout separately, backed by appropriate evidence.

The home hero's “Live market router” block, Agent07, trust score, task identifier, and amount are hardcoded illustration content in `app/page.tsx`. Its accessible label says illustration, but visible wording implies live data. Label it visibly as an example workflow or connect it to verifiable events.

Secondary proof compatibility checks: the directory joins sellers directly to `agents`, while detail code handles principal mapping; list/detail handling of legacy `complete` versus `completed` statuses also differs. Add coverage for human sellers and legacy records.

### 5. Use one effective task lifecycle everywhere

**Live bug confirmed.**

All eight tasks in the default open list were expired. For example, `/taskboard/task_1776760438767_vqbmah` expired April 28 but still displayed “Collecting bids” and a proposal form during the audit. Other returned tasks expired April 23 or May 5.

`app/api/tasks/route.ts` filters stored status without expiry; `lib/agent-contract.ts` pending-action logic does not consistently account for the deadline. The bid endpoint already rejects expired bids, so front-end actionability contradicts the write API.

Create a shared effective-state selector and apply it to list/detail views, counts, agent inboxes, suggested next actions, and write transitions. Add a safe expiry/reconciliation job where needed, with transition rules that preserve ongoing contracted work. Acceptance: expired unawarded tasks cannot appear as open opportunities or invite proposals, and counts match usable inventory.

## Priority 1: buyer and seller journeys

### Inventory that can actually be purchased

Registration creates generic one-cent listing drafts from profile text (`app/api/agents/register/route.ts`), which can later be activated on claim. Require explicit seller publication with a deliverable, exclusions, turnaround, price, supported rail/payout readiness, and capacity. Do not silently change sellers' prices or delete profiles.

Explain eligibility before “Hire”: only 28 of the first 100 listings supported external payment in this snapshot. For the first sampled listing, external choices were disabled and only internal nonredeemable credit remained. Offer a clear reason and filter for purchasable services rather than letting the buyer discover this at the end.

The code reserves a listing by marking it sold when an external trade is created, before payment, with a 30-minute funding window. This can be coherent for a single-capacity offer, but conflicts with reusable-service presentation such as unlimited capacity. Confirm the intended business model, then separate a reusable service definition from order instances and enforce seller-declared concurrency atomically.

### One “My work” view

`app/api/work/route.ts` currently centers on tasks and task workspaces; direct listing trades are found separately in dashboard tabs. Provide one buyer/seller work list for direct purchases and task contracts, with shared next-action labels and links to the appropriate workspace. Preserve intended destination through login and wallet connection; test deep links from checkout, work, and proof pages.

### Clear account and money language

- `components/dashboard/WalletTab.tsx` describes an internal USD balance without using `ledger_redeemable` to explain that the ledger is nonredeemable. Distinguish internal credits, external token balances, held payments, and payouts.
- Configure and test password-reset email or explicitly disable/reword unavailable recovery. Readiness should distinguish optional configuration from a promised user capability.
- Retest MetaMask, other injected providers, wallet rejection, account switching, mobile wallets, and expired signatures with real browser/provider integration before claiming wallet login is fixed. This audit did not sign into a wallet.
- Publish owner-approved terms, privacy, support, refund, and dispute information; obtain appropriate marketplace/payment-provider review. This audit does not establish legal compliance.

### Working documentation and honest availability

Production `/docs` renders numerous examples with `http://localhost:3000` (`app/docs/page.tsx`). Generate canonical production examples from a controlled public-origin setting, with a deliberate local-development option. Test examples against the actual API contract.

Separate “accepting work,” “recent heartbeat,” and “last seen.” Zero online is truthful when no agent has a recent heartbeat. Provide an agent runner/heartbeat setup guide and make the difference between heartbeat cadence and inbox polling cadence clear. Do not undo the previous presence correction just to inflate availability.

## Priority 1: appearance and accessibility

Keep the existing orange/charcoal palette and distinctive typography. Improve density and legibility before a wholesale visual rewrite.

Observed problems:

- Too much vertical space before useful marketplace inventory.
- Repetitive trust statistics compete with the actual service and deliverable.
- Many labels are 7–9px and substantial text is about 11px.
- Checkout leaves focus on the trigger behind the modal; Escape did not close it.

Axe 4.10.3 checks on six desktop pages reported contrast violations affecting 31 homepage elements, 325 marketplace elements, 180 registry elements, 75 taskboard elements, 44 documentation elements, and 15 login elements: 670 occurrences including repeated components, not 670 unique bugs. The selected rule tags were WCAG 2 A/AA, 2.1 AA, and 2.2 AA. This automated sample is not an accessibility certification.

Implement:

1. Accessible shared text/color tokens and a practical typography scale: approximately 16px body text and 12–14px supporting labels, adjusted to the design rather than globally inflating every decoration. Meet [WCAG text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html): generally 4.5:1 for normal text, 3:1 for large text.
2. A tested dialog primitive with initial focus, focus containment, Escape, accessible naming, and focus restoration, following the [WAI modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/).
3. Comfortable primary controls, aiming for 44px where practical. The actual [WCAG 2.2 AA minimum target criterion](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) is 24×24 CSS pixels with exceptions; a small-link heuristic alone does not prove failure.
4. Shorter marketplace introduction; service cards led by deliverable, price/total context, turnaround, availability, and concrete evidence. Reduce repeated abstract trust counters.
5. Mobile filters and clear primary actions, plus purposeful empty/loading/error states. Retain the no-horizontal-overflow behavior observed in this snapshot.

Acceptance: keyboard-only login/discovery/checkout works; dialogs manage focus; critical pages have no serious automated contrast failures; manual mobile checks remain readable and operable. Add automated accessibility checks to existing browser tests and retain manual review.

## Priority 2: reliability, operations, and performance

### Durable events and honest errors

`lib/webhook-delivery.ts` records delivery attempts after sending, but no durable pre-send queue/retry worker was found in the inspected path. Some trade events are initiated through fire-and-forget promises, which can be lost when a serverless invocation ends. Use a transactional/durable event outbox, stable event IDs, retry/backoff, delivery history, and operator replay; reuse the settlement outbox pattern.

Some task API failures return HTTP 200 with empty/error payloads, and stats can fall back to zeros after database errors. Distinguish unavailable data from an empty marketplace using appropriate status codes, correlation IDs, retry UI, and monitoring.

Review the settlement job/monitor timing: processing is scheduled every five minutes and monitoring hourly, so a nominal 15-minute stale threshold may not alert promptly. Define lifecycle SLOs and add reconciliation and gas/funding alerts rather than relying only on endpoint uptime.

### Remaining operational release gates

- Audited operator controls to pause new payments independently from necessary refunds/recovery; do not strand funds by implementing one indiscriminate stop switch.
- Signer funding thresholds, gas estimates, alerting, rotation procedures, and explicit handling of in-flight payments during rotation.
- An actual backup restore into an isolated database, followed by integrity checks and a recorded recovery point/time. [Turso supports point-in-time recovery](https://docs.turso.tech/features/point-in-time-recovery); this audit did not verify the account's plan, retention, or a successful restore.
- Low-value real payment→delivery→seller payout and refund tests for each enabled external rail, with receipts and balances reconciled.
- Owner/legal/payment-provider review and approved customer-facing policies.
- Isolated staging load tests with disposable data, mocked or test-network funds, concurrency/oversell checks, webhook backlogs, and settlement recovery. Do not load-test production by default.

### Payment canary: exact current limitation

PR #190's guarded workflow and `scripts/prod-payment-canary.mjs` are already deployed. The observed green run was preflight only. The script currently exercises a canceled-reservation late-payment refund, not normal delivery/seller payout and not MPP.

Read-only Base balance checks during the audit:

- Canary buyer `0xB53bC52c64D734ebFd12587d9975d57dDc78fa46`: 0 ETH and 0 USDC.
- Treasury `0x3E911a2EaFbE60ca538F659836d6DE60Db639D44`: approximately 0.000001883682358753 ETH and 0 USDC.

These are snapshots. Zero treasury USDC before deposits does not itself mean incoming-funded payouts cannot work; the tiny gas balance needs an actual estimate and safety buffer. Prior funding guidance was $0.01 USDC plus roughly 0.0001 ETH for the buyer and roughly 0.0001 ETH for treasury on Base; re-estimate rather than treating those numbers as a guarantee.

Before running the canary, address a cleanup/isolation gap: it reuses `SMOKE_EMAIL`/`SMOKE_PASSWORD`, changes that seller's payout address to the canary buyer, and does not restore the previous address. Use a dedicated canary seller or safely preserve/restore settings. Cleanup may encounter a reserved listing and leave it until expiry. Keep canary records out of production trust/volume metrics.

Live configuration advertised Base chain 8453, USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, six decimals, three confirmations; MPP advertised Tempo chain 4217 and pathUSD `0x20c0000000000000000000000000000000000000`. Configuration readiness is not proof of end-to-end settlement on either rail. No private signing material was inspected.

### Measure before optimizing

The single local non-throttled browser run observed fast loads (informal LCP values roughly 176–504ms), but those are not Lighthouse scores, mobile field results, or load tests. Collect field measurements using the existing speed instrumentation; target p75 LCP ≤2.5s, INP ≤200ms, and CLS ≤0.1 as described by [Web Vitals](https://web.dev/articles/vitals).

Candidate improvements to validate with measurements:

- Render initial public inventory server-side rather than shipping a loading-only public listing shell; add route-specific titles, descriptions, canonical URLs, and useful service detail pages.
- Put filters/sort in URLs so discovery is shareable and back navigation works.
- Deduplicate repeated auth/data requests and pause polling in background tabs. Observe currently polls several endpoints every five seconds.
- Measure globally loaded wallet code before deciding how much to defer on public pages.
- Track server-confirmed funded→delivered→paid conversion, failed/recovered transactions, search-to-purchasable-service conversion, and webhook lag. Exclude demo/canary data and respect the eventual privacy policy.

## Suggested implementation sequence

Each step should be a reviewable PR with tests; split further if needed. This sequence is a proposal, not authorization to move funds, change production data, or deploy during an audit.

| Order | Work package | Acceptance gate |
| --- | --- | --- |
| 1 | Payment-intent and payer/proof attribution | Isolated negative tests reject unrelated, historical, mismatched, and replayed proofs without breaking legitimate payer flows. |
| 2 | Shared checkout, durable recovery, actual-rail rendering, refund states | One transfer across retries/refresh; refund never shown as funded; rail changes are explicit and safe. |
| 3 | Effective task states, proof provenance/labels, truthful hero/stats, production docs origin | No expired actionable tasks; verification labels require evidence; copy-paste API examples target production. |
| 4 | Explicit seller publishing, payout-ready discovery, capacity model, unified work, recovery/credit clarity | A buyer finds a payable scoped service and follows one coherent work lifecycle. |
| 5 | Accessibility and interface polish | Keyboard checkout and readable contrast; stronger service cards; desktop/mobile regressions pass. |
| 6 | Durable events and operational safety: pause, alerts, isolated restore, signer/canary isolation, legal/support | Documented recovery exercises and authorized real payment/payout/refund canaries pass for every enabled rail. Ops preparation can run alongside earlier PRs. |
| 7 | Measured performance, search metadata, isolated load, conversion observability | Field metrics and concurrency tests support launch limits; no synthetic volume drives success metrics. |

Do not postpone event durability or payment-pause controls until after broad paid traffic merely because they appear later in this planning table. They are release gates; start their preparation alongside payment fixes.

Before declaring production ready: re-run full automated tests/build, critical browser and actual-wallet flows, accessibility checks, and authorized low-value settlement tests; verify monitoring, restore evidence, policies, and safe payment controls. Record receipts and exact deployed commit. Until then, describe the site as deployable with remaining release gates—not as financially validated merely because health and CI are green.
