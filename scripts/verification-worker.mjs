/** Run on the buyer-approved external verifier host, with bubblewrap and systemd user scopes. */
import { createHash } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { canonicalJSON, VERIFIER_ADAPTERS } from './verifier-contract.mjs'
import { runIsolatedVerification } from './isolated-verifier.mjs'

function fail(code) { throw new Error(code) }
const hash = (value) => createHash('sha256').update(value).digest('hex')
function origin(value) {
  const url = new URL(value)
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/'
    || url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) fail('INVALID_VERIFIER_ORIGIN')
  return url.origin
}
async function save(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${crypto.randomUUID()}.tmp`, file = await open(temporary, 'wx', 0o600)
  try { await file.writeFile(JSON.stringify(value)); await file.sync() } finally { await file.close() }
  try {
    await rename(temporary, path)
    const directory = await open(dirname(path), 'r')
    try { await directory.sync() } finally { await directory.close() }
  } finally { await unlink(temporary).catch(() => {}) }
}
async function readBounded(response, limit) {
  if (!response.body) fail('INVALID_VERIFIER_RESPONSE')
  const reader = response.body.getReader(), chunks = []
  let size = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > limit) fail('VERIFIER_RESPONSE_TOO_LARGE')
      chunks.push(Buffer.from(part.value))
    }
    return Buffer.concat(chunks)
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}
/** Callers serialize the private state file; the CLI takes a kernel flock. */
export async function runVerifierWork({ baseUrl = 'https://www.clawdmkt.com', apiKey, jobId, stateFile, fetcher = fetch }) {
  if (typeof apiKey !== 'string' || !apiKey.trim() || !/^[0-9a-f-]{36}$/i.test(jobId) || !stateFile) fail('INVALID_VERIFIER_CONFIGURATION')
  const base = origin(baseUrl), path = `/api/verification-jobs/${jobId}`
  const api = async (method, suffix = '', body) => {
    let response
    try { response = await fetcher(`${base}${path}${suffix}`, { method, redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${apiKey.trim()}`, Accept: suffix ? 'application/octet-stream' : 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body }) }) } catch { fail('VERIFIER_REQUEST_UNCERTAIN_RESUME_SAME_JOB') }
    if (!response.ok) fail(`VERIFIER_HTTP_${response.status}`)
    return readBounded(response, suffix ? 65536 : 32768)
  }
  let journal
  try { journal = JSON.parse(await readFile(stateFile, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') fail('INVALID_VERIFIER_JOURNAL') }
  if (journal && (journal.version !== 1 || journal.origin !== base || journal.job_id !== jobId)) fail('VERIFIER_JOURNAL_MISMATCH')
  const work = JSON.parse((await api('GET')).toString('utf8')), job = work.job
  if (!job || job.id !== jobId || !/^[a-f0-9]{64}$/.test(job.request_hash)) fail('VERIFIER_JOB_MISMATCH')
  if (journal && journal.request_hash !== job.request_hash) fail('VERIFIER_JOURNAL_MISMATCH')
  if (!journal) {
    if (job.state !== 'pending' || !work.test_suite || !(Date.parse(job.expires_at) > Date.now())
      || !VERIFIER_ADAPTERS.includes(job.policy?.adapter)
      || !Number.isInteger(job.policy.max_runtime_seconds) || job.policy.max_runtime_seconds < 1 || job.policy.max_runtime_seconds > 30
      || hash(canonicalJSON(work.test_suite)) !== job.policy.suite_sha256) fail('VERIFIER_GRANT_INACTIVE')
    const bytes = await api('GET', '/artifact')
    if (hash(bytes) !== job.artifact_sha256) fail('VERIFIER_ARTIFACT_HASH_MISMATCH')
    const report = await runIsolatedVerification({ code: bytes, suite: work.test_suite, adapter: job.policy.adapter, maxRuntimeSeconds: job.policy.max_runtime_seconds })
    journal = { version: 1, origin: base, job_id: jobId, request_hash: job.request_hash, report_body: JSON.stringify(report), receipt: null }
    await save(stateFile, journal)
  }
  if (typeof journal.report_body !== 'string' || Buffer.byteLength(journal.report_body) > 8192) fail('INVALID_VERIFIER_JOURNAL')
  const submitted = JSON.parse((await api('POST', '', journal.report_body)).toString('utf8'))
  const reportHash = hash(canonicalJSON(JSON.parse(journal.report_body)))
  if (submitted.job?.id !== jobId || submitted.job.report_hash !== reportHash || submitted.job.request_hash !== journal.request_hash) fail('VERIFIER_RECEIPT_MISMATCH')
  journal.receipt = { job_id: jobId, report_hash: reportHash, state: submitted.job.state }
  await save(stateFile, journal)
  return { ...journal.receipt, idempotent: submitted.idempotent === true }
}
async function cli() {
  const [jobId, stateDirectory] = process.argv.slice(2)
  if (!/^[0-9a-f-]{36}$/i.test(jobId) || !stateDirectory) fail('VERIFIER_JOB_AND_STATE_DIR_REQUIRED')
  const base = origin(process.env.BASE_URL || 'https://www.clawdmkt.com')
  const directory = resolve(stateDirectory)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const stateFile = resolve(directory, `${hash(`${base}:${jobId}`)}.json`)
  if (process.env.CLAWDMARKET_VERIFIER_LOCK_HELD !== stateFile) {
    const lock = await open(`${stateFile}.lock`, 'a', 0o600); await lock.close()
    const child = spawn('flock', ['--nonblock', '--conflict-exit-code', '75', `${stateFile}.lock`, process.execPath, fileURLToPath(import.meta.url), ...process.argv.slice(2)],
      { stdio: 'inherit', env: { ...process.env, CLAWDMARKET_VERIFIER_LOCK_HELD: stateFile } })
    child.on('error', () => { process.stderr.write('VERIFIER_FLOCK_REQUIRED\n'); process.exitCode = 1 })
    child.on('exit', (code) => { process.exitCode = code ?? 1 })
    return
  }
  process.stdout.write(`${JSON.stringify(await runVerifierWork({ baseUrl: base, apiKey: process.env.CLAWDMARKET_VERIFIER_API_KEY, jobId, stateFile }))}\n`)
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) cli().catch((error) => {
  process.stderr.write(`${/^[A-Z0-9_]+$/.test(error.message) ? error.message : 'VERIFIER_WORKER_STOPPED_RESUME_SAME_JOB'}\n`); process.exitCode = 1
})
