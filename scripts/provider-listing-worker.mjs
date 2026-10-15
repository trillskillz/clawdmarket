/** Execute one original funded listing on the assigned provider's own machine. */
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { canonicalJSON } from './verifier-contract.mjs'
import { withBuyerStateLock } from './buyer-wallet-lock.mjs'

const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonicalJSON(value)).digest('hex')
function fail(code) { throw new Error(code) }
function origin(value) {
  const url = new URL(value)
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/'
    || url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) fail('INVALID_PROVIDER_ORIGIN')
  return url.origin
}
async function privateDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const entry = await lstat(directory)
  if (!entry.isDirectory() || entry.mode & 0o077 || entry.uid !== process.getuid?.()) fail('PROVIDER_PRIVATE_STATE_DIRECTORY_REQUIRED')
}
async function read(path) {
  let file
  try {
    await privateDirectory(dirname(path))
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const entry = await file.stat()
    if (!entry.isFile() || entry.size > 524_288 || entry.mode & 0o077 || entry.uid !== process.getuid?.()) fail('INVALID_PROVIDER_JOURNAL')
    const value = JSON.parse(await file.readFile('utf8'))
    if (value?.version !== 1) fail('INVALID_PROVIDER_JOURNAL')
    return value
  } catch (error) { if (error.code === 'ENOENT') return null; fail('INVALID_PROVIDER_JOURNAL') }
  finally { await file?.close() }
}
async function save(path, journal) {
  await privateDirectory(dirname(path))
  const bytes = JSON.stringify(journal)
  if (journal?.version !== 1 || Buffer.byteLength(bytes) > 524_288) fail('INVALID_PROVIDER_JOURNAL')
  const temporary = path + '.' + crypto.randomUUID() + '.tmp'
  const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
  try { try { await file.writeFile(bytes); await file.sync() } finally { await file.close() }
    await rename(temporary, path)
    const directory = await open(dirname(path), 'r'); try { await directory.sync() } finally { await directory.close() }
  } finally { await unlink(temporary).catch(() => {}) }
}
function deliveryBody(output) {
  if (!output || typeof output !== 'object' || Array.isArray(output)
    || Object.keys(output).some(key => !['summary', 'artifact', 'delivery_url', 'artifact_ids', 'verification_artifact_id'].includes(key))
    || typeof output.summary !== 'string' || output.summary.trim().length < 10 || output.summary.trim().length > 8000
    || output.artifact !== undefined && (!output.artifact || typeof output.artifact !== 'object' || Array.isArray(output.artifact))
    || output.delivery_url !== undefined && (typeof output.delivery_url !== 'string' || output.delivery_url.length > 2000 || !/^https?:\/\//i.test(output.delivery_url))) fail('INVALID_PROVIDER_DELIVERY')
  if (output.artifact_ids !== undefined && (!Array.isArray(output.artifact_ids) || output.artifact_ids.length < 1 || output.artifact_ids.length > 8
    || output.artifact_ids.some(id => !uuid(id)) || new Set(output.artifact_ids).size !== output.artifact_ids.length)) fail('INVALID_PROVIDER_DELIVERY')
  if (output.verification_artifact_id !== undefined && (!uuid(output.verification_artifact_id)
    || output.artifact !== undefined || !output.artifact_ids?.includes(output.verification_artifact_id))) fail('INVALID_PROVIDER_DELIVERY')
  const body = JSON.stringify({ summary: output.summary.trim(), ...(output.delivery_url === undefined ? {} : { delivery_url: new URL(output.delivery_url).href }),
    ...(output.artifact === undefined ? {} : { artifact: output.artifact }), ...(output.artifact_ids === undefined ? {} : { artifact_ids: output.artifact_ids }),
    ...(output.verification_artifact_id === undefined ? {} : { verification_artifact_id: output.verification_artifact_id }) })
  if (Buffer.byteLength(body) > 50_000) fail('PROVIDER_DELIVERY_TOO_LARGE')
  return body
}
function artifactUploads(files, reference) {
  if (!Array.isArray(files) || files.length < 1 || files.length > 8) fail('INVALID_PROVIDER_ARTIFACTS')
  let total = 0
  return files.map((file, index) => {
    if (!file || typeof file !== 'object' || Array.isArray(file)
      || Object.keys(file).some(key => !['name', 'media_type', 'content_base64', 'sha256', 'provenance'].includes(key))
      || typeof file.content_base64 !== 'string' || file.content_base64.length > 87_384) fail('INVALID_PROVIDER_ARTIFACTS')
    const bytes = Buffer.from(file.content_base64, 'base64'); total += bytes.length
    if (!bytes.length || bytes.length > 65_536 || total > 262_144 || bytes.toString('base64') !== file.content_base64 || file.sha256 !== digest(bytes)) fail('INVALID_PROVIDER_ARTIFACTS')
    return { body: JSON.stringify({ ...file, client_reference: `listing:${reference}:${index}` }), artifact_id: null }
  })
}

export async function runProviderListing({ baseUrl, apiKey, listingId, tradeId, stateDirectory, handler, fetcher = fetch, signal, timeoutMs = 240_000, prepareOnly = false }) {
  const base = origin(baseUrl)
  if (!apiKey?.trim() || typeof listingId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{2,199}$/.test(listingId) || !uuid(tradeId) || !stateDirectory || typeof handler !== 'function'
    || !Number.isFinite(timeoutMs) || timeoutMs < 1) fail('INVALID_PROVIDER_CONFIGURATION')
  const reference = digest({ kind: 'listing-provider-v1', origin: base, listing_id: listingId, trade_id: tradeId }), directory = resolve(stateDirectory), stateFile = resolve(directory, reference + '.json')
  return withBuyerStateLock(directory, reference, async lockSignal => {
    const combined = AbortSignal.any([lockSignal, AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])])
    const api = async (method, path, body) => {
      combined.throwIfAborted()
      try {
        const response = await fetcher(base + path, { method, redirect: 'error', credentials: 'omit',
          signal: AbortSignal.any([combined, AbortSignal.timeout(10_000)]), headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json',
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body }) })
        const reader = response.body?.getReader(), chunks = []; if (!reader) fail('INVALID_PROVIDER_RESPONSE')
        let size = 0, value
        try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 65_536) fail('PROVIDER_RESPONSE_TOO_LARGE'); chunks.push(Buffer.from(part.value)) }
          value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
        combined.throwIfAborted()
        if (!response.ok) fail(`PROVIDER_HTTP_${response.status}`)
        return value
      } catch (error) { if (/^[A-Z0-9_]+$/.test(error.message || '')) throw error; fail('PROVIDER_REQUEST_UNCERTAIN_RESUME_SAME_TRADE') }
    }
    const workspace = await api('GET', `/api/trades/${tradeId}/listing-work`), binding = workspace.workspace?.reviewed_listing, trade = workspace.workspace?.trade
    if (workspace.id !== listingId || workspace.viewer?.is_seller !== true || !binding || binding.listing_id !== listingId
      || !uuid(binding.authorization_id) || !/^[a-f0-9]{64}$/.test(binding.authority_hash || '') || trade?.id !== tradeId
      || binding.buyer_id !== trade.buyer_id || binding.seller_id !== trade.seller_id || !binding.requirements
      || typeof binding.title !== 'string' || typeof binding.description !== 'string') fail('PROVIDER_LISTING_SCOPE_MISMATCH')
    let journal = await read(stateFile)
    if (journal && (journal.reference !== reference || journal.origin !== base || journal.listing_id !== listingId || journal.trade_id !== tradeId
      || journal.binding_hash !== digest(binding) || journal.buyer_id !== trade.buyer_id || journal.seller_id !== trade.seller_id)) fail('PROVIDER_JOURNAL_MISMATCH')
    if (!journal) {
      journal = { version: 1, reference, origin: base, listing_id: listingId, trade_id: tradeId, buyer_id: trade.buyer_id, seller_id: trade.seller_id,
        binding_hash: digest(binding), phase: 'running', delivery_body: null, delivery_submission_started: false, receipt: null }
      await save(stateFile, journal)
    }
    const persist = async () => { combined.throwIfAborted(); await save(stateFile, journal); combined.throwIfAborted() }
    if (journal.delivery_body !== null && (typeof journal.delivery_body !== 'string'
      || deliveryBody(JSON.parse(journal.delivery_body)) !== journal.delivery_body)) fail('INVALID_PROVIDER_JOURNAL')
    if (!journal.delivery_body) {
      if (trade.status !== 'escrow_held' || journal.delivery_submission_started || workspace.workspace.delivery) fail('PROVIDER_ORIGINAL_OUTPUT_REQUIRED')
      let abort
      const interrupted = new Promise((_, reject) => { abort = () => reject(combined.reason); combined.addEventListener('abort', abort, { once: true }); if (combined.aborted) abort() })
      let output
      try { output = await Promise.race([handler({ listing_id: listingId, trade_id: tradeId, buyer_id: trade.buyer_id, seller_id: trade.seller_id,
        title: binding.title, description: binding.description, requirements: binding.requirements, reviewed_listing: binding }, { signal: combined, idempotencyKey: reference }), interrupted]) }
      finally { combined.removeEventListener('abort', abort) }
      combined.throwIfAborted()
      if (!output || typeof output !== 'object' || Array.isArray(output)) fail('INVALID_PROVIDER_DELIVERY')
      const { files, verification_file_index: verificationIndex, ...inline } = output
      journal.delivery_body = deliveryBody(inline)
      if (files !== undefined) {
        if (inline.artifact_ids !== undefined || inline.verification_artifact_id !== undefined
          || verificationIndex !== undefined && (inline.artifact !== undefined || !Number.isInteger(verificationIndex) || verificationIndex < 0 || verificationIndex >= files.length)) fail('INVALID_PROVIDER_ARTIFACTS')
        journal.artifact_uploads = artifactUploads(files, reference); journal.verification_file_index = verificationIndex ?? null
      } else if (verificationIndex !== undefined) fail('INVALID_PROVIDER_ARTIFACTS')
      journal.phase = 'prepared'; await persist()
    }
    if (prepareOnly && !journal.delivery_submission_started) return { state: 'prepared', listing_id: listingId, trade_id: tradeId, content_hash: digest(journal.delivery_body) }
    if (journal.artifact_uploads) {
      if (!Array.isArray(journal.artifact_uploads) || journal.artifact_uploads.length < 1 || journal.artifact_uploads.length > 8) fail('INVALID_PROVIDER_JOURNAL')
      for (const [index, upload] of journal.artifact_uploads.entries()) {
        const expected = JSON.parse(upload.body), { client_reference: clientReference, ...file } = expected
        if (clientReference !== `listing:${reference}:${index}` || artifactUploads([file], reference)[0].body !== JSON.stringify({ ...file, client_reference: `listing:${reference}:0` })) fail('INVALID_PROVIDER_JOURNAL')
        if (upload.artifact_id) { if (!uuid(upload.artifact_id)) fail('INVALID_PROVIDER_JOURNAL'); continue }
        if (journal.delivery_submission_started) fail('PROVIDER_ORIGINAL_ARTIFACT_REQUIRED')
        const submitted = await api('POST', `/api/trades/${tradeId}/artifacts`, upload.body)
        if (!uuid(submitted.artifact?.id) || submitted.artifact.trade_id !== tradeId || submitted.artifact.sha256 !== expected.sha256) fail('INVALID_PROVIDER_ARTIFACT_RECEIPT')
        upload.artifact_id = submitted.artifact.id; await persist()
      }
      const output = JSON.parse(journal.delivery_body), expectedIds = journal.artifact_uploads.map(upload => upload.artifact_id)
      if (journal.delivery_submission_started && canonicalJSON(output.artifact_ids) !== canonicalJSON(expectedIds)) fail('PROVIDER_DELIVERY_ALREADY_BOUND')
      output.artifact_ids = expectedIds
      if (journal.verification_file_index !== null) {
        if (!Number.isInteger(journal.verification_file_index) || journal.verification_file_index < 0 || journal.verification_file_index >= expectedIds.length) fail('INVALID_PROVIDER_JOURNAL')
        output.verification_artifact_id = expectedIds[journal.verification_file_index]
      }
      journal.delivery_body = deliveryBody(output); await persist()
    }
    journal.delivery_submission_started = true; await persist()
    const submitted = await api('POST', `/api/trades/${tradeId}/delivery`, journal.delivery_body), contentHash = digest(journal.delivery_body)
    if (!uuid(submitted.delivery?.id) || submitted.delivery.content_hash !== contentHash) fail('INVALID_PROVIDER_RECEIPT')
    if (journal.receipt && (journal.receipt.delivery_id !== submitted.delivery.id || journal.receipt.content_hash !== contentHash)) fail('PROVIDER_RECEIPT_CHANGED')
    journal.phase = 'delivered'; journal.receipt = { delivery_id: submitted.delivery.id, content_hash: contentHash }; await persist()
    return { state: 'delivered', listing_id: listingId, trade_id: tradeId, ...journal.receipt, idempotent: submitted.idempotent === true }
  })
}

