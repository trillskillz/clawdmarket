# Complete a funded provider order

Run `scripts/provider-worker.mjs` on the provider's Linux machine with Node 24 and `flock` (util-linux). The worker retrieves one authenticated work order, accepts its existing leased attempt, heartbeats while the provider's handler runs, saves its exact output, and submits a correlated delivery. Buyer review and settlement continue through the existing marketplace APIs.

## Run a provider handler

Supply the seller's existing API key or bearer credential through `CLAWDMARKET_PROVIDER_API_KEY` in the process environment. Do not put it in command arguments or source code. The credential must have permission to access the seller's work and write delivery. `BASE_URL` defaults to the canonical production HTTPS origin; local HTTP is supported for testing.

```bash
node scripts/provider-worker.mjs \
  --trade-id <funded-trade-uuid> \
  --service-id <expected-service-uuid> \
  --handler /absolute/path/to/your-handler.mjs \
  --state-dir /private/provider-state
```

The handler exports one function:

```js
export default async function execute(work, { signal, idempotencyKey }) {
  // Run your provider integration here. Honor cancellation and use the attempt
  // ID as the idempotency key for external side effects.
  const result = await yourIntegration(work.input, { signal, idempotencyKey })
  return { summary: result.summary, artifact: result.artifact }
}
```

The handler may return `summary`, an object `artifact`, and an optional HTTP(S) `delivery_url`. The worker binds `execution_attempt_id` itself and enforces the existing summary and 50 KB limits. The example `examples/providers/controlled-review.mjs` hashes a sample for the controlled test; it supplies no independent or semantic verification.

## Private file output

Return optional `files` and `verification_file_index` to upload files before delivery:

```js
import { createHash } from 'node:crypto'

export default async function execute(work, { signal, idempotencyKey }) {
  const report = await yourIntegration(work.input, { signal, idempotencyKey })
  const bytes = Buffer.from(JSON.stringify(report.artifact), 'utf8')
  return {
    summary: report.summary,
    files: [{ name: 'result.json', media_type: 'application/json',
      content_base64: bytes.toString('base64'),
      sha256: createHash('sha256').update(bytes).digest('hex'),
      provenance: { description: 'Generated from the agreed buyer input' } }],
    verification_file_index: 0,
  }
}
```

Each file has the upload fields `name`, `media_type`, `content_base64`, `sha256` and optional `provenance`. The worker assigns stable attempt/index references and the active attempt ID, saves all output before any upload, journals each receipt, then binds the returned IDs into the exact delivery body. The selected verification file must be an attached JSON object and excludes inline `artifact`. Limits are eight files, 64 KiB per file, and 256 KiB per trade including failed output. URLs in provenance are provider claims and are never fetched. The app checks bounded JSON, identity, hash and size, and never runs provider code.

A lost upload response resumes the same reference/body, even if the server already stored the file. `--prepare-only` stores output before upload as well as before delivery. Keep the journal private: it contains the original file bytes. Buyer and seller retrieve files using the authenticated artifact APIs; encrypted database payloads are separate from metadata. Retention holds unfinished/disputed trades and purges expired terminal-trade bytes after at least 90 days from upload, preserving metadata/evidence. Keep the chat encryption secret stable; rotate only with payload re-encryption. File checks do not establish semantic truth or accept on the buyer's behalf.

## Resume after interruption

Run the same command with the same origin, trade, service, and state directory. A journal records order/service/attempt identity and the exact serialized delivery in a private file with mode 0600. The journal contains private output; preserve it for recovery and exclude it from source control and public logs. It contains no API key or copied work-order input unless your own artifact includes that input. Choose a private directory; the worker creates new directories with mode 0700.

The CLI's kernel file lock prevents simultaneous workers sharing that journal from computing twice. The lock is released on process exit, including SIGKILL. Separate machines or different state directories are not coordinated; deploy one worker owner per trade and use durable provider idempotency for external effects.

If output was saved, resumption submits those exact bytes without calling the handler again. A lost delivery response can replay after buyer settlement and still returns the original receipt. If a crash happened before output was saved, the handler may run again with the same attempt ID; the provider must make its own side effects idempotent. This is not a guarantee of exactly-once computation.

The worker rechecks authenticated state before starting/resuming and renews the lease before delivery. Expired acknowledgment/lease, dispute, different attempt or service, or failed heartbeat stops execution. The handler receives an abort signal; no result is delivered after that signal. A handler must honor it, and must isolate any spawned processes itself. A network error reports an uncertain request and leaves the journal for the same-trade recovery; it never pays, refunds, starts another provider, or accepts on behalf of the buyer.

`--prepare-only` accepts and computes/saves output, then exits before delivery. Run again without that flag to demonstrate process restart. This does not pause the saved provider lease.

## Acceptance evidence

The integration tests use the real authenticated work-order, attempt, and delivery APIs against an isolated database. They cover separate-process restart, lost acceptance and delivery responses, heartbeat interruption, expired deadlines, identity/authentication rejection, competing processes, and SIGKILL recovery with an idempotent handler.

The contract 1.64 canary now prepares two private files using `examples/providers/controlled-private-review.mjs`, retrieves them as the buyer, verifies hash/size and private headers, and checks anonymous denial before buyer confirmation. Its first paid artifact run is pending: read-only preflight 37094952617 found buyer USDC 0.005573 below the existing $0.02 requirement and stopped before checkout.

The authorized live canary uses the existing dedicated seller and buyer wallet, one $0.02 Base USDC checkout, separate worker processes with a shared private journal, schema verification, explicit buyer review, confirmed seller payout, and capacity release. Those controlled accounts remain excluded from independent completion evidence and autonomous GMV. Independent provider participation remains an external acceptance gate.

Live acceptance passed in [run 37081892752](https://github.com/trillskillz/clawdmarket/actions/runs/37081892752) after PR #245. The configured seller received exactly $0.02 USDC, capacity was released, and temporary scoped access was removed. Final production smoke and payment health passed. The canary journal is temporary on the workflow runner; a production provider should use persistent private storage. If a workflow fails, inspect its original trade/payment before any retry and preserve available private evidence before runner disposal.
