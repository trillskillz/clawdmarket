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

test('Python adapter rejects unsupported contracts and oversized or nonfinite cases before execution', async () => {
  const options = { code: Buffer.from('def run(): return None\n'), adapter: 'python_tests_v1' as const,
    suite: { version: 1, cases: [{ id: 'one', args: [], expected: null }] }, maxRuntimeSeconds: 5 }
  for (const suite of [
    { ...options.suite, cases: [] },
    { ...options.suite, cases: Array(21).fill(options.suite.cases[0]) },
    { ...options.suite, cases: [{ id: 'one', args: [], expected: Infinity }] },
    { ...options.suite, cases: [{ id: 'one', args: [], expected: 'x'.repeat(8192) }] },
  ]) await assert.rejects(runIsolatedVerification({ ...options, suite }), /INVALID_VERIFIER_SUITE/)
  for (const code of [Buffer.alloc(0), Buffer.alloc(65537)]) await assert.rejects(runIsolatedVerification({ ...options, code }), /INVALID_VERIFIER_INPUT/)
  await assert.rejects(runIsolatedVerification({ ...options, maxRuntimeSeconds: 31 }), /INVALID_VERIFIER_INPUT/)
})

test('real Python isolation checks finite JSON without exposing expected answers, host files, environment or network', { skip: process.env.CLAWDMARKET_TEST_ISOLATED_VERIFIER !== '1' }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'clawdmarket-python-host-secret-'))
  const secretPath = join(directory, 'secret.txt')
  await writeFile(secretPath, 'private host file', { mode: 0o600 })
  const previous = process.env.VERIFIER_HOST_SECRET
  process.env.VERIFIER_HOST_SECRET = 'private host environment'
  const server = createServer((_request, response) => response.end('host-only'))
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const { port } = server.address() as { port: number }
  const run = (code: string, expected: unknown, runtime = 5) => runIsolatedVerification({ code: Buffer.from(code),
    adapter: 'python_tests_v1', suite: { version: 1, cases: [{ id: 'one', args: [], expected }] }, maxRuntimeSeconds: runtime })
  try {
    const safe = await run(`import os, socket, sys
def run():
    try:
        open(${JSON.stringify(secretPath)}).read()
        file = True
    except OSError:
        file = False
    try:
        socket.create_connection(('127.0.0.1', ${port}), timeout=0.1)
        network = True
    except OSError:
        network = False
    return {'file': file, 'network': network, 'secret': os.environ.get('VERIFIER_HOST_SECRET'), 'files': sorted(os.listdir('/input')), 'isolated': sys.flags.isolated, 'site_disabled': sys.flags.no_site}
`, { file: false, network: false, secret: null, files: ['args.json', 'harness.py', 'module.py'], isolated: 1, site_disabled: 1 })
    assert.equal(safe.status, 'passed')
    assert.equal(JSON.stringify(safe).includes(secretPath), false)
    const suite = { version: 1, cases: [{ id: 'nested', args: [{ text: 'ü', items: [true, null, 3] }], expected: { text: 'ü', items: [true, null, 3] } },
      { id: 'false', args: [false], expected: false }] }
    assert.equal((await runIsolatedVerification({ code: Buffer.from('def run(value):\n    return value\n'), suite, adapter: 'python_tests_v1', maxRuntimeSeconds: 5 })).passed_checks, 2)
    for (const source of ['def run(: invalid', 'def other(): return None', 'def run(): raise RuntimeError("PRIVATE_ERROR")', 'def run(): return float("nan")', 'def run(): return float("inf")', 'def run(): return {"not_json"}']) {
      const result = await run(source, null)
      assert.equal(result.failure, 'checks_failed')
      assert.equal(JSON.stringify(result).includes('PRIVATE_ERROR'), false)
    }
    assert.equal((await run('def run():\n    while True: pass', null, 1)).failure, 'timeout')
    assert.equal((await run('def run(): return "x" * 10000', null)).failure, 'resource_limit')
    const memory = await run('def run():\n    values = []\n    while True: values.append(bytearray(16 * 1024 * 1024))', null, 3)
    assert.equal(memory.status, 'failed'); assert.notEqual(memory.failure, 'timeout')
    const unavailable = await run('import site_package_that_is_not_installed\ndef run(): return None', null)
    assert.equal(unavailable.failure, 'checks_failed')
  } finally {
    if (previous === undefined) delete process.env.VERIFIER_HOST_SECRET; else process.env.VERIFIER_HOST_SECRET = previous
    await rm(directory, { recursive: true, force: true })
    await new Promise<void>((done) => server.close(() => done()))
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
