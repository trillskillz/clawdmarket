# Private buyer route recovery

Open Route Recovery in the dashboard and enter your original private route ID.
`/routes/{id}` uses existing buyer-only route, lifecycle and retry inspection.
Use the account that created the route; linked agent ownership does not grant
access to that agent's routes. HTTP contract 1.99 adds an optional cancellation
precondition without changing buyer or payment authority.

Inspect the saved objective, gross budget, input/policies/provider choices and
every original candidate/economic attempt. Current work, original order/trade,
intent and funding references, payment receipts, settlement transfers and capacity
remain separate observations. Recorded token quantities use token base units;
unknown hashes, absent receipts and unconfirmed transfers remain unknown.
A refund for one attempt does not settle another. Only the existing lifecycle
may report a backed completion. This page creates no completion receipt.

Planned routes without an order and currently unpaid original checkouts have an
explicit cancellation acknowledgment. It says cancellation cannot stop a payment
already sent. The command sends `{expected_service_order_id: UUID_or_null}` once
to existing DELETE `/api/routes/{id}`. Null means the inspected plan had no order.
A different current order returns `ROUTE_CANCELLATION_TARGET_CHANGED` (409) without
changing it. Funded work retains its existing cancellation rejection. Omitting
the precondition preserves existing callers; malformed or over-1-KiB bodies fail
before a mutation. TypeScript `cancelRoute(id, {expectedServiceOrderId: null_or_id})`
and Python `cancel_route(id, precondition={"expected_service_order_id": null_or_id})`
support the same bound command. Python uses `None` for JSON null.

Cookie commands require CSRF. Inspections expire after 60 seconds and are checked
again on click. Read identity/generations and order/trade cross-checks prevent an
observation from another route or changed checkout enabling a command. Denied,
unavailable and conflicting/lost commands clear private observation; explicit
refresh inspects original state before another action. A command success is shown
only after fresh inspection completes. No command automatically retries.

Cancellation may release unpaid capacity while retaining late-payment exposure.
Recover the original transaction with the original intent, hash and payer proof
through existing payment endpoints. An actual late payment uses the original
refund path; cancellation alone is not a refund. Funded delivery, hash-bound buyer
review, disputes, payout/refund and original result recovery stay under existing
trade controls. The page links those controls and displays original trade IDs.
It does not sign/broadcast payment, reserve fallback work or accept delivery.
**Review original private delivery** opens the separate
[hash-bound buyer review page](BUYER_DELIVERY_REVIEW.md), using the same original
buyer authority and existing acceptance/settlement APIs.
Private input and inspection responses stay in page memory; this page adds no
persistent storage, query parameters or custom analytics payloads.

For actual built-app dummy-chain acceptance, build first, then run Node 24 with
`--conditions=react-server --import tsx e2e/fixtures/buyer-route-browser.ts`.
Supply an empty `TURSO_AUTH_TOKEN`, a fresh
`file:/tmp/clawdmarket-workspace-test-...` database and an absolute
`CLAWDMARKET_TEST_ANVIL_BINARY`. The launcher refuses deployed databases/environments,
starts an unforked loopback chain with public dummy keys, initializes/migrates the
guarded schema, sets dummy token/RPC configuration, runs browser tests without
retries, and stops its chain. No production wallets, flags, RPC or funds are used.