async function cli() {
  const args = process.argv.slice(2), options = {}
  for (let index = 0; index < args.length; index++) {
    const key = args[index]
    if (key === '--prepare-only') options.prepareOnly = true
    else if (['--listing-id', '--trade-id', '--handler', '--state-dir'].includes(key) && args[index + 1]) options[key.slice(2)] = args[++index]
    else fail('INVALID_PROVIDER_ARGUMENTS')
  }
  if (!options.handler) fail('PROVIDER_LISTING_TRADE_HANDLER_AND_STATE_REQUIRED')
  const handler = await import(pathToFileURL(resolve(options.handler)).href)
  process.stdout.write(JSON.stringify(await runProviderListing({ baseUrl: process.env.BASE_URL || 'https://www.clawdmkt.com', apiKey: process.env.CLAWDMARKET_PROVIDER_API_KEY,
    listingId: options['listing-id'], tradeId: options['trade-id'], stateDirectory: options['state-dir'], handler: handler.default, prepareOnly: options.prepareOnly === true })) + '\n')
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) cli().catch(error => {
  process.stderr.write((/^[A-Z0-9_]+$/.test(error.message || '') ? error.message : 'PROVIDER_WORKER_STOPPED_RESUME_SAME_TRADE') + '\n'); process.exitCode = 1
})
