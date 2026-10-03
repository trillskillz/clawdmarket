import { createHash } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

function fail(code) { throw new Error(code) }
function uuid(value) { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) }

function origin(value) {
  const url = new URL(value)
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/'
    || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) fail('INVALID_PROVIDER_ORIGIN')
  return url.origin
}

/** Private journal: sync the file and directory before treating output as prepared. */
async function save(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${crypto.randomUUID()}.tmp`
  const file = await open(temporary, 'wx', 0o600)
  try { await file.writeFile(JSON.stringify(value)); await file.sync() } finally { await file.close() }
  try {
    await rename(temporary, path)
    const directory = await open(dirname(path), 'r')
    try { await directory.sync() } finally { await directory.close() }
  } finally { await unlink(temporary).catch(() => {}) }
}

function deliveryBody(output, attemptId) {
  if (!output || typeof output !== 'object' || Array.isArray(output)
    || Object.keys(output).some((key) => !['summary', 'artifact', 'delivery_url', 'artifact_ids', 'verification_artifact_id'].includes(key))
    || typeof output.summary !== 'string' || output.summary.trim().length < 10 || output.summary.trim().length > 8000
    || (output.artifact !== undefined && (!output.artifact || typeof output.artifact !== 'object' || Array.isArray(output.artifact)))
    || (output.delivery_url !== undefined && (typeof output.delivery_url !== 'string' || output.delivery_url.length > 2000
      || !/^https?:\/\//i.test(output.delivery_url)))) fail('INVALID_PROVIDER_DELIVERY')
  if (output.artifact_ids !== undefined && (!Array.isArray(output.artifact_ids) || output.artifact_ids.length < 1 || output.artifact_ids.length > 8
    || output.artifact_ids.some((id) => !uuid(id)) || new Set(output.artifact_ids).size !== output.artifact_ids.length)) fail('INVALID_PROVIDER_DELIVERY')
  if (output.verification_artifact_id !== undefined && (!uuid(output.verification_artifact_id) || output.artifact !== undefined || !output.artifact_ids?.includes(output.verification_artifact_id))) fail('INVALID_PROVIDER_DELIVERY')
  const body = JSON.stringify({ summary: output.summary.trim(),
    ...(output.delivery_url === undefined ? {} : { delivery_url: new URL(output.delivery_url).href }),
    ...(output.artifact === undefined ? {} : { artifact: output.artifact }), execution_attempt_id: attemptId,
    ...(output.artifact_ids === undefined ? {} : { artifact_ids: output.artifact_ids }),
    ...(output.verification_artifact_id === undefined ? {} : { verification_artifact_id: output.verification_artifact_id }) })
  if (Buffer.byteLength(body) > 50_000) fail('PROVIDER_DELIVERY_TOO_LARGE')
  return body
}

/**
 * Execute on the provider's machine. Callers must serialize each journal; the CLI uses flock.
 * @param {{baseUrl?: string, apiKey: string, tradeId: string, serviceId?: string, stateFile: string,
 * handler: Function, fetcher?: typeof fetch, signal?: AbortSignal, heartbeatMs?: number,
 * timeoutMs?: number, prepareOnly?: boolean}} options
 */
export async function runProviderWork({ baseUrl = 'https://www.clawdmkt.com', apiKey, tradeId, serviceId,
  stateFile, handler, fetcher = fetch, signal, heartbeatMs = 15_000, timeoutMs = 240_000, prepareOnly = false }) {
  const base = origin(baseUrl)
  if (!apiKey?.trim() || !uuid(tradeId) || (serviceId !== undefined && !uuid(serviceId)) || !stateFile
    || typeof handler !== 'function') fail('INVALID_PROVIDER_CONFIGURATION')
  if (!Number.isFinite(heartbeatMs) || heartbeatMs < 1 || !Number.isFinite(timeoutMs) || timeoutMs < 1) fail('INVALID_PROVIDER_TIMING')
  const controller = new AbortController()
  const combined = AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])])
  async function api(method, suffix, body) {
    let response
    try {
      response = await fetcher(`${base}/api/trades/${tradeId}/${suffix}`, {
        method, redirect: 'error', credentials: 'omit', signal: AbortSignal.any([combined, AbortSignal.timeout(10_000)]),
        headers: { Authorization: `Bearer ${apiKey.trim()}`, Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body }),
      })
    } catch { fail('PROVIDER_REQUEST_UNCERTAIN_RESUME_SAME_TRADE') }
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      const code = payload?.error_code || payload?.code
      fail(typeof code === 'string' && /^[A-Z0-9_]+$/.test(code) ? code : `PROVIDER_HTTP_${response.status}`)
    }
    if (!payload || typeof payload !== 'object') fail('INVALID_PROVIDER_RESPONSE')
    return payload
  }
  let journal = null
  try { journal = JSON.parse(await readFile(stateFile, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') fail('INVALID_PROVIDER_JOURNAL') }
  const work = (await api('GET', 'work-order')).work_order
  const attempt = work?.execution_attempt
  if (!work || work.trade_id !== tradeId || !uuid(work.id) || !uuid(work.service_id) || !uuid(attempt?.id)
    || work.provider_protocol !== 'leased_v1' || (serviceId && work.service_id !== serviceId)) fail('PROVIDER_WORK_ORDER_MISMATCH')
  if (journal && (journal.version !== 1 || journal.origin !== base || journal.trade_id !== tradeId
    || journal.order_id !== work.id || journal.service_id !== work.service_id || journal.attempt_id !== attempt.id)) fail('PROVIDER_JOURNAL_MISMATCH')
  journal ||= { version: 1, origin: base, trade_id: tradeId, order_id: work.id,
    service_id: work.service_id, attempt_id: attempt.id, phase: 'running', delivery_body: null, receipt: null }
  if (journal.delivery_body !== null) {
    let parsed
    try { parsed = JSON.parse(journal.delivery_body) } catch { fail('INVALID_PROVIDER_JOURNAL') }
    if (parsed.execution_attempt_id !== attempt.id) fail('PROVIDER_JOURNAL_MISMATCH')
    const { execution_attempt_id: unused, ...output } = parsed
    void unused
    if (deliveryBody(output, attempt.id) !== journal.delivery_body) fail('INVALID_PROVIDER_JOURNAL')
  }
  const submit = async () => {
    const submitted = await api('POST', 'delivery', journal.delivery_body)
    if (!uuid(submitted.delivery?.id) || submitted.delivery?.content_hash !== createHash('sha256').update(journal.delivery_body).digest('hex')) fail('INVALID_PROVIDER_RECEIPT')
    journal.phase = 'delivered'
    journal.receipt = { delivery_id: submitted.delivery.id, content_hash: submitted.delivery.content_hash }
    await save(stateFile, journal)
    return { state: 'delivered', attempt_id: attempt.id, ...journal.receipt, idempotent: submitted.idempotent === true }
  }
  // A lost delivery response can be recovered after buyer settlement through exact content replay.
  if (attempt.state === 'delivered') {
    if (!journal.delivery_body) fail('PROVIDER_DELIVERED_WITHOUT_LOCAL_OUTPUT')
    return submit()
  }
  if (work.trade_status !== 'escrow_held' || !['funded', 'executing'].includes(work.state)
    || !['queued', 'accepted'].includes(attempt.state)) fail('PROVIDER_WORK_NOT_ACTIVE')
  const due = Date.parse(attempt.state === 'queued' ? attempt.acknowledgment_due_at : attempt.lease_expires_at)
  if (!Number.isFinite(due) || due <= Date.now()) fail('PROVIDER_DEADLINE_EXPIRED')
  await save(stateFile, journal)
  const action = async (name) => {
    const response = await api('POST', 'work-order/attempt', JSON.stringify({ attempt_id: attempt.id, action: name }))
    if (response.attempt?.id !== attempt.id || response.attempt.state !== 'accepted'
      || !(Date.parse(response.attempt.lease_expires_at) > Date.now())) fail('INVALID_PROVIDER_LEASE')
    return response.attempt
  }
  if (attempt.state === 'queued') await action('accept')
  const lease = await action('heartbeat')
  if (heartbeatMs >= (Date.parse(lease.lease_expires_at) - Date.now()) / 2) fail('PROVIDER_HEARTBEAT_TOO_SLOW')
  const heartbeatStop = new AbortController()
  let heartbeatError = null
  const heartbeats = (async () => {
    while (!heartbeatStop.signal.aborted) {
      try { await sleep(heartbeatMs, undefined, { signal: heartbeatStop.signal }) } catch { return }
      try { await action('heartbeat') } catch (error) { heartbeatError = error; controller.abort(error); return }
    }
  })()
  try {
    if (!journal.delivery_body) {
      let abort
      const interrupted = new Promise((_, reject) => {
        abort = () => reject(combined.reason)
        combined.addEventListener('abort', abort, { once: true })
        if (combined.aborted) abort()
      })
      let output
      try { output = await Promise.race([handler(work, { signal: combined, idempotencyKey: attempt.id }), interrupted]) }
      finally { combined.removeEventListener('abort', abort) }
      combined.throwIfAborted()
      if (!output || typeof output !== 'object') fail('INVALID_PROVIDER_DELIVERY')
      const { files, verification_file_index: verificationIndex, ...inline } = output
      journal.delivery_body = deliveryBody(inline, attempt.id)
      if (files !== undefined) {
        if (!Array.isArray(files) || files.length < 1 || files.length > 8 || inline.artifact_ids !== undefined
          || inline.verification_artifact_id !== undefined || (verificationIndex !== undefined && (inline.artifact !== undefined || !Number.isInteger(verificationIndex) || verificationIndex < 0 || verificationIndex >= files.length))) fail('INVALID_PROVIDER_ARTIFACTS')
        let total = 0
        journal.artifact_uploads = files.map((file, index) => {
          if (!file || typeof file !== 'object' || Object.keys(file).some((key) => !['name', 'media_type', 'content_base64', 'sha256', 'provenance'].includes(key))
            || typeof file.content_base64 !== 'string' || file.content_base64.length > 87_384) fail('INVALID_PROVIDER_ARTIFACTS')
          const bytes = Buffer.from(file.content_base64, 'base64')
          total += bytes.length
          if (bytes.length < 1 || bytes.length > 65_536 || total > 262_144 || bytes.toString('base64') !== file.content_base64
            || file.sha256 !== createHash('sha256').update(bytes).digest('hex')) fail('INVALID_PROVIDER_ARTIFACTS')
          return { body: JSON.stringify({ ...file, client_reference: `attempt:${attempt.id}:${index}`, execution_attempt_id: attempt.id }), artifact_id: null }
        })
        journal.verification_file_index = verificationIndex ?? null
      } else if (verificationIndex !== undefined) fail('INVALID_PROVIDER_ARTIFACTS')
      journal.phase = 'prepared'
      await save(stateFile, journal)
    }
    if (!prepareOnly && journal.artifact_uploads) {
      for (const upload of journal.artifact_uploads) {
        if (upload.artifact_id) continue
        const submitted = await api('POST', 'artifacts', upload.body)
        const expected = JSON.parse(upload.body)
        if (!uuid(submitted.artifact?.id) || submitted.artifact.sha256 !== expected.sha256
          || submitted.artifact.trade_id !== tradeId) fail('INVALID_PROVIDER_ARTIFACT_RECEIPT')
        upload.artifact_id = submitted.artifact.id
        await save(stateFile, journal)
      }
      const previous = JSON.parse(journal.delivery_body)
      const { execution_attempt_id: unused, ...output } = previous
      void unused
      output.artifact_ids = journal.artifact_uploads.map((upload) => upload.artifact_id)
      if (journal.verification_file_index !== null) output.verification_artifact_id = output.artifact_ids[journal.verification_file_index]
      journal.delivery_body = deliveryBody(output, attempt.id)
      await save(stateFile, journal)
    }
    if (heartbeatError) throw heartbeatError
  } finally {
    heartbeatStop.abort()
    await heartbeats
  }
  if (heartbeatError) throw heartbeatError
  combined.throwIfAborted()
  if (prepareOnly) return { state: 'prepared', attempt_id: attempt.id }
  // This authoritative action also detects dispute/expiry committed while the handler ran.
  await action('heartbeat')
  return submit()
}

async function cli() {
  const args = process.argv.slice(2)
  const options = {}
  for (let i = 0; i < args.length; i += 1) {
    const key = args[i]
    if (key === '--prepare-only') options.prepareOnly = true
    else if (['--trade-id', '--service-id', '--handler', '--state-dir'].includes(key) && args[i + 1]) options[key.slice(2)] = args[++i]
    else fail('INVALID_PROVIDER_ARGUMENTS')
  }
  if (!uuid(options['trade-id']) || !options.handler || !options['state-dir']) fail('PROVIDER_TRADE_HANDLER_AND_STATE_DIR_REQUIRED')
  const base = origin(process.env.BASE_URL || 'https://www.clawdmkt.com')
  const directory = resolve(options['state-dir'])
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const stateFile = resolve(directory, `${createHash('sha256').update(`${base}:${options['trade-id']}`).digest('hex')}.json`)
  if (process.env.CLAWDMARKET_PROVIDER_LOCK_HELD !== stateFile) {
    const lock = await open(`${stateFile}.lock`, 'a', 0o600)
    await lock.close()
    // The kernel releases this lock even on SIGKILL; another process can safely resume.
    const child = spawn('flock', ['--nonblock', '--conflict-exit-code', '75', `${stateFile}.lock`,
      process.execPath, fileURLToPath(import.meta.url), ...args], {
      stdio: 'inherit', env: { ...process.env, CLAWDMARKET_PROVIDER_LOCK_HELD: stateFile },
    })
    child.on('error', () => { console.error('PROVIDER_FLOCK_REQUIRED'); process.exitCode = 1 })
    child.on('exit', (code) => { process.exitCode = code ?? 1 })
    return
  }
  const handlerModule = await import(pathToFileURL(resolve(options.handler)).href)
  const result = await runProviderWork({ baseUrl: base, apiKey: process.env.CLAWDMARKET_PROVIDER_API_KEY,
    tradeId: options['trade-id'], serviceId: options['service-id'], stateFile, handler: handlerModule.default,
    prepareOnly: options.prepareOnly === true })
  console.log(JSON.stringify(result))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().catch((error) => { console.error(/^[A-Z0-9_]+$/.test(error.message) ? error.message : 'PROVIDER_WORKER_STOPPED_RESUME_SAME_TRADE'); process.exitCode = 1 })
}
