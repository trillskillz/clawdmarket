/** Run on the configured grader's host. Compares data only; never executes target code. */
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { mkdir, open } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { canonicalJSON } from './verifier-contract.mjs'
import { readBuyerPaymentJournal, saveBuyerPaymentJournal } from './buyer-payment-journal.mjs'

const hash = (value) => createHash('sha256').update(canonicalJSON(value)).digest('hex')
function fail(code) { throw new Error(code) }
function safeOrigin(value) {
  const url = new URL(value)
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/'
    || url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) fail('BENCHMARK_ORIGIN_INVALID')
  return url.origin
}
async function json(response) {
  if (!response.body) fail('BENCHMARK_RESPONSE_INVALID')
  const reader = response.body.getReader(), chunks = []; let length = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      length += part.value.byteLength
      // A grant can contain both a 64 KiB definition and a 64 KiB submission,
      // plus their metadata. Keep a bounded envelope with room for both.
      if (length > 262144) fail('BENCHMARK_RESPONSE_TOO_LARGE')
      chunks.push(Buffer.from(part.value))
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}
/** Caller serializes stateFile; the CLI takes a kernel lock. No automatic POST retry. */
export async function runTrustedBenchmark({ baseUrl, apiKey, runId, stateFile, fetcher = fetch }) {
  if (!/^[a-f0-9-]{36}$/i.test(runId) || typeof apiKey !== 'string' || !apiKey.trim() || !stateFile) fail('BENCHMARK_WORKER_CONFIGURATION_INVALID')
  const origin = safeOrigin(baseUrl), path = `/api/benchmark-runs/${runId}`
  const api = async (method, suffix = '', body) => {
    let response
    try { response = await fetcher(`${origin}${path}${suffix}`, { method, redirect: 'error', credentials: 'omit',
      signal: AbortSignal.timeout(10000), headers: { Authorization: `Bearer ${apiKey}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) }) } catch { fail('BENCHMARK_REQUEST_UNCERTAIN_RESUME_SAME_RUN') }
    if (!response.ok) fail(`BENCHMARK_HTTP_${response.status}`)
    return json(response)
  }
  const prior = await readBuyerPaymentJournal(stateFile)
  if (prior && (prior.origin !== origin || prior.run_id !== runId)) fail('BENCHMARK_JOURNAL_MISMATCH')
  const work = await api('GET'), run = work.run
  if (!run || run.id !== runId || !/^[a-f0-9]{64}$/.test(run.definition_hash) || !/^[a-f0-9]{64}$/.test(run.submission_hash)) fail('BENCHMARK_WORK_UNAVAILABLE')
  if (prior && (prior.definition_hash !== run.definition_hash || prior.submission_hash !== run.submission_hash)) fail('BENCHMARK_JOURNAL_MISMATCH')
  if (run.state === 'graded') {
    if (prior && hash(prior.report) !== run.report_hash) fail('BENCHMARK_RECEIPT_MISMATCH')
    return { run_id: runId, report_hash: run.report_hash, state: run.state, reused: true }
  }
  if (run.state !== 'awaiting_grading') fail('BENCHMARK_WORK_UNAVAILABLE')
  let journal = prior
  if (!journal) {
    const material = work.grading_material
    if (material?.adapter !== 'json_exact_v1' || !Array.isArray(material.cases) || material.cases.length !== run.definition?.case_count
      || material.cases.length < 1 || material.cases.length > 20 || !Array.isArray(material.submission?.outputs)
      || material.submission.outputs.length !== material.cases.length || hash(material.submission) !== run.submission_hash) fail('BENCHMARK_MATERIAL_INVALID')
    const outputs = new Map(material.submission.outputs.map(({ id, output }) => [id, output]))
    if (outputs.size !== material.cases.length || new Set(material.cases.map(({ id }) => id)).size !== material.cases.length
      || material.cases.some(({ id }) => !outputs.has(id))) fail('BENCHMARK_MATERIAL_INVALID')
    const report = { version: 1, adapter: 'json_exact_v1', definition_hash: run.definition_hash, submission_hash: run.submission_hash,
      cases: material.cases.map(({ id, expected }) => ({ id, passed: canonicalJSON(outputs.get(id)) === canonicalJSON(expected) })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) }
    journal = { version: 1, origin, run_id: runId, definition_hash: run.definition_hash, submission_hash: run.submission_hash, report }
    await saveBuyerPaymentJournal(stateFile, journal)
  }
  if (journal.report?.definition_hash !== run.definition_hash || journal.report?.submission_hash !== run.submission_hash) fail('BENCHMARK_JOURNAL_MISMATCH')
  const submitted = await api('POST', '/report', journal.report)
  if (submitted.run?.id !== runId || submitted.run?.report_hash !== hash(journal.report) || submitted.run?.state !== 'graded') fail('BENCHMARK_RECEIPT_MISMATCH')
  return { run_id: runId, report_hash: submitted.run.report_hash, state: 'graded', reused: submitted.reused === true }
}
async function cli() {
  const [runId, directoryArg] = process.argv.slice(2)
  if (!directoryArg || !/^[a-f0-9-]{36}$/i.test(runId)) fail('BENCHMARK_RUN_AND_STATE_DIRECTORY_REQUIRED')
  const directory = resolve(directoryArg), baseUrl = safeOrigin(process.env.BASE_URL || 'https://www.clawdmkt.com')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const stateFile = resolve(directory, `${hash({ baseUrl, runId })}.json`)
  if (process.env.CLAWDMARKET_BENCHMARK_LOCK_HELD !== stateFile) {
    const lock = await open(`${stateFile}.lock`, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW, 0o600)
    await lock.close()
    const child = spawn('flock', ['--nonblock', '--conflict-exit-code', '75', `${stateFile}.lock`, process.execPath, fileURLToPath(import.meta.url), ...process.argv.slice(2)],
      { stdio: 'inherit', env: { ...process.env, CLAWDMARKET_BENCHMARK_LOCK_HELD: stateFile } })
    child.on('error', () => { process.stderr.write('BENCHMARK_FLOCK_REQUIRED\n'); process.exitCode = 1 })
    child.on('exit', (code) => { process.exitCode = code ?? 1 })
    return
  }
  process.stdout.write(`${JSON.stringify(await runTrustedBenchmark({ baseUrl, apiKey: process.env.CLAWDMARKET_BENCHMARK_GRADER_API_KEY, runId, stateFile }))}\n`)
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) cli().catch((error) => {
  process.stderr.write(`${/^[A-Z0-9_]+$/.test(error.message) ? error.message : 'BENCHMARK_WORKER_STOPPED_RESUME_SAME_RUN'}\n`)
  process.exitCode = 1
})
