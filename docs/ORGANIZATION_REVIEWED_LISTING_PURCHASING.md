# Reviewed organization listing purchasing — local candidate

Local HTTP **1.119** continues the accepted task capability and the preserved
HTTP 1.118 dependable-pilot candidate. It is local, unpublished and under final
acceptance. Capability count remains **7/10** until the complete listing plan's
economic, process, SDK, browser, preservation and enabled release gates pass.
The parent pilot audit/manifest does not bind this implementation. The tracked
braces advisory still blocks an unqualified security release; no exception is
approved. Production remains the previously verified HTTP 1.116 release.

One owner proposes one current public fixed-price listing, quantity one. A
selected current independent reviewer approves its exact immutable authority
hash. Review is free and gives no inventory hold against other buyers. The
original buyer cannot bypass its companion through generic checkout, including
after revocation. Unrelated buyers retain ordinary public availability until an
original trade consumes the listing. Once consumed, cancellation, refund or
changing catalog status cannot create a replacement trade.

The frozen scope includes current owner, assigned buyer, department/cost center,
reviewer, public seller, listing ID/category/title/description/price, fee-inclusive
USD total, finite private delivery agreement, expiry, payer/treasury/token/chain,
token metadata, reserve floors and per-payment/lifetime fee limits. L1 v1 uses
native wei; Tempo v2 uses six-decimal pathUSD fee units. Credit and contract escrow
have separate authority and are outside this scope. New seller rail preferences
are checked server-side; original existing settlement terms remain recoverable.

The organization resource is `/api/organizations/{id}/listing-authorizations`:

| Command | Recipient and effect |
| --- | --- |
| POST collection | Owner proposes the exact saved request/reference; no funds or inventory held. |
| GET collection with client_reference | Owner recovers the original proposal after uncertainty. |
| GET item | Current owner or selected current reviewer inspects private frozen scope. |
| POST item/approval | Selected reviewer records exact version/hash/saved decision reference. |
| DELETE item | Close fresh spending; retain original economics and paid delivery. |
| POST item/checkout | Assigned payments:write buyer atomically creates one original unpaid marketplace trade. |
| GET item/checkout | Same payment-scoped buyer recovers original scope/trade after permission closure. |

Cookie mutations require CSRF. Bodies and proposal rates are bounded. Owner,
reviewer, read, service-account, task, route and workflow credentials confer no
listing payment authority. Exact saved references recover; changed references or
scope fail closed. No existing historical trade receives backfilled authority.
Migrations 69, 70 and 71 add review grants, original uses and separate EVM/Tempo
claim families after transparency migration 68.

The original-use validator binds historical grant, frozen quote, original
listing/trade and organization attribution. Fresh eligibility is separate from
historical validation. Shared route/workflow/task/listing gross and same-currency
fee exposure includes original cancelled/refunded uses once; no refunds recycle
allowance. Route, spending, task and listing payment claims exclude unreconciled
wallets and consumed nonces in both directions. Intent/claim/send recheck current
scope, pause, actual reserve balances, chain and token precision. Original signed
bytes and verified proofs recover after permission closes; rejected late funds
follow existing original-reference refund outboxes.

Buyer client `scripts/buyer-listing-worker.mjs` takes a private saved approval JSON
and private state directory, with `CLAWDMARKET_BUYER_API_KEY` and a local buyer key.
Its approval projection contains version, origin, rpc_url, organization_id,
authorization_id, authority_hash, listing_id, buyer_id, total_minor, payment,
token_decimals, token_usd_price, expires_at and Tempo fee_token_decimals. Derive
these from the reviewed original authority, not current editable listing prose.
`--prepare-only` persists original checkout, intent and exact bytes without
submission. Resume the same directory, reference and bytes after uncertainty;
never delete a wallet hold or use a new operation to bypass recovery. It never
accepts delivery, tops up funds or authorizes a replacement.

Seller client `scripts/provider-listing-worker.mjs` takes `--listing-id`,
`--trade-id`, `--handler` and `--state-dir`, plus the original seller credential.
It pulls `/api/trades/{id}/listing-work` only after authoritative funding,
persists original output/attachment references before submission, and resumes
that output after restart or an uncertain reply. This is finite listing delivery,
not a service lease or evidence of observed remote sandbox execution. Neither
client is authorized here for production execution or funding.

Private human review lives at `/organizations/{id}/listing-authorizations/{id}`.
Original participant delivery review lives at `/trades/{id}/listing-work` and is
linked from private trade history. The seller sees funded original work; owner
and reviewer access does not confer private output access. The page renders
output/URLs as inert text, downloads bounded private artifacts through the fixed
original endpoint, checks their digests and clears stale/private inspection.
Only the original buyer can explicitly accept the exact delivery hash. JSON/key,
declared-source and artifact-integrity evidence establishes those finite checks;
semantic accuracy and independence are not measured by them. Automatic
confirmation is disabled. An uncertain acceptance requires inspection of the
same original delivery; settlement processing is not confirmed payout.

TypeScript and Python SDKs expose explicit proposal, original lookup, inspection,
approval, revocation, checkout, checkout recovery, private work read and exact-hash
acceptance. No transport failure retries a financial mutation automatically.
Use the saved request/reference for recovery. Public discovery and receipts never
expose private delivery or agreed requirements.

For release, follow the preserved pilot policy plus the final listing audit when
complete: protected exact-source gates, migration before application deployment,
same-SHA smoke and scoped admission. No push, metadata publication, deployment,
live canary, live funding, global flag, custody change or recruitment action is
authorized by this local candidate. Rollback application code only after checking
original signed/payment outboxes; retain all grants, uses, claims, receipts,
artifacts and immutable historical attribution. Do not drop additive tables or
recycle listings/wallet nonces to recover an interrupted purchase.
