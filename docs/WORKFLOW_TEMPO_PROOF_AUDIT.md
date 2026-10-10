# Tempo workflow acceptance audit

This continues P2.1 from the production-verified HTTP 1.99 release in
[PR #253](https://github.com/trillskillz/clawdmarket/pull/253), SHA
`29204bbc66d93fc2e0be494edcbb72dd00b4a2da`. The release passed required CI,
migration-first production deployment through ID 60, same-SHA smoke/monitoring,
and independent desktop/mobile private-access checks. The next local batch
began at 0/10; release bookkeeping does not count as an implementation part.

## Scope and evidence

The new [guarded helper](../tests/helpers/disposable-tempo-chain.ts) owns an
unforked Tempo 1.16.0 development node and canonical TIP-20 state. Official
archive checksum and GitHub SLSA provenance were verified before executing the
binary. Version, source digest, isolated database, empty Turso auth and loopback
boundaries are checked. The [fixture provenance/license](../tests/fixtures/chain/TEMPO_GENESIS.md)
records the source tag, commit and development hardfork limitation.

The existing financial drivers now exercise both EVM and Tempo, using real HTTP
handlers, scoped buyer credentials, separate owner approval and actual separate
buyer/provider processes. No application or contract behavior changed. The
Tempo SDK's synchronous original-byte broadcast is included in the RPC proxy's
existing transfer counter and crash boundary.

| Gate | Evidence |
| --- | --- |
| Two-node process recovery | `/tmp/clawdmarket-tempo-workflow-focus-final.log`: two private dependent nodes, four distinct confirmed TIP-20 transfers, original process-death/response-loss recovery, 210 gross buyer cents, 200 seller payout cents, one aggregate receipt and no unresolved money/capacity. Independently checked buyer/treasury fee units were 192/488 for this deterministic run. |
| Original refund before fallback | `/tmp/clawdmarket-tempo-workflow-refund-focus.log`: fresh chain and its own separate ledger/process, declined prerequisite, dependent blocked, exact confirmed refund before approved fallback, original common deadline, three attempts/six transfers, gross 315 cents, refund 100, payout 200, retained fees 15, no unresolved money and no budget recycling. |
| Existing EVM gates | `/tmp/clawdmarket-tempo-workflow-predeploy-accepted.log` passes both existing real EVM two-node crash and refund/fallback cases alongside the new Tempo cases. |
| Shared test schema | `/tmp/clawdmarket-tempo-workflow-shared-schema.log`: complete shared schema and idempotent runtime migration replay; 60 IDs, SQLite integrity `ok`. No new migration. |
| Honest fees | At the original 1.99 checkpoint, each successful Tempo receipt had type `0x76`, canonical fee token and expected payer. Rounded fees matched token-balance deltas and the buyer ceiling while persisted observations stayed null. Local 1.104 adds supported original measurements; see the [fee audit](TEMPO_CHAIN_FEES_AUDIT.md). Historical complete receipts stay immutable. |

The runbook is [WORKFLOW_TEMPO_PROOF.md](WORKFLOW_TEMPO_PROOF.md).
Final Node 24 predeploy passed **711 cases: 706 passed, five expected skips**,
including real EVM/Tempo transfers, external isolation and legacy migration replay
through ID 60. TypeScript, SDK contract/build, 13 Python cases and lint passed.
Application code is unchanged from the production-verified build/browser release.
This completes local part **1/10**; the next nine parts remain required before
publishing the next batch.

## Corrected test setup

Initial focused attempts used a nonexistent `rail` DTO/record field; assertions
were corrected to the actual funding chain identity and stored `payment_rail`.
No application transition changed. Both complete Tempo paths then passed.

An initial combined matrix reused the first Tempo chain's durable treasury
nonce history against a second fresh genesis. The refund remained pending and
the financial assertions rejected it. The second case now owns a separate
process/database with its chain; no nonce or financial history is deleted to
simulate a confirmed refund. Its child runner removes inherited
`NODE_TEST_CONTEXT` and requires the executed success marker, so a nested runner
that returns no test output cannot silently pass.

The first full-gate invocation supplied a fresh shared database without the
tables expected by legacy moderation/agent API cases. That invalid setup was
stopped (exit 143) and is retained as
`/tmp/clawdmarket-tempo-workflow-predeploy.log`, not accepted evidence. A fresh
shared fixture was initialized and migrated twice before the final full rerun.
Its log is `/tmp/clawdmarket-tempo-workflow-predeploy-accepted.log`.

No live wallet funds, top-up, hosted-chain transaction, global rollout flag,
new PR or subsequent deployment was used for this local continuation. Mainnet
hardfork compatibility, independent provider/validator evidence, production
quality/calibration, paid canaries and broader delegated enterprise purchases
retain separate gates. Supported local sender-paid pathUSD observations are
covered by the later [fee audit](TEMPO_CHAIN_FEES_AUDIT.md); this historical
checkpoint alone did not establish them.
