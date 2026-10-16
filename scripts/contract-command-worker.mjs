/** One explicit original contract command. No deposits, key signing, output execution or automatic buyer decisions. */
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalJSON } from './verifier-contract.mjs'
import { readBuyerPaymentJournal, saveBuyerPaymentJournal } from './buyer-payment-journal.mjs'
import { withBuyerStateLock } from './buyer-wallet-lock.mjs'

const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)
const sha = value => createHash('sha256').update(canonicalJSON(value)).digest('hex')
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
function fail(code) { throw new Error(code) }
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length
    || keys.some(key => !Object.hasOwn(value, key))) fail('CONTRACT_COMMAND_INVALID')
}
function origin(value) {
  const url = new URL(value)
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/'
    || url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) fail('CONTRACT_COMMAND_ORIGIN_INVALID')
  return url.origin
}
export function validateOriginalContractCommand(raw) {
  // Bound JSON before hashing; reject values JSON would silently change.
  const stack = [{ value: raw, depth: 0 }]; let nodes = 0
  while (stack.length) {
    const { value, depth } = stack.pop()
    if (++nodes > 4096 || depth > 16 || value === undefined || typeof value === 'function' || typeof value === 'symbol'
      || typeof value === 'bigint' || typeof value === 'number' && !Number.isFinite(value)) fail('CONTRACT_COMMAND_INPUT_LIMIT')
    if (value && typeof value === 'object') {
      if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('CONTRACT_COMMAND_INVALID')
      for (const child of Object.values(value)) stack.push({ value: child, depth: depth + 1 })
    }
  }
  const bytes = JSON.stringify(raw)
  if (Buffer.byteLength(bytes) > 48_000) fail('CONTRACT_COMMAND_INPUT_LIMIT')
  const command = JSON.parse(bytes), funding = command.action === 'fund'
  exact(command, ['version', 'action', 'origin', 'actor_id', 'buyer_id', 'seller_id', 'contract_id', 'body', 'credit_terms_acknowledged',
    ...(funding ? ['organization_id', 'authorization_id', 'gross_minor', 'principal_minor', 'upfront_fee_minor', 'milestone_ids'] : ['milestone_id'])])
  if (command.version !== 1 || !['fund', 'submit', 'accept', 'release'].includes(command.action) || command.credit_terms_acknowledged !== true
    || !uuid(command.contract_id) || !['actor_id', 'buyer_id', 'seller_id'].every(key => typeof command[key] === 'string' && command[key].length > 0 && command[key].length <= 200)
    || command.buyer_id === command.seller_id || command.actor_id !== command[command.action === 'submit' ? 'seller_id' : 'buyer_id']) fail('CONTRACT_COMMAND_INVALID')
  command.origin = origin(command.origin)
  const body = command.body
  exact(body, ['version', 'client_reference', ...(funding ? ['authority_hash'] : command.action === 'submit' ? ['artifact_bundle']
    : ['submission_id', 'content_hash', ...(command.action === 'accept' ? ['approve'] : ['acceptance_id'])])])
  if (body.version !== 1 || typeof body.client_reference !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(body.client_reference)) fail('CONTRACT_COMMAND_INVALID')
  if (funding) {
    if (!uuid(command.organization_id) || !uuid(command.authorization_id) || !hash(body.authority_hash)
      || !['gross_minor', 'principal_minor', 'upfront_fee_minor'].every(key => Number.isSafeInteger(command[key]) && command[key] >= 0)
      || command.principal_minor < 1 || command.gross_minor !== command.principal_minor + command.upfront_fee_minor
      || !Array.isArray(command.milestone_ids) || command.milestone_ids.length < 1 || command.milestone_ids.length > 20
      || command.milestone_ids.some(id => !uuid(id)) || new Set(command.milestone_ids).size !== command.milestone_ids.length) fail('CONTRACT_COMMAND_INVALID')
  } else {
    if (!uuid(command.milestone_id)) fail('CONTRACT_COMMAND_INVALID')
    if (command.action === 'submit') {
      if (!body.artifact_bundle || typeof body.artifact_bundle !== 'object' || Array.isArray(body.artifact_bundle)) fail('CONTRACT_COMMAND_INVALID')
    } else if (!uuid(body.submission_id) || !hash(body.content_hash) || (command.action === 'accept' ? body.approve !== true : !uuid(body.acceptance_id))) fail('CONTRACT_COMMAND_INVALID')
  }
  return command
}
function receiptFor(command, value) {
  const b = command.body
  if (command.action === 'fund') {
    const f = value.funding
    if (!f || !uuid(f.id) || f.organization_id !== command.organization_id || f.authorization_id !== command.authorization_id
      || f.contract_id !== command.contract_id || f.buyer_id !== command.buyer_id || value.contract?.id !== command.contract_id
      || value.contract.buyer_id !== command.buyer_id || value.contract.seller_id !== command.seller_id
      || f.client_reference !== b.client_reference || f.authority_hash !== b.authority_hash || f.request_hash !== sha(b)
      || f.gross_minor !== command.gross_minor || f.principal_minor !== command.principal_minor || f.upfront_fee_minor !== command.upfront_fee_minor
      || f.rail !== 'credit' || f.redeemable !== false || f.seller_receives !== 'nonwithdrawable_account_credit'
      || canonicalJSON(value.milestones?.map(m => m.id)) !== canonicalJSON(command.milestone_ids)) fail('CONTRACT_COMMAND_RECEIPT_MISMATCH')
    return { id: f.id, contract_id: f.contract_id, gross_minor: f.gross_minor, principal_minor: f.principal_minor, upfront_fee_minor: f.upfront_fee_minor, rail: f.rail, redeemable: f.redeemable }
  }
  const expected = { contract_id: command.contract_id, milestone_id: command.milestone_id }
  const r = value[command.action === 'submit' ? 'submission' : command.action === 'accept' ? 'decision' : 'release']
  if (!r || !uuid(r.id) || r.client_reference !== b.client_reference) fail('CONTRACT_COMMAND_RECEIPT_MISMATCH')
  if (command.action === 'submit') {
    const content = sha({ kind: 'reviewed-contract-submission-v1', ...expected, seller_id: command.seller_id, artifact_bundle: b.artifact_bundle })
    if (value.contract_id !== expected.contract_id || value.milestone_id !== expected.milestone_id || r.submitted_by !== command.seller_id
      || r.content_hash !== content || sha(r.artifact_bundle) !== sha(b.artifact_bundle) || r.authorizes_payment !== false
      || r.semantic_accuracy !== 'unmeasured' || r.remote_execution_observed !== false) fail('CONTRACT_COMMAND_RECEIPT_MISMATCH')
    return { id: r.id, ...expected, content_hash: content, authorizes_payment: false }
  }
  if (r.contract_id !== expected.contract_id || r.milestone_id !== expected.milestone_id || r.submission_id !== b.submission_id || r.content_hash !== b.content_hash) fail('CONTRACT_COMMAND_RECEIPT_MISMATCH')
  if (command.action === 'accept') {
    if (r.buyer_id !== command.buyer_id || r.kind !== 'explicit_buyer_acceptance' || value.financial_release_performed !== false) fail('CONTRACT_COMMAND_RECEIPT_MISMATCH')
    return { id: r.id, ...expected, submission_id: r.submission_id, content_hash: r.content_hash, financial_release_performed: false }
  }
  if (r.acceptance_id !== b.acceptance_id || r.basis !== 'explicit_buyer_acceptance' || r.rail !== 'credit'
    || r.seller_receives !== 'nonwithdrawable_account_credit' || value.financial_posting_confirmed !== true
    || !uuid(r.settlement_entry_id) || !uuid(r.sale_entry_id) || !Number.isSafeInteger(r.amount_minor) || r.amount_minor < 1) fail('CONTRACT_COMMAND_RECEIPT_MISMATCH')
  return { id: r.id, ...expected, acceptance_id: r.acceptance_id, submission_id: r.submission_id, content_hash: r.content_hash,
    amount_minor: r.amount_minor, settlement_entry_id: r.settlement_entry_id, sale_entry_id: r.sale_entry_id, financial_posting_confirmed: true }
}

