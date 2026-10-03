# Navigation, account credit and wallet balances — 2026-10-03

User priority: deliver this release before resuming routing. Publishing to GitHub/Vercel is explicitly authorized; the earlier ten-part gate does not apply to this release.

Release preview found a packaging omission: the shared canonical verifier module is now explicitly included in `.vercelignore`. A test RPC fixture also returns a generic failure instead of an exception string, resolving the review's error-detail finding.

## Delivered capability

- Desktop/mobile Network menu includes Why ClawdMarket and Proofs, with Escape/outside-click closure.
- Retired the genome API and fabricated random extinct-variant scores. Required registration/version lineage, historical settlement recovery and inbound redirects remain supported.
- Separate integer prepaid account credit backed by exact verified Base USDC deposits. Historical wallet balances are excluded; no withdrawal API is offered.
- Accounts and registered agents create/recover deposits, read account and wallet balances, and purchase listing/task/enabled reusable work with rail `credit`. Seller acceptance and disputes release exact credit escrow. Fees stay in the backed platform account.
- Current owners transfer deposited credit to their agents with immutable references. Agent keys cannot debit owner accounts; scoped read keys cannot pay. Existing purchase budgets and organization attribution apply.
- API/SDK/native contract 1.72 and additive runtime migration 40. Protected operator audit checks deposits, globally unique receipts, account entry sums and total liability conservation.

## Deposit recovery contract

Persist a stable reference before requesting an intent. Only fresh `created=true` permits one exact transfer before expiry. Standard Base EOA wallets are supported; smart-account payers are rejected before transfer permission. Persist an original transaction hash and deposit-specific payer signature. Confirmation checks chain identity, canonical block, minimum confirmations, sender, token precision, exact amount, recipient and intent time. Shared receipt uniqueness prevents reusing a trade payment as a deposit. Recovery after timeout/expiry or a payment pause never grants another transfer. Browser state marks a possible send before invoking the wallet and recovers the original hash after reload. Automated callers must privately persist their exact signed transaction before broadcasting.

## Local evidence

- Required predeploy: 424 tests, 416 passed, eight skipped; typecheck, SDK and lint passed.
- Real verifier isolation: 2/2 passed separately (the full suite leaves that privileged fixture skipped).
- Desktop/mobile navigation and removed API: 3/3 passed.
- Desktop/mobile wallet lost-response recovery: 2/2 passed, exactly one wallet transfer request across reload and confirmation. These are browser/RPC fixtures, not production transfers.
- Final production build and complete browser regression are release gates.

## Production verification and deferred funded proof

Use the protected GitHub deployment, migration-first Vercel release, same-SHA production smoke, payment reserve preflight and aggregate operator audit. Payment starts were already unpaused in the preceding production check; verify that state again after release. Never clear an incident pause merely to make a test pass.

A new paid deposit/credit purchase proof requires an authorized wallet with enough USDC after its normal-payment reserve and enough gas. If configured wallets cannot meet those limits, save the funded check for later without transferring, topping up or consuming site reserves. Local tests and advertised readiness do not establish a new live deposit or settlement.

Routing remains acceptance-gated. Resume P0.5 Tempo buyer authority/durable credential recovery after publishing this capability; P0.6 orchestration, P0.7 reconciled retries and global rollout remain unfinished.

## Protected payment reserve preflight — 2026-10-03

Read-only run [37141148900](https://github.com/trillskillz/clawdmarket/actions/runs/37141148900) passed the settlement-gas-reserve step, then stopped before any wallet side effect: configured Base canary buyer has **0.005573 USDC**, below the **0.01 USDC** minimum, with **0.002753001248135033 ETH**. No funds were spent or moved. Save the new live deposit/credit purchase proof until a dedicated buyer has sufficient USDC beyond normal-site reserves; do not fund it from settlement/backing wallets. This follows the user's instruction to save an unfunded run for later.

## Final local release gates

Final production build passed. Complete Chromium browser/API matrix passed **39 tests, three retired legacy journeys skipped**. The matrix verifies actual HTTP empty-body route execution, exclusion of historical credit from spendable totals, desktop/mobile navigation, deposit recovery across a lost wallet response/reload with exactly one send, and existing onboarding/auth/dashboard/marketplace flows. Required predeploy remains **416 passed, eight skipped**; real isolation separately **2/2**. One capability PR contains the implementation, previous saved local work, native contract and migration. Global routing stays closed and P0.5 remains unfinished.
