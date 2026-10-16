import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runOriginalContractCommand, validateOriginalContractCommand } from '../../scripts/contract-command-worker.mjs'

const id = () => crypto.randomUUID()
function command() {
  return { version: 1, action: 'fund', origin: 'http://127.0.0.1:1234', actor_id: 'buyer', buyer_id: 'buyer', seller_id: 'seller', contract_id: id(),
    organization_id: id(), authorization_id: id(), credit_terms_acknowledged: true, gross_minor: 105, principal_minor: 100, upfront_fee_minor: 5,
    milestone_ids: [id(), id()], body: { version: 1, client_reference: id(), authority_hash: 'a'.repeat(64) } }
}
const missing = () => Response.json({ code: 'CONTRACT_FUND_REFERENCE_NOT_FOUND' }, { status: 404 })
test('finite contract commands reject missing credit consent, role confusion, credentials, unsafe origins and unstable JSON before sending', () => {
  for (const change of [{ credit_terms_acknowledged: false }, { actor_id: 'seller' }, { api_key: 'NEVER_PERSIST' }, { origin: 'http://example.com' },
    { origin: 'https://user:secret@example.com' }, { gross_minor: 104 }, { body: { version: 1, client_reference: id(), authority_hash: 'a'.repeat(64), approve: true } },
    { extra: undefined }, { principal_minor: NaN }]) assert.throws(() => validateOriginalContractCommand({ ...command(), ...change }), /CONTRACT_COMMAND_/)
  const circular: any = command(); circular.body.loop = circular
  assert.throws(() => validateOriginalContractCommand(circular), /CONTRACT_COMMAND_INPUT_LIMIT/)
})
test('saved exact command survives uncertainty without an automatic POST; changed input and unavailable lookups cannot replace it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'clawdmarket-workspace-test-contract-worker-')), c = command(), calls: string[] = []
  const fetcher: typeof fetch = async (_url, options) => {
    calls.push(options?.method ?? 'GET')
    if (options?.method === 'POST') throw new Error('socket dropped before commit')
    if (String(_url).includes('?')) return missing()
    return Response.json({ contract: { id: c.contract_id, buyer_id: c.buyer_id, seller_id: c.seller_id, payment_rail: 'credit', total_amount: 1, fee_amount: .05, escrow_amount: 1.05 }, milestones: c.milestone_ids.map(id => ({ id })) })
  }
  try {
    await assert.rejects(runOriginalContractCommand({ command: c, apiKey: 'SECRET_TEST_KEY', stateDirectory: directory, fetcher }), /UNCERTAIN_RESUME_ORIGINAL/)
    assert.deepEqual(calls, ['GET', 'GET', 'POST']); calls.length = 0
    await assert.rejects(runOriginalContractCommand({ command: c, apiKey: 'SECRET_TEST_KEY', stateDirectory: directory, fetcher }), /MISSING_REQUIRES_EXPLICIT_RESUME/)
    assert.deepEqual(calls, ['GET']); calls.length = 0
    const read = await runOriginalContractCommand({ command: c, apiKey: 'SECRET_TEST_KEY', stateDirectory: directory, fetcher, reconcileOnly: true })
    assert.equal(read.state, 'awaiting_explicit_same_command_resume'); assert.deepEqual(calls, ['GET']); calls.length = 0
    await assert.rejects(runOriginalContractCommand({ command: { ...c, body: { ...c.body, authority_hash: 'b'.repeat(64) } }, apiKey: 'SECRET_TEST_KEY', stateDirectory: directory, fetcher }), /JOURNAL_MISMATCH/)
    assert.deepEqual(calls, [])
    await assert.rejects(runOriginalContractCommand({ command: c, apiKey: 'SECRET_TEST_KEY', stateDirectory: directory, fetcher: async () => Response.json({ code: 'busy' }, { status: 503 }), resumeMissing: true }), /HTTP_503/)
    const files = await readdir(directory), journal = files.find(path => path.endsWith('.json'))!
    const bytes = await readFile(join(directory, journal), 'utf8')
    assert.equal(bytes.includes('SECRET_TEST_KEY'), false); assert.deepEqual(JSON.parse(bytes).command, c)
    assert.equal((await lstat(join(directory, journal))).mode & 0o777, 0o600)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
test('funding quote mismatch stops before a financial write and prepare-only persists original command without POST', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'clawdmarket-workspace-test-contract-worker-')), c = command(); let writes = 0
  const fetcher: typeof fetch = async (url, options) => {
    if (options?.method !== 'GET') writes++
    if (String(url).includes('?')) return missing()
    return Response.json({ contract: { id: c.contract_id, buyer_id: c.buyer_id, seller_id: c.seller_id, payment_rail: 'credit', total_amount: 1, fee_amount: .06, escrow_amount: 1.06 }, milestones: c.milestone_ids.map(id => ({ id })) })
  }
  try {
    assert.equal((await runOriginalContractCommand({ command: c, apiKey: 'fixture', stateDirectory: directory, fetcher, prepareOnly: true })).state, 'prepared')
    await assert.rejects(runOriginalContractCommand({ command: c, apiKey: 'fixture', stateDirectory: directory, fetcher }), /QUOTE_MISMATCH/)
    assert.equal(writes, 0)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
