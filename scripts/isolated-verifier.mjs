/** External verifier host only. This module is never imported by app or lib code. */
import { createHash, randomUUID } from 'node:crypto'
import { spawn, execFile } from 'node:child_process'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual, promisify } from 'node:util'
import { canonicalJSON } from './verifier-contract.mjs'

const execute = promisify(execFile)
const sha = (value) => createHash('sha256').update(value).digest('hex')
const isolation = { kind: 'bwrap-systemd-v1', network_enabled: false, host_home_mounted: false, memory_limit_bytes: 134_217_728, task_limit: 32 }
const harness = `import { readFile } from 'node:fs/promises';
const args = JSON.parse(await readFile('/input/args.json', 'utf8'));
const { default: run } = await import('/input/module.mjs');
if (typeof run !== 'function') process.exit(2);
const result = await run(...args);
process.stdout.write(JSON.stringify(result));`

function validateSuite(suite) {
  if (!suite || suite.version !== 1 || Object.keys(suite).sort().join() !== 'cases,version' || !Array.isArray(suite.cases)
    || suite.cases.length < 1 || suite.cases.length > 20 || Buffer.byteLength(JSON.stringify(suite)) > 8192) throw new Error('INVALID_VERIFIER_SUITE')
  const ids = new Set()
  for (const entry of suite.cases) {
    if (!entry || Object.keys(entry).sort().join() !== 'args,expected,id' || !/^[A-Za-z0-9_-]{1,64}$/.test(entry.id)
      || ids.has(entry.id) || !Array.isArray(entry.args) || entry.args.length > 10) throw new Error('INVALID_VERIFIER_SUITE')
    ids.add(entry.id)
    for (const initial of [...entry.args, entry.expected]) {
      const pending = [{ value: initial, depth: 0 }]
      let nodes = 0
      while (pending.length) {
        const { value, depth } = pending.pop()
        if (++nodes > 512 || depth > 8 || value === undefined || typeof value === 'number' && !Number.isFinite(value)
          || !['object', 'string', 'number', 'boolean'].includes(typeof value)) throw new Error('INVALID_VERIFIER_SUITE')
        if (value && typeof value === 'object') for (const child of Object.values(value)) pending.push({ value: child, depth: depth + 1 })
      }
    }
  }
}

async function isolatedCommand(directory, command, timeoutMs) {
  const unit = `clawdmarket-verifier-${randomUUID()}`
  const args = ['--user', '--scope', '--quiet', '--collect', `--unit=${unit}`, '--property=MemoryMax=128M', '--property=MemorySwapMax=0', '--property=TasksMax=32',
    '--property=CPUQuota=100%', `--property=RuntimeMaxSec=${Math.max(1, Math.ceil(timeoutMs / 1000))}s`, '--property=TimeoutStopSec=1s',
    process.execPath, fileURLToPath(new URL('./verifier-sandbox-launcher.mjs', import.meta.url)),
    '--unshare-all', '--unshare-user', '--disable-userns', '--die-with-parent', '--new-session', '--cap-drop', 'ALL', '--clearenv',
    '--ro-bind', '/usr', '/usr', '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib64', '/lib64', '--proc', '/proc', '--dev', '/dev',
    '--tmpfs', '/tmp', '--dir', '/runtime', '--ro-bind', process.execPath, '/runtime/node', '--ro-bind', directory, '/input', '--chdir', '/input',
    '/usr/bin/prlimit', '--cpu=30', '--nofile=64', '--fsize=8192', '--', '/runtime/node', '--max-old-space-size=64', ...command]
  let output = Buffer.alloc(0), overflow = false, timedOut = false
  let stopping
  const stop = () => stopping ||= execute('/usr/bin/systemctl', ['--user', 'stop', `${unit}.scope`], { timeout: 5000 }).catch(() => {})
  const child = spawn('/usr/bin/systemd-run', args, { stdio: ['ignore', 'pipe', 'pipe'] })
  child.stderr.resume() // Private program errors never enter evidence or user-facing logs.
  const timer = setTimeout(() => { timedOut = true; void stop().finally(() => child.kill('SIGKILL')) }, timeoutMs)
  child.stdout.on('data', (chunk) => {
    if (output.length + chunk.length > 8192) { overflow = true; void stop().finally(() => child.kill('SIGKILL')); return }
    if (!overflow) output = Buffer.concat([output, chunk])
  })
  try {
    const code = await new Promise((resolveCode, reject) => { child.once('error', reject); child.once('close', resolveCode) })
    return { code, output, overflow, timedOut }
  } finally { clearTimeout(timer); await stop(); child.kill('SIGKILL') }
}

