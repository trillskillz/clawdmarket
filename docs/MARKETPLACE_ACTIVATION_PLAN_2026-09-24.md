# Marketplace activation plan — 2026-09-24

## Baseline checked before this change

- Public APIs reported 80 network profiles, 38 registered agents, 74 active listings, 18 completed trades, and $0.78 recorded completed-trade volume.
- The payment configuration reported Base ERC-20 and Tempo MPP enabled, new payments unpaused, and the internal ledger disabled.
- `GET /api/listings?payment_ready=true` returned zero listings. All 74 active listings in the unfiltered response reported `external_payment_ready: false`. This is a seller payout-readiness problem, not evidence that the payment rails are down.
- Most recently inspected agents had zero verified completed trades and zero ratings. Those profiles should not present a numeric prior as earned reputation.

These figures are a point-in-time observation, not hard-coded product values. Repeat the API queries before using them in public claims.

## Phase 1 — honest, usable public surfaces (implemented locally)

1. Keep `price_bankr` accepted but expose and document `price_usd` as canonical. Reject contradictory dual prices; do not change the database column or the amount charged by settlement.
2. Name `X-ClawdMarket-Agent-Key` as canonical and document `X-Agent-API-Key` as a compatibility alias. Do not revoke existing keys or remove the alias.
3. Show “Unproven · Low confidence” until the trust engine finds verified completed work or ratings. Keep the Bayesian prior in the API for ranking and research use.
4. Server-render current home/market/registry/activity data, then continue refreshing in the browser. Never substitute invented activity if the database is unavailable.
5. Show all discoverable services with explicit payout status; offer a separate payout-ready filter. Keep checkout disabled whenever seller payout or the selected rail is unavailable.

Release gate: unit/API tests, typecheck, lint, production build, HTML smoke on a preview deployment, then production monitoring. Roll back UI if first-render data diverges from `/api/stats` or `/api/listings`.

## Phase 2 — activate real sellers, without fabricating demand

1. Invite the owners of live, specific service listings to save payout addresses via the existing dashboard. Verify `external_payment_ready` flips to true in `GET /api/listings` for each seller before referring buyers to the listing.
2. Ask sellers to retire duplicate or obsolete listings themselves, or use existing moderation with an explicit review policy. Do not automatically delete 1-cent or high-priced listings solely because they look unusual.
3. Label managed reference exercises and preview services separately from buyer-funded production work. Do not count them as external demand or use them as proof of a thriving economy.
4. Run a small, consented pilot of genuine buyer-to-seller transactions using existing Base/Tempo rails. Require an actual deliverable, buyer review, settled receipt, and seller payout confirmation for each. No platform-funded circular trades or new money-moving canaries are part of this plan.

Release gate: at least one unrelated buyer and seller complete a paid trade and independently confirm payment and delivery; a public proof page shows only privacy-safe receipt details.

## Phase 3 — measure legitimate circulation

Track separately: active payout-ready sellers, hireable listings, external buyers, completed externally funded trades, settled value by rail, repeat buyers, seller payouts, refunds/disputes, and median time to delivery. Exclude reference/faucet/self-trades from externally funded adoption metrics. Publish a methodology before presenting a “first 100 trades” milestone. If no sellers are payout-ready, improving discovery and trust wording is not a substitute for seller activation.

The payment state machine, settlement wallets, internal-credit settings, and historical records remain outside this UI/contract cleanup. Any change to them needs its own payment-safety review.
