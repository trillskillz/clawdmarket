import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open, rename, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { privateKeyToAccount } from 'viem/accounts'
import { Account } from 'viem/tempo'
import { canonicalJSON } from './verifier-contract.mjs'
import { readBuyerPaymentJournal, saveBuyerPaymentJournal } from './buyer-payment-journal.mjs'
import { runBuyerFunding } from './buyer-worker.mjs'
import { runBuyerMppFunding } from './buyer-mpp-worker.mjs'
import { createBuyerEvmAdapter } from './buyer-evm-adapter.mjs'
import { createBuyerTempoAdapter } from './buyer-tempo-adapter.mjs'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const digest = (value) => createHash('sha256').update(canonicalJSON(value)).digest('hex')
function fail(code) { throw new Error(code) }

/** One restartable route pass: buyer funding -> external provider -> explicit review -> authoritative settlement receipt.
 * @param {{approval: any, apiKey: string, stateDirectory?: string, account?: any, adapter?: any, fetcher?: typeof fetch,
 * decision?: {version: number, route_id: string, decision: string, content_hash: string}}} options
 */
export async function runBuyerRoute({ approval, apiKey, stateDirectory, account, adapter, fetcher = fetch, decision = undefined }) {
  if (!uuid.test(approval?.route_id) || approval.version !== 1 || !apiKey?.trim()) fail('BUYER_CONFIGURATION_INVALID')
  const url = new URL(approval.origin)
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/'
    || url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) fail('BUYER_ORIGIN_INVALID')
  const base = url.origin, routePath = `/api/routes/${approval.route_id}`
  const api = async (method, path, body) => {
    try {
      const response = await fetcher(`${base}${path}`, { method, redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${apiKey.trim()}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) })
      const reader = response.body?.getReader(), chunks = []; let size = 0
      if (!reader) fail('BUYER_RESPONSE_INVALID')
      let result
      try {
        while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength
          if (size > 65_536) fail('BUYER_RESPONSE_TOO_LARGE'); chunks.push(Buffer.from(part.value)) }
        result = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
      if (!response.ok) fail(`BUYER_HTTP_${response.status}`)
      return result
    } catch (error) {
      if (error instanceof Error && /^BUYER_[A-Z0-9_]+$/.test(error.message)) throw error
      fail('BUYER_REQUEST_UNCERTAIN_RESUME_SAME_ROUTE')
    }
  }
  if (!approval.mandate_id) {
    const plan = await api('GET', routePath)
    if (plan.route?.id !== approval.route_id) fail('BUYER_ROUTE_SCOPE_MISMATCH')
    return { state: 'plan_only', route_id: approval.route_id, funds_moved: false }
  }
  if (!stateDirectory || !uuid.test(approval.mandate_id) || !/^[a-f0-9]{64}$/.test(approval.terms_hash)) fail('BUYER_CONFIGURATION_INVALID')
  if (decision && (decision.version !== 1 || decision.route_id !== approval.route_id || decision.decision !== 'accept'
    || !/^[a-f0-9]{64}$/.test(decision.content_hash) || Object.keys(decision).some((k) => !['version', 'route_id', 'decision', 'content_hash'].includes(k)))) fail('BUYER_DECISION_INVALID')
  const reference = digest({ origin: base, route_id: approval.route_id, mandate_id: approval.mandate_id, terms_hash: approval.terms_hash })
  const stateFile = resolve(stateDirectory, `${reference}.route.json`)
  let journal = await readBuyerPaymentJournal(stateFile)
  if (journal && (journal.version !== 1 || journal.reference !== reference || journal.origin !== base || journal.route_id !== approval.route_id
    || journal.mandate_id !== approval.mandate_id || journal.terms_hash !== approval.terms_hash)) fail('BUYER_JOURNAL_SCOPE_MISMATCH')
  journal ||= { version: 1, reference, origin: base, route_id: approval.route_id, mandate_id: approval.mandate_id, terms_hash: approval.terms_hash, state: 'funding' }
  if (journal.decision && decision && canonicalJSON(journal.decision) !== canonicalJSON(decision)) fail('BUYER_DECISION_CONFLICT')
  await saveBuyerPaymentJournal(stateFile, journal)
  if (!journal.trade_id) {
    const grant = await api('GET', `${routePath}/mandate`)
    if (grant.mandate?.id !== approval.mandate_id || grant.mandate.terms_hash !== approval.terms_hash) fail('BUYER_MANDATE_SCOPE_MISMATCH')
    const rail = grant.mandate.terms?.payment?.rail
    const funding = await (rail === 'evm' ? runBuyerFunding : rail === 'mpp' ? runBuyerMppFunding : () => fail('BUYER_RAIL_UNSUPPORTED'))({ approval, apiKey, stateDirectory, account, adapter, fetcher })
    if (funding.state !== 'funded') return funding
    journal.trade_id = funding.trade_id; journal.state = 'funded'; await saveBuyerPaymentJournal(stateFile, journal)
  }
  let lifecycle = await api('GET', `${routePath}/advance`)
  const validate = (value) => {
    if (value.route_id !== approval.route_id || value.trade_id !== journal.trade_id) fail('BUYER_ROUTE_SCOPE_MISMATCH')
    if (value.receipt) {
      const receipt = value.receipt.receipt
      if (digest(receipt) !== value.receipt.content_hash || receipt.version !== 1 || receipt.route_id !== approval.route_id || receipt.trade_id !== journal.trade_id
        || receipt.authority?.mandate_id !== approval.mandate_id || receipt.authority.terms_hash !== approval.terms_hash
        || receipt.settlement_status !== 'completed' || receipt.buyer_decision?.decision !== 'accepted' || !receipt.capacity_released
        || receipt.buyer_decision.content_hash !== receipt.delivery?.content_hash || !['confirmed_external', 'backed_account_credit'].includes(receipt.financial?.kind)) fail('BUYER_ROUTE_RECEIPT_MISMATCH')
    }
  }
  validate(lifecycle)
  let resultFile = null, artifactFiles = [], observedResult = null
  if (lifecycle.delivery) {
    const result = await api('GET', `${routePath}/result`)
    if (result.route_id !== approval.route_id || result.trade_id !== journal.trade_id || result.delivery?.content_hash !== lifecycle.delivery.content_hash
      || digest(result.content) !== result.result_hash || !Array.isArray(result.artifacts) || result.artifacts.length > 8
      || new Set(result.artifacts.map((a) => a.id)).size !== result.artifacts.length
      || result.artifacts.some((a) => !uuid.test(a.id) || !/^[a-f0-9]{64}$/.test(a.sha256) || !Number.isSafeInteger(a.size_bytes) || a.size_bytes < 1 || a.size_bytes > 65_536)
      || result.artifacts.reduce((sum, a) => sum + a.size_bytes, 0) > 262_144) fail('BUYER_ROUTE_RESULT_MISMATCH')
    if (lifecycle.receipt && (lifecycle.receipt.receipt.result_hash !== result.result_hash
      || canonicalJSON(lifecycle.receipt.receipt.artifacts) !== canonicalJSON(result.artifacts))) fail('BUYER_ROUTE_RESULT_MISMATCH')
    observedResult = result
    resultFile = resolve(stateDirectory, `${reference}.${result.delivery.content_hash}.result.json`)
    await saveBuyerPaymentJournal(resultFile, { version: 1, ...result })
    for (const artifact of result.artifacts) {
      const path = resolve(stateDirectory, `${reference}.${artifact.id}.${artifact.sha256}.artifact`)
      let existing
      try {
        const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
        try { const info = await file.stat()
          if (!info.isFile() || info.size !== artifact.size_bytes || (info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()) fail('BUYER_PRIVATE_ARTIFACT_INVALID')
          existing = await file.readFile()
        } finally { await file.close() }
      } catch (error) { if (error.code !== 'ENOENT') fail('BUYER_PRIVATE_ARTIFACT_INVALID') }
      if (existing && createHash('sha256').update(existing).digest('hex') !== artifact.sha256) fail('BUYER_PRIVATE_ARTIFACT_INVALID')
      if (!existing) {
        let bytes
        try {
          const response = await fetcher(`${base}/api/trades/${journal.trade_id}/artifacts/${artifact.id}`, { redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(10_000),
            headers: { Authorization: `Bearer ${apiKey.trim()}`, Accept: 'application/octet-stream' } })
          if (!response.ok || response.headers.get('X-Artifact-SHA256') !== artifact.sha256) fail('BUYER_ARTIFACT_UNAVAILABLE')
          const reader = response.body?.getReader(), chunks = []; let size = 0
          if (!reader) fail('BUYER_ARTIFACT_UNAVAILABLE')
          try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength
            if (size > artifact.size_bytes) fail('BUYER_ARTIFACT_INTEGRITY_FAILED'); chunks.push(Buffer.from(part.value)) }
            bytes = Buffer.concat(chunks)
          } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
          if (bytes.length !== artifact.size_bytes || createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) fail('BUYER_ARTIFACT_INTEGRITY_FAILED')
        } catch (error) { if (/^BUYER_[A-Z0-9_]+$/.test(error.message)) throw error; fail('BUYER_ARTIFACT_UNAVAILABLE') }
        const temporary = `${path}.${crypto.randomUUID()}.tmp`, file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
        try { try { await file.writeFile(bytes); await file.sync() } finally { await file.close() }
          await rename(temporary, path); const directory = await open(resolve(stateDirectory), 'r')
          try { await directory.sync() } finally { await directory.close() }
        } finally { await unlink(temporary).catch(() => {}) }
      }
      artifactFiles.push({ id: artifact.id, sha256: artifact.sha256, path })
    }
  }
  if (decision) {
    if (lifecycle.delivery?.content_hash !== decision.content_hash) fail('BUYER_DELIVERY_CHANGED')
    if (!['awaiting_buyer', 'settling', 'completed'].includes(lifecycle.phase)) fail('BUYER_ROUTE_NOT_READY_FOR_DECISION')
    // Fsync the checked explicit decision before any acceptance request; uncertainty replays it unchanged.
    journal.decision = decision; await saveBuyerPaymentJournal(stateFile, journal)
  }
  let command = { version: 1, action: 'observe' }
  if (journal.decision && ['awaiting_buyer', 'settling'].includes(lifecycle.phase)) {
    if (lifecycle.delivery?.content_hash !== journal.decision.content_hash) fail('BUYER_DELIVERY_CHANGED')
    command = { version: 1, action: 'accept', content_hash: journal.decision.content_hash }
    journal.state = 'decision_submission_started'; await saveBuyerPaymentJournal(stateFile, journal)
  }
  lifecycle = await api('POST', `${routePath}/advance`, command)
  validate(lifecycle)
  if (lifecycle.receipt && (!observedResult || lifecycle.receipt.receipt.result_hash !== observedResult.result_hash
    || lifecycle.receipt.receipt.delivery.content_hash !== observedResult.delivery.content_hash
    || canonicalJSON(lifecycle.receipt.receipt.artifacts) !== canonicalJSON(observedResult.artifacts)
    || journal.decision && lifecycle.receipt.receipt.buyer_decision.content_hash !== journal.decision.content_hash)) fail('BUYER_ROUTE_RESULT_MISMATCH')
  if (lifecycle.phase === 'completed' && !lifecycle.receipt) fail('BUYER_ROUTE_RECEIPT_REQUIRED')
  journal.state = lifecycle.phase; journal.receipt = lifecycle.receipt; await saveBuyerPaymentJournal(stateFile, journal)
  return { state: journal.state, route_id: approval.route_id, trade_id: journal.trade_id, next_action: lifecycle.next_action,
    funds_state: lifecycle.funds_state, delivery: lifecycle.delivery, result_file: resultFile, artifact_files: artifactFiles, receipt: lifecycle.receipt }
}