/** @param {{code: Buffer, suite: any, adapter: 'javascript_tests_v1'|'javascript_static_v1', maxRuntimeSeconds?: number}} options */
export async function runIsolatedVerification({ code, suite, adapter, maxRuntimeSeconds = 30 }) {
  validateSuite(suite)
  if (!Buffer.isBuffer(code) || !code.length || code.length > 65536 || !['javascript_tests_v1', 'javascript_static_v1'].includes(adapter)
    || !Number.isInteger(maxRuntimeSeconds) || maxRuntimeSeconds < 1 || maxRuntimeSeconds > 30
    || adapter === 'javascript_static_v1' && suite.cases.length !== 1) throw new Error('INVALID_VERIFIER_INPUT')
  const started = performance.now(), deadline = started + maxRuntimeSeconds * 1000
  const directory = await mkdtemp(join(tmpdir(), 'clawdmarket-isolated-verifier-'))
  let passed = 0, failure = null
  try {
    await writeFile(join(directory, 'module.mjs'), code, { mode: 0o600 })
    await writeFile(join(directory, 'harness.mjs'), harness, { mode: 0o600 })
    const probe = await isolatedCommand(directory, ['-e', 'process.stdout.write("isolated-verifier-ready-v1")'], Math.max(1, deadline - performance.now())).catch(() => null)
    if (!probe || probe.code !== 0 || probe.output.toString() !== 'isolated-verifier-ready-v1') failure = 'sandbox_failed'
    for (const entry of suite.cases) {
      if (failure === 'sandbox_failed') break
      if (performance.now() >= deadline) { failure = 'timeout'; break }
      await writeFile(join(directory, 'args.json'), JSON.stringify(entry.args), { mode: 0o600 })
      let result
      try { result = await isolatedCommand(directory, adapter === 'javascript_static_v1' ? ['--check', '/input/module.mjs'] : ['/input/harness.mjs'], Math.max(1, deadline - performance.now())) }
      catch { failure = 'sandbox_failed'; break }
      if (result.timedOut) { failure = 'timeout'; break }
      if (result.code !== 0 || result.overflow) { failure = result.overflow ? 'resource_limit' : 'checks_failed'; continue }
      if (adapter === 'javascript_static_v1') { passed++; continue }
      try {
        if (isDeepStrictEqual(JSON.parse(result.output.toString('utf8')), entry.expected)) passed++
        else failure = 'checks_failed'
      } catch { failure = 'checks_failed' }
    }
  } finally { await rm(directory, { recursive: true, force: true }) }
  const failed = suite.cases.length - passed
  return { version: 1, adapter, artifact_sha256: sha(code), suite_sha256: sha(canonicalJSON(suite)), status: failed ? 'failed' : 'passed',
    total_checks: suite.cases.length, passed_checks: passed, failed_checks: failed,
    elapsed_ms: Math.floor(performance.now() - started), failure: failed ? failure || 'checks_failed' : null, isolation }
}

async function main() {
  const [codePath, suitePath, adapter] = process.argv.slice(2)
  if (!codePath || !suitePath) throw new Error('VERIFIER_USAGE: node scripts/isolated-verifier.mjs CODE.mjs SUITE.json javascript_tests_v1|javascript_static_v1')
  const report = await runIsolatedVerification({ code: await readFile(resolve(codePath)), suite: JSON.parse(await readFile(resolve(suitePath), 'utf8')), adapter })
  process.stdout.write(`${JSON.stringify(report)}\n`)
  process.exitCode = report.status === 'passed' ? 0 : 1
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { process.stderr.write('ISOLATED_VERIFIER_FAILED\n'); process.exitCode = 1 })
