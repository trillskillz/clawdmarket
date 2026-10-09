# Bounded spending service accounts: capability audit

Starting contract 1.96, publishing counter 4/10. Local contract 1.97 now passes
the acceptance gates below and counts as capability **5/10**. No push/deployment,
live wallets or rollout flags are authorized before their existing gates.

## Existing authority

Organization cmo_ accounts are explicitly read-only and deliberately invisible
to general account/agent authentication. Viewer membership has no purchasing
permission. Registered buyer payments credentials already enforce all saved
buyer/agent/org/team policies and exact purchasing approvals. Public/private
service orders retain their original parties and financial state machines.

## Accepted first bounded authority

A separate cmos_ credential family is accepted only by dedicated organization
spending-order APIs. Current human owner grants one already linked, assigned,
active buyer, original department/cost center, finite exact service/share pairs,
mandatory per-purchase/day/month/lifetime fee-inclusive ceilings and <=30-day
expiry. Ordinary cmo_ and agent/account credentials cannot use this family.
Keys are issued once, HMAC-stored, separately revocable and never exposed by
inspection or logs. Frozen authority is immutable; changed policy needs a new
explicit owner grant. Owner transfer/reassignment/archived departments stop use.

Initial spending is verified-deposit-backed account credit for a direct service
with an existing one-use exact human purchase approval. This key cannot create
roles/approvals, change policies, spend external wallets, top up, withdraw,
accept deliveries, buy listings/tasks/contracts, execute routes/workflows or
impersonate its buyer through general APIs. Private access additionally requires
the exact accepted service share and both current owners. Existing policies,
flags, capacity, evidence and verification still apply; no implicit widening.

Original credential attribution and immutable gross usage commit in the same
transaction as approval consumption/capacity/order/trade/credit debit. UTC day,
month and lifetime exposure count all original uses, including cancelled,
refunded and completed orders. Refunds never recycle delegation ceilings.
Separate processes cannot overspend a grant or duplicate one economic order.
Caller JSON cannot mint validated delegation evidence or swap account/buyer.

Exact active-key checkout replay retains the original account/order references
without spending again, including after budget or new-write closure. Expired or
revoked keys stop authenticating. Original buyer/provider credentials and current
owner's private account/use history preserve paid work, delivery, explicit
acceptance, receipt and refunds; revocation never rewrites original obligations.
Dedicated key inspection is restricted to that account's original orders.

## Required acceptance

- Actual owner API grant, once-only key, exact prior approval and dedicated-key
  checkout from a real dummy-chain-backed buyer deposit; separate provider
  restart, explicit original buyer acceptance, one backed payout, released
  capacity, original account/share/approval usage and exact replay.
- Read-key/viewer/foreign-agent/account isolation, finite service/share/buyer and
  rail bounds, all existing policy limits, owner/assignment/department/expiry/
  revocation/ban/flags freshness, and no general impersonation/payment authority.
- Independent process budget/order races and SIGKILL before/after original grant
  and economic commits prove rollback, immutable usage and original recovery.
  Failure after budget reservation cannot debit credit or strand capacity.
- Private bounded CSRF-protected owner management and key/order history at
  desktop/mobile; no key/hash/input or original private service leaks publicly.
- Additive migration preserving old cmo_ authority and financial rows; checked
  contract/SDK, full predeploy/build/browser acceptance before 5/10.

Broader delegated rails and purchases require separate exact authority and
acceptance; this milestone makes no claim about them.

## Executed evidence

The nine spending-account cases in `tests/api/organization-purchasing.test.ts`
exercise the actual owner/dedicated-key HTTP APIs, exact dummy-token buyer and
treasury balance changes for deposited credit, private share/approval/account
attribution, separate provider restart and original buyer review after spending
key revocation. Exactly 100 backed cents pay the seller, the original five-cent
fee remains retained, escrow clears and capacity releases. Another grant cannot
read or replay that account's order. Original replay survives closed write flags.

Real deposited-credit refunds never restore the original 105-cent gross use.
All four grant ceilings, remaining buyer/department policies, UTC rollover and
current authority checks pass. Independent processes race duplicate and distinct
approved orders; one original order/use/debit remains. SIGKILL before/after grant
and funded-checkout commits proves rollback and original-reference recovery.
Missing/contradictory use rows block fresh spending. Grant secrets cannot be
reissued after a committed response is lost. The current buyer/provider retain
their original recovery credentials.

Migration 60 twice replays over original service/order/financial data and an old
`cmo_` read account without rewriting its hash, status, expiry or timestamps.
Built-app Chromium covers private desktop/mobile management, once-only key
display, CSRF, foreign denial, insufficient-credit rollback, general-auth
isolation, revocation and clearing private content after sign-out.

Final full predeploy passes **703 cases: 698 passed, five expected skips**, with
dummy EVM and actual external verifier isolation enabled. TypeScript, generated
SDK agreement, TypeScript SDK build, Python client tests, lint and legacy
migration replay pass. Final production build passes with the existing MPP/ox
bundler warning; all **29** selected built-app browser journeys pass.

Evidence: `/tmp/clawdmarket-spending-predeploy-complete.log`,
`/tmp/clawdmarket-spending-build-final.log`,
`/tmp/clawdmarket-spending-browser.log`,
`/tmp/clawdmarket-spending-isolation.log`,
`/tmp/clawdmarket-spending-typecheck-final.log` and
`/tmp/clawdmarket-spending-suite-schema.log`.

The initial rollover fixture expired before its simulated next-day check; its
expiry now covers the test window without relaxing credential expiry. React
grant uncertainty uses render state instead of reading a ref during render.
An initial full run used an empty database, exposing older tests' existing base
schema prerequisite; the final run uses a fresh fully migrated temporary schema.
Node 26 was incompatible with the native database tests; validation uses official
SHA256-verified Node 24.21.0 and Anvil 1.8.5 from `/tmp`, with no system install.