/** Recover before sending. An uncertain missing command requires explicit resumeMissing; no automatic retry loop. */
export async function runOriginalContractCommand({ command: raw, apiKey, stateDirectory, fetcher = fetch, prepareOnly = false, reconcileOnly = false, resumeMissing = false }) {
  const command = validateOriginalContractCommand(raw)
  if (typeof apiKey !== 'string' || !apiKey.trim() || typeof stateDirectory !== 'string' || !stateDirectory) fail('CONTRACT_COMMAND_CONFIGURATION_INVALID')
  const reference = sha({ kind: 'original-contract-command-v1', origin: command.origin, actor_id: command.actor_id, action: command.action, client_reference: command.body.client_reference })
  const directory = resolve(stateDirectory), path = resolve(directory, reference + '.json'), commandHash = sha(command)
  return withBuyerStateLock(directory, reference, async signal => {
    let journal = await readBuyerPaymentJournal(path)
    if (journal && (journal.reference !== reference || journal.command_hash !== commandHash || sha(journal.command) !== commandHash
      || typeof journal.attempted !== 'boolean' || !['planned', 'requested', 'recorded'].includes(journal.phase)
      || (journal.phase === 'recorded') !== !!journal.receipt)) fail('CONTRACT_COMMAND_JOURNAL_MISMATCH')
    const save = async () => { signal.throwIfAborted(); await saveBuyerPaymentJournal(path, journal); signal.throwIfAborted() }
    if (!journal) { journal = { version: 1, reference, command_hash: commandHash, command, attempted: false, phase: 'planned', receipt: null }; await save() }
    const api = async (method, endpoint, body, missingCode) => {
      signal.throwIfAborted()
      try {
        const response = await fetcher(command.origin + endpoint, { method, redirect: 'error', credentials: 'omit', signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
          headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
        const reader = response.body?.getReader(), chunks = []; let size = 0
        if (!reader) fail('CONTRACT_COMMAND_RESPONSE_INVALID')
        let value
        try {
          while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 131072) fail('CONTRACT_COMMAND_RESPONSE_TOO_LARGE'); chunks.push(Buffer.from(part.value)) }
          value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
        signal.throwIfAborted()
        if (response.status === 404 && missingCode && value.code === missingCode) return null
        if (!response.ok) fail(`CONTRACT_COMMAND_HTTP_${response.status}`)
        return value
      } catch (error) { if (/^CONTRACT_COMMAND_[A-Z0-9_]+$/.test(error.message || '')) throw error; fail('CONTRACT_COMMAND_UNCERTAIN_RESUME_ORIGINAL') }
    }
    const milestone = `/api/contracts/${command.contract_id}/milestones/${command.milestone_id}`
    const endpoint = command.action === 'fund' ? `/api/organizations/${command.organization_id}/contract-authorizations/${command.authorization_id}/fund`
      : command.action === 'submit' ? milestone + '/submissions' : command.action === 'release' ? milestone + '/release' : milestone
    const selector = command.action === 'accept' ? 'acceptance_reference' : command.action === 'release' ? 'release_reference' : 'client_reference'
    const lookup = (command.action === 'fund' ? endpoint : milestone) + '?' + new URLSearchParams({ [selector]: command.body.client_reference })
    const missing = { fund: 'CONTRACT_FUND_REFERENCE_NOT_FOUND', submit: 'CONTRACT_SUBMISSION_NOT_FOUND', accept: 'CONTRACT_ACCEPTANCE_NOT_FOUND', release: 'CONTRACT_RELEASE_NOT_FOUND' }[command.action]
    const record = async value => {
      const receipt = receiptFor(command, value)
      if (journal.receipt && sha(journal.receipt) !== sha(receipt)) fail('CONTRACT_COMMAND_RECEIPT_CHANGED')
      journal.receipt = receipt; journal.phase = 'recorded'; await save()
      return { state: 'recorded', action: command.action, client_reference: command.body.client_reference, receipt,
        observed_at: value.observed_at ?? new Date().toISOString(), credit_remaining_principal_minor: value.credit_remaining_principal_minor }
    }
    const original = await api('GET', lookup, undefined, missing)
    if (original) return record(original)
    if (journal.receipt) fail('CONTRACT_COMMAND_ORIGINAL_RECORD_UNAVAILABLE')
    if (prepareOnly || reconcileOnly) return { state: journal.attempted ? 'awaiting_explicit_same_command_resume' : 'prepared', action: command.action, client_reference: command.body.client_reference }
    if (journal.attempted && !resumeMissing) fail('CONTRACT_COMMAND_MISSING_REQUIRES_EXPLICIT_RESUME')
    // Current-party/quote checks apply only to fresh writes, never erase original recovery.
    const view = await api('GET', `/api/contracts/${command.contract_id}`), c = view.contract
    if (c?.id !== command.contract_id || c.buyer_id !== command.buyer_id || c.seller_id !== command.seller_id
      || command.action !== 'fund' && !view.milestones?.some(m => m.id === command.milestone_id)) fail('CONTRACT_COMMAND_SCOPE_MISMATCH')
    if (command.action === 'fund' && (c.payment_rail !== 'credit' || Math.round(c.escrow_amount * 100) !== command.gross_minor
      || Math.round(c.total_amount * 100) !== command.principal_minor || Math.round(c.fee_amount * 100) !== command.upfront_fee_minor
      || canonicalJSON(view.milestones?.map(m => m.id)) !== canonicalJSON(command.milestone_ids))) fail('CONTRACT_COMMAND_QUOTE_MISMATCH')
    journal.attempted = true; journal.phase = 'requested'; await save()
    return record(await api(command.action === 'accept' ? 'PATCH' : 'POST', endpoint, command.action === 'accept' ? { ...command.body, action: 'approve' } : command.body))
  })
}

async function cli() {
  const args = process.argv.slice(2), options = {}
  for (let i = 0; i < args.length; i++) {
    if (['--command', '--state-dir'].includes(args[i]) && args[i + 1]) options[args[i].slice(2)] = args[++i]
    else if (['--prepare-only', '--reconcile-only', '--resume-missing'].includes(args[i])) options[args[i].slice(2)] = true
    else fail('CONTRACT_COMMAND_ARGUMENTS_INVALID')
  }
  if (!options.command || !options['state-dir']) fail('CONTRACT_COMMAND_FILE_AND_STATE_REQUIRED')
  const command = await readBuyerPaymentJournal(resolve(options.command))
  if (!command) fail('CONTRACT_COMMAND_FILE_REQUIRED')
  const apiKey = command.action === 'submit' ? process.env.CLAWDMARKET_PROVIDER_API_KEY : process.env.CLAWDMARKET_BUYER_API_KEY
  process.stdout.write(JSON.stringify(await runOriginalContractCommand({ command, apiKey, stateDirectory: options['state-dir'],
    prepareOnly: options['prepare-only'] === true, reconcileOnly: options['reconcile-only'] === true, resumeMissing: options['resume-missing'] === true })) + '\n')
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) cli().catch(error => {
  process.stderr.write((/^CONTRACT_COMMAND_[A-Z0-9_]+$/.test(error.message || '') ? error.message : 'CONTRACT_COMMAND_STOPPED_RESUME_ORIGINAL') + '\n'); process.exitCode = 1
})
