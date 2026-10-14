# Prepared paid canary — no live execution authorization

This is a reviewable proposal, not an executed payment or successful canary.
Do not run production funding or acceptance commands until explicitly authorized.
Use dedicated, already operator-controlled identities and classify both principals
as platform_canary. Do not register customers or providers, alter custody, change
global execution flags, or count this activity as independent adoption.

## Separate operational evidence

The [operating record](DEPENDABLE_PILOT_OPERATING_RECORD_2026-10-14.json) retains
separate slots for configuration, RPC, treasury reserves, worker health,
payout/refund anomalies, paid canary and independently attributable activity.
`updateOperationalEvidence` updates exactly one slot and requires original funding,
payout and accepted-delivery references for an observed paid-canary record.
It composes records; it cannot verify a chain or manufacture a successful canary.

Fresh read-only evidence: production serves HTTP 1.116; ready/config and both RPCs
pass, credit is nonredeemable, email reset is unconfigured. The current payment
monitor run 38629505398 measures readiness and RPC, not a paid journey, treasury
reserves, worker freshness or outstanding refund anomalies. A separate read-only
Base RPC observation at 2026-10-14T21:40:54.381Z found treasury native balance
0.000100205551108468 ETH, above the existing 0.00005 ETH floor. This does not
establish token liabilities, Tempo reserves, worker freshness or the absence of
outstanding anomalies; those remain unmeasured here.
The October 11 paid run 38153085972 stopped because its buyer lacked 0.01 USDC.
No newer paid-canary run appears in the inspected workflow history. This does not
prove the wallet's balance is unchanged or that no historical canary ever passed.

Review-only operator commands, using existing approved read-only credentials:

```sh
node scripts/prod-payment-rails-preflight.mjs
node scripts/prod-route-operator-preflight.mjs
```

Do not dispatch these workflows, print credentials or export production data as
part of local preparation. A successful result refreshes only its operational
slot. It cannot refresh last_successful_end_to_end_at or customer activity.

## Proposed exact order and funding cap

One Base USDC order, provider price **$0.02**, existing 5% fee rounds to **$0.00**,
checkout total **$0.02** (20,000 USDC base units). Reject any different server
quote. No retries or fallback providers; max_attempts=1, max_retry_budget=0.00,
max_aggregate=0.02 and max_per_execution=0.02. One explicitly approved provider,
capacity one, a five-minute objective deadline, explicit buyer_review plus schema.

Maximum proposed **new buyer funding**: 0.02 Base USDC plus at most 0.00005 Base
ETH, reduced by any already available dedicated buyer funds. Do not transfer that
amount now. The mandate's `max_gas_cost_wei=50000000000000` caps the buyer's signed
execution fee; reserve values must also be pinned and reviewed. Exact top-up
requirement needs a fresh read of the dedicated buyer's token and native balances.
At 2026-10-14T21:40:54.381Z, the dedicated buyer held **0.005573 USDC** and
**0.002753001248135033 ETH**. The proposed maximum new top-up at that observation
is exactly **0.014427 USDC and zero ETH**. This read did not sign or broadcast any
transaction. Refresh balances and pending original references before authorization;
if balances already suffice then, no top-up is needed. Never sweep unrelated balances.

Observed public addresses (not signing permission): buyer
`0x3324B8045c88c163eCf7a4C596610814cdF0dC8C` from the failed dedicated-canary
workflow; treasury `0x3E911a2EaFbE60ca538F659836d6DE60Db639D44` from public payment
configuration; Base USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (six decimals).
The operator must confirm current control and exact approved identities/mandate
before funding; neither a public address nor this balance read authorizes a send.

Treasury settlement reserves are separate from buyer funding. The existing
preflight requires at least 0.00005 Base ETH; the Tempo alternative would require
at least 0.10 pathUSD, but this proposal executes only Base. No treasury top-up is
authorized. Record a fresh payout/refund fee quote before approving live execution.
The ordinary treasury outbox currently chooses fees during transaction preparation;
the buyer mandate cap does **not** cap treasury outbox fees. A total treasury-fee
cap must be separately reviewed/enforced or explicitly authorized before a live
canary can be described as having that total cost bound. Do not claim the buyer
fee cap covers both parties' transactions.

## Checkpoints and original-reference recovery

1. Freeze an original route request/reference, exact schema/input hashes, provider,
   caller identity and current readiness observations in the restricted operations
   directory. Use only scoped existing canary permission; if closed, stop.
2. Inspect the original route, then obtain the current owner's exact existing
   mandate binding route/request/terms, identities, rail/token/payer/treasury,
   reserve/cost ceilings and expiry. Preserve route ID, mandate ID and terms hash.
3. Write the exact approval file and use a dedicated durable state directory.
   Review unpaid checkout and exact quote before granting wallet execution.
4. After separate live-payment authorization, run one restartable buyer pass:

   ```sh
   node scripts/buyer-route-worker.mjs /secure/canary/approval.json /secure/canary/state
   ```

   Credentials remain in the existing secure environment, never command text,
   artifacts or analytics. This command **can fund a trade** when a funded mandate
   and wallet credentials are present; it was not run against production here.
5. Inspect original trade, funding intent/claim, transaction hash and confirmed
   receipt. Run the existing selected provider worker only after funded readiness.
   Do not create a second order when a transport result is uncertain.
6. Inspect the exact delivered artifact and finite schema results. Write an
   explicit decision file binding version 1, original route_id, decision=accept,
   and that exact content_hash. After authorized review, resume:

   ```sh
   node scripts/buyer-route-worker.mjs /secure/canary/approval.json /secure/canary/state /secure/canary/decision.json
   ```

7. Confirm the original terminal trade/order, exact accepted hash, funding and
   payout hashes, chain/token/amount, immutable route receipt, released capacity,
   native fee evidence and expected balances. Only then record paid success.

On any uncertain result, preserve the approval, state journal, IDs and hashes;
rerun the same worker against the same files. The existing durable claim/journal
recovers the original nonce/transaction and cannot authorize a replacement send
from a lost reply. Revocation/expiry blocks fresh sends; already-sent proof and
late-payment refund recovery keep their original references. Stop admission on
refund/payout anomalies. Do not rerun the older convenience script with a new
timestamp-based reference as a substitute for original-reference recovery.

## Expected terminal balances

Record initial balances first. Successful delivery and confirmed payout:

- Buyer USDC: initial minus exactly 0.02; buyer ETH: initial minus actual signed
  transaction fee, at most its 0.00005 mandate ceiling.
- Seller USDC: initial plus exactly 0.02; platform USDC fee: exactly 0.00.
- Treasury USDC liability from this order: zero after payout; native balance
  reduced by actual separately reviewed settlement fee. No lingering escrow,
  active service slot or outstanding payout/refund transfer.

Cancelled-before-send: no token movement. A valid late payment after cancellation
returns exactly the original 0.02 USDC through the original refund outbox after
confirmation; native transaction costs remain spent and must be reported.
Do not infer refunds or terminal balances merely from status flags.

Disposable local acceptance exercises complete economic journeys on unforked
Anvil and pinned Tempo infrastructure, including explicit acceptance, confirmed
payouts, late refunds, crashes and original-reference recovery. These tests use
public dummy keys and controlled fixtures. They are not a live production canary
or independent customer activity. Final evidence belongs in the release audit.
