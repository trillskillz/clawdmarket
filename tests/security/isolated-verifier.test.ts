import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:http'
import { runIsolatedVerification } from '../../scripts/isolated-verifier.mjs'
import { assertResourceControls } from '../../scripts/verifier-sandbox-launcher.mjs'

test('verifier refuses unlimited or weakened effective kernel controls', () => {
  const limits = { memory: '134217728', swap: '0', tasks: '32', cpu: '100000 100000' }
  assert.doesNotThrow(() => assertResourceControls(limits))
  for (const [field, value] of [['memory', 'max'], ['memory', '268435456'], ['swap', 'max'], ['swap', '1'], ['tasks', 'max'], ['tasks', '64'], ['cpu', 'max 100000'], ['cpu', '200000 100000']]) {
    assert.throws(() => assertResourceControls({ ...limits, [field]: value }), /VERIFIER_RESOURCE_LIMITS_UNAVAILABLE/)
  }
})

test('real external isolation denies host files, secrets and network, and bounds runtime/output/resources', { skip: process.env.CLAWDMARKET_TEST_ISOLATED_VERIFIER !== '1' }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'clawdmarket-verifier-host-secret-'))
  const secretPath = join(directory, 'secret.txt')
  await writeFile(secretPath, 'unavailable host secret', { mode: 0o600 })
  const old = process.env.VERIFIER_HOST_SECRET
  process.env.VERIFIER_HOST_SECRET = 'unavailable environment secret'
  const server = createServer((_request, response) => response.end('host-only response'))
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const address = server.address() as { port: number }
  const hostUrl = `http://127.0.0.1:${address.port}`
  try {
    assert.equal(await (await fetch(hostUrl)).text(), 'host-only response')
    const run = (code: string, expected: unknown, runtime = 5, adapter: 'javascript_tests_v1' | 'javascript_static_v1' = 'javascript_tests_v1') => runIsolatedVerification({ code: Buffer.from(code), suite: { version: 1, cases: [{ id: 'bounded', args: [], expected }] }, adapter, maxRuntimeSeconds: runtime })
    const safe = await run(`import {readFile} from 'node:fs/promises'; export default async () => {
      let file = false, network = false;
      try {await readFile(${JSON.stringify(secretPath)}); file = true} catch {}
      try {await fetch(${JSON.stringify(hostUrl)}, {signal:AbortSignal.timeout(100)}); network = true} catch {}
      return {file, network, secret:process.env.VERIFIER_HOST_SECRET ?? null};
    }`, { file: false, network: false, secret: null })
    assert.equal(safe.status, 'passed')
    assert.equal((await run('export default () => {while(true){}}', null, 1)).status, 'failed')
    assert.equal((await run('export default () => "x".repeat(10000)', null)).failure, 'resource_limit')
    const memory = await run('export default () => {const values=[]; while(true) values.push(Buffer.alloc(16*1024*1024, 1))}', null, 3)
    assert.equal(memory.status, 'failed'); assert.notEqual(memory.failure, 'timeout')
    assert.equal((await run('throw new Error("must not execute during syntax check"); export default () => null', null, 5, 'javascript_static_v1')).status, 'passed')
    assert.equal((await run('export default ( => invalid', null, 5, 'javascript_static_v1')).status, 'failed')
    assert.equal(JSON.stringify(safe).includes('unavailable'), false)
  } finally {
    if (old === undefined) delete process.env.VERIFIER_HOST_SECRET; else process.env.VERIFIER_HOST_SECRET = old
    await rm(directory, { recursive: true, force: true })
    await new Promise<void>((done) => server.close(() => done()))
  }
})
