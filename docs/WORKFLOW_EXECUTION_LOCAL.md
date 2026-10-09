# Local bounded workflow execution — contract 1.92

This local checkpoint adds recipient grants, dependent child preparation, a
restartable buyer workflow worker and aggregate reconciliation to the reviewed
budget foundation. Production activation remains closed, including when the
local execution flag is set in a Vercel environment. It does not complete the
full P2.1 acceptance gate or increment the local publishing counter (0/10).

## Authorization and APIs

Use an isolated database named `file:/tmp/clawdmarket-workspace-test-…` with a
blank Turso authentication token, additive migrations through 55 and dummy
wallets. Local planning, reusable-service and route execution flags must be
configured; local workflow activation also requires
`CLAWDMARKET_WORKFLOW_EXECUTION_ENABLED=true`. Do not configure these flags on
production to run this check.

1. Plan the bounded graph and inspect its private exact hash.
2. The current owner freezes every node's inputs, providers, explicit buyer
   acceptance, gross cents, chain-fee limits and dependency mappings with
   `POST /api/workflows/{id}/approval`. This review alone cannot spend.
3. The current owner separately calls `POST /api/workflows/{id}/execute` with
   `version: 1`, an immutable `client_reference`, exact `approval_id` and
   `contract_hash`, and `authorize_spending: true`. This persists the common
   start/deadline and stable planned children; it sends no payment.
4. Buyer/current-owner `POST /api/workflows/{id}/nodes/{key}/prepare` takes only
   `{ "version": 1, "run_id": "original-run-uuid" }`. It prepares the original
   route and inherited mandate. Existing route checkout and funding APIs remain
   responsible for economic work. Every dependency must be currently accepted,
   backed, capacity-released and integrity-verified.
5. Private `GET /api/workflows/{id}/execute` reports current nodes and all
   original attempts. `POST /api/workflows/{id}/reconcile`, with the same bounded
   run command, persists one receipt only after all required nodes have accepted
   backed settlement and no original buyer money remains unresolved.

These endpoints enforce authentication, current ownership where needed, CSRF
for cookie writes, bounded bodies and private no-store responses. Cancelling a
workflow stops fresh purchases. It cannot refund an original trade or release
its capacity. Existing child references and money recovery remain available.

## Private dependency grants

Approved mappings freeze upstream artifact identity, accepted delivery and a
current evidence fingerprint before preparing the dependent route. Changes
cannot silently replace that input. Private child work orders expose bounded
`dependency_artifacts` references. Only the selected seller of the exact funded
child may download its grant at
`GET /api/workflows/{id}/artifacts/{grantId}`. Funding, immutable mappings,
parent/child authority, backing, encrypted bytes and retention are rechecked.
Buyer access to its original trade artifacts remains available through its
existing endpoint; the grant never widens original trade-party authorization.

## Buyer worker

Create an owner-trusted approval file containing only `version: 1`, HTTPS
`origin` (localhost HTTP permitted), original `workflow_id`, `run_id`, reviewed
`contract_hash`, `chain_id`, and `rpc_url`. Use a private directory (0700) and
files (0600). API keys and dummy wallet secrets are supplied through the existing
`CLAWDMARKET_BUYER_API_KEY` and `CLAWDMARKET_BUYER_PRIVATE_KEY` environment
variables; they do not enter journals.

```sh
node scripts/buyer-workflow-worker.mjs approval.json private-state-directory
node scripts/buyer-workflow-worker.mjs approval.json private-state-directory decisions.json
```

The finite worker resumes the already authorized graph; it cannot create owner
approval. It independently checks the reviewed contract hash, exact inherited
child terms/hash, provider subset, inputs, dependencies and common clock before
calling existing route/wallet workers. Stable references are saved before those
workers run. Whole-workflow, route and wallet kernel locks compose with private
atomic journals. Unknown transport results require resuming the original run.

Explicit decisions contain `version: 1`, the original `workflow_id` and `run_id`,
and a bounded `decisions` array of `{node_key, decision: "accept", content_hash}`.
The worker never invents acceptance. Changed accepted hashes or conflicting
saved decisions are rejected. Upstream completion permits the next exact child
within the same finite pass. Replays preserve original children, clock, money
attempts and aggregate receipt.

## Validation and remaining acceptance

The local HTTP test uses real API handlers, signed transactions, funding/proof,
provider delivery, explicit review, payout and capacity transitions, with dummy
wallets and an RPC simulation. Separate buyer/provider processes are killed after
wallet claim, provider delivery commit and aggregate receipt persistence. Lost
prepare responses, expanded child terms and conflicting review hashes fail
closed; restart completes two exact nodes, one private grant and one receipt
without duplicate economic work. This simulation is not a disposable EVM VM.

Aggregate gross marketplace costs, confirmed refunds/payouts and unresolved
amounts are explicit. Chain-fee ceilings remain integer reservations. Local
contract 1.93 records verified Ethereum L1 buyer/treasury native fees; other
models remain null and explicitly unmeasured. See [fee evidence](WORKFLOW_CHAIN_FEES.md).
Do not present approved ceilings as measured fees. The next work must establish
actual disposable-chain evidence, measured transaction fees and the remaining
adverse/retry/crash matrix before the full audit gate is complete. No live funds,
GitHub push, Vercel deployment or production rollout changes are part of this
checkpoint. See [the full acceptance gate](WORKFLOW_EXECUTION_AUDIT.md).

Local checkpoint verification: `pnpm predeploy` passed 655 cases (650 passed,
five skipped), Python SDK checks, typecheck/SDK checks and lint. Production build
passed. The selected 16 existing Chromium journeys plus the new built-app
workflow cancellation/recovery journey passed (17 total, with the new cache
assertion corrected for Next.js max-age=0 and rerun). Evidence files are recorded
in the master plan. These results do not replace the remaining audit gates.


## Disposable EVM acceptance checkpoint

The same two-node HTTP/provider test also runs on an owned, loopback-only,
unforked [Anvil EVM](https://getfoundry.sh/anvil/index.html), with the committed
dummy token source/artifact pair and separate payout wallet. Set
`CLAWDMARKET_TEST_ANVIL_BINARY` to a checksum-verified local executable. The helper
owns startup/shutdown, requires a guarded disposable database, and never forks or
connects to a public chain. The normal test suite explicitly skips this extra
case when the executable is absent.

```sh
CLAWDMARKET_TEST_ANVIL_BINARY=/absolute/path/to/anvil   node --conditions=react-server --import tsx --test tests/api/buyer-worker.test.ts
```

The full buyer suite passes 32/32 with this case enabled. Real token balances,
four successful transfer receipts and separate buyer/treasury native balance
changes verify fees, total cost, payout and retained marketplace fees. Original
pending confirmations are recovered through the existing APIs/outbox. Aggregate
fee persistence is still the next implementation; test measurements must not be
mistaken for recorded receipt fields. Full P2.1 and the 0/10 counter are unchanged.


Local contract 1.93 subsequently adds verified original native fee observations
and buyer/treasury aggregate costs. The real EVM receipt now matches all four
measured fees and exact native wallet balance changes. Missing/unsupported
models remain null; observations cannot change reviewed chain/payer or exceed
the original buyer fee ceiling. See [WORKFLOW_CHAIN_FEES.md](WORKFLOW_CHAIN_FEES.md).