async function cli() {
  const [approvalPath, stateDirectory, decisionPath] = process.argv.slice(2)
  if (!approvalPath || !stateDirectory) fail('BUYER_APPROVAL_AND_STATE_REQUIRED')
  const approval = await readBuyerPaymentJournal(resolve(approvalPath)), decision = decisionPath ? await readBuyerPaymentJournal(resolve(decisionPath)) : undefined
  if (!approval || decisionPath && !decision) fail('BUYER_APPROVAL_AND_STATE_REQUIRED')
  let account, adapter
  if (approval.mandate_id) {
    if (approval.chain_id === 4217) {
      account = Account.fromSecp256k1(process.env.CLAWDMARKET_BUYER_PRIVATE_KEY)
      adapter = createBuyerTempoAdapter({ chainId: approval.chain_id, rpcUrl: approval.rpc_url, account })
    } else {
      account = privateKeyToAccount(process.env.CLAWDMARKET_BUYER_PRIVATE_KEY)
      adapter = createBuyerEvmAdapter({ chainId: approval.chain_id, rpcUrl: approval.rpc_url, account })
    }
  }
  process.stdout.write(`${JSON.stringify(await runBuyerRoute({ approval, apiKey: process.env.CLAWDMARKET_BUYER_API_KEY, stateDirectory, account, adapter, decision }))}\n`)
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) cli().catch((error) => {
  process.stderr.write(`${/^BUYER_[A-Z0-9_]+$/.test(error.message) ? error.message : 'BUYER_ROUTE_STOPPED_RESUME_SAME_ROUTE'}\n`); process.exitCode = 1
})
