# Disposable multi-node Tempo workflow proof

This acceptance uses the existing HTTP 1.99 workflow, MPP funding, provider,
private artifact, buyer decision and settlement APIs. It adds a real local chain
proof; it introduces no endpoint, migration, authority or payment transition.

The [pinned fixture](../tests/fixtures/chain/TEMPO_GENESIS.md) comes from official
Tempo 1.16.0 development genesis. The helper checks the source digest and binary
version, uses fresh temporary storage and loopback endpoints, disables discovery
and IPC, and changes only the disposable genesis chain ID to 4217. Production
chain checks remain intact. The canonical pathUSD TIP-20 precompile mints only
test funds to public dummy buyer/treasury keys. All development hardforks are
active: this is application protocol evidence, not mainnet fork compatibility,
independent validators or independent provider quality.

`tests/api/buyer-worker.test.ts` shares the economic driver with the existing
disposable EVM cases. The Tempo worker uses its actual root-key transaction
format, memo-bound TIP-20 transfer, exact signed-byte inspection and canonical
MPP challenge/intent/claim. The real MPP SDK submits the original bytes through
`eth_sendRawTransactionSync`; hash-proof recovery checks the canonical receipt.
No successful transfer or financial state is injected into the database.

The two-node case kills actual buyer/provider processes after child preparation,
wallet claim, confirmed broadcast before its response, delivery, and before/after
aggregate receipt persistence. Restart preserves original route/order/payment,
delivery hash, private dependency grant, deadline, explicit buyer acceptance and
one backed receipt. A different downstream provider can read the exact granted
bytes but cannot download the original source trade artifact. Four distinct
confirmed transactions reconcile 210 gross buyer cents and 200 seller payout
cents, zero unresolved money and released capacity.

The adverse case funds a prerequisite whose provider declines. The dependent
stays blocked; the original dispute/refund confirms before a separately bounded
approved fallback. Closing workflow execution prevents a fresh retry while
preserving original reconciliation. The successful fallback's artifact binds the
dependent input. Three attempts and six distinct confirmed transactions reconcile
315 gross buyer cents, 100 refunded cents, 200 seller payout cents and 15 retained
marketplace cents. Refunds do not recycle gross exposure or chain-fee ceilings;
the common original deadline and exactly-once capacity release remain checked.

The second Tempo case owns a separate process/database as well as a fresh chain.
Reusing one SQLite treasury nonce history against a second fresh chain would
leave transactions pending; the test never deletes financial history to mask it.

Every original transfer receipt must be successful, type `0x76`, with canonical
pathUSD fee token and the expected payer. Independently calculated rounded
fee-token costs match exact buyer/treasury token-balance changes and the original
buyer fee envelope. The original local 1.99 checkpoint retained null marketplace
fee observations. Local 1.104 now also persists supported original sender-paid
pathUSD observations and reconciles buyer/treasury costs separately; see
[Tempo chain fees](TEMPO_CHAIN_FEES.md). Historical complete receipts stay
immutable. Approved ceilings never become measured fees, and production fork
compatibility retains its separate gate.

To run both real-chain economic matrices, first download official Tempo 1.16.0
and Anvil binaries and verify their release checksums/provenance. Then run with
Node 24 and empty remote database credentials:

```bash
TURSO_DATABASE_URL=file:/tmp/clawdmarket-workspace-test-tempo.db \
TURSO_AUTH_TOKEN= \
CLAWDMARKET_TEST_TEMPO_BINARY=/absolute/path/to/verified-tempo-1.16.0 \
CLAWDMARKET_TEST_ANVIL_BINARY=/absolute/path/to/verified-anvil \
node --conditions=react-server --import tsx --test \
  --test-name-pattern='workflow HTTP loop on disposable|disposable (EVM|Tempo) workflow reconciles' \
  tests/api/buyer-worker.test.ts
```

The same optional binary variables enable these cases in `pnpm predeploy`.
Before running that full suite against a new shared test database, initialize its
schema with `pnpm exec drizzle-kit push --force` and apply
`pnpm db:migrate:runtime`, using the same guarded local database URL and empty
remote auth token throughout. This matches CI: several legacy tests expect the
shared tables to exist. The workflow drivers additionally create their own
disposable databases.
Without a supplied verified binary, the corresponding real-chain case explicitly
skips. No live wallet funds, top-up, hosted RPC or production flag change is part
of this proof. Broader enterprise purchases and outstanding P0 production
participation/quality/canary prerequisites remain separate.
