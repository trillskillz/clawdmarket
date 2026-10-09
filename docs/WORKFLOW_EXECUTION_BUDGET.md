# Workflow execution budget foundation

This internal implementation extends the local owner-review foundation. It is
not a public workflow executor or an acceptance-complete P2.1 capability. The
public contract still advertises `execution_available: false`. Production
activation stays closed; no new production configuration is needed or enabled.

`activateWorkflow` requires the current linked owner, exact approval ID and
contract hash, a bounded immutable reference, version 1, and the separate explicit
`authorize_spending: true` decision. Review alone never grants spending authority.
The internal local flag `CLAWDMARKET_WORKFLOW_EXECUTION_ENABLED=true` is also
required. Vercel environments remain closed. A local production-mode test server
may use only a guarded disposable file database with a blank authentication token.

Activation persists one common start/deadline, at most sixteen node records and
stable planned child-route UUIDs before creating a child or economic order.
Exact replay preserves the original clock and references, including after expiry,
revocation or cancellation. Replay does not authorize a fresh payment. Other
owners and different activation parameters cannot reuse that reference.

`prepareWorkflowNode` can prepare roots only. Every dependent remains blocked
until current accepted/backed prerequisite evidence and private recipient grants
are implemented. Roots inherit frozen static input, objective, capabilities,
provider requirements, explicit buyer acceptance, rail/token terms, attempt and
retry ceilings. Candidate seller account IDs are resolved from actual eligible
services. Each child has its own exact route-bound mandate, route and terms hashes,
and an absolute deadline anchored to the original workflow start. Preparing a
child creates no order or payment. Saved preparation can be recovered privately
while fresh execution is closed.

The existing checkout transaction reserves capacity, complete fee-inclusive buyer
cost, spending/organization policy, mandate and funding records, parent/node gross
cents and an append-only workflow attempt record atomically. A late failure rolls
all those writes back. Workflow transactions dispose the client after lock
failures and retry with fresh clients; the shared legacy financial pool is
unchanged. Persistent contention returns a retryable 503 for the same reference.

Chain-fee exposure uses separate native EVM or explicit Tempo fee-token integer
units. Each attempt reserves its entire reviewed fee ceiling. Calculations use
BigInt and text counters, never floating point or SQLite integer casts. Before
fresh work, ledger rows must reconcile exactly to parent/node counters, hashes,
original order/trade references and consecutive bounded attempt numbers. Refunds,
cancellation and uncertain broadcasts never recycle either gross envelope.

Existing exact confirmed refund reconciliation is required before another paid
attempt. Existing payment intents, wallet claims, proofs, payouts and refund
recovery retain their original identities and state machines. Fresh reservations
and funding eligibility additionally recheck owner links, immutable plan/child
contracts, approval state/expiry, cancellation, routing pause, configured token
terms, exact economic reservation and sufficient remaining runtime. The common
clock cannot restart when a later child or retry is funded.

Tests use disposable SQLite files and dummy keys only. They exercise real
checkout/retry APIs, independent-process activation/preparation and simultaneous
child reservations, fee-inclusive totals, beyond-64-bit fee units, late rollback,
missing mandates, immutable contracts, revocation/transfer/pause, funding records,
exact mocked refund proof and deadline preservation. These are foundation tests;
they do not demonstrate a complete multi-node provider/settlement loop.

Next: exact accepted and currently backed dependency evidence, selected-provider
private artifact grants, durable executor/crash recovery and aggregate economic
reconciliation. The full audit acceptance gate remains required before counting
or publishing the workflow capability.
