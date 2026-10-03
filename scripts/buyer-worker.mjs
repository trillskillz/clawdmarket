/** Buyer-operated EVM funding. No provider work, acceptance or settlement signing. */
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseUnits } from 'viem'
import { canonicalJSON } from './verifier-contract.mjs'
import { inspectSignedEvmPayment, assertBuyerWalletReserve } from '../lib/buyer-signed-transaction.mjs'
import { evmPaymentProofMessage } from '../lib/evm-payment-message.mjs'
import { readBuyerPaymentJournal, saveBuyerPaymentJournal } from './buyer-payment-journal.mjs'
import { buyerWalletReference, withBuyerWalletLock } from './buyer-wallet-lock.mjs'
import { createBuyerEvmAdapter } from './buyer-evm-adapter.mjs'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const hash = (value) => createHash('sha256').update(canonicalJSON(value)).digest('hex')
function fail(code) { throw new Error(code) }
function origin(value) {
  const url = new URL(value)
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/'
    || url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) fail('BUYER_ORIGIN_INVALID')
  return url.origin
}
function minor(value) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,8})(?:\.[0-9]{1,2})?$/.test(value)) fail('BUYER_MANDATE_INVALID')
  return Number(parseUnits(value, 2))
}
function pinnedMandate(mandate, approval) {
  if (!mandate || mandate.id !== approval.mandate_id || mandate.route_id !== approval.route_id || mandate.terms_hash !== approval.terms_hash
    || mandate.terms?.version !== 1 || mandate.terms.payment?.rail !== 'evm' || mandate.terms.private_data !== 'selected_provider_only') fail('BUYER_MANDATE_SCOPE_MISMATCH')
  const terms = { ...mandate.terms, max_aggregate: minor(mandate.terms.max_aggregate), max_per_execution: minor(mandate.terms.max_per_execution), max_retry_budget: minor(mandate.terms.max_retry_budget) }
  if (hash(terms) !== approval.terms_hash) fail('BUYER_MANDATE_SCOPE_MISMATCH')
  return mandate.terms.payment
}
const immutableIntentHash = (intent) => hash({ ...intent, tx_hash: undefined, payer_signature: undefined })
const doneStates = ['funded', 'refund_pending', 'refunded']
async function chainCall(operation) {
  try { return await operation() } catch (error) {
    if (error instanceof Error && /^BUYER_[A-Z0-9_]+$/.test(error.message)) throw error
    fail('BUYER_CHAIN_UNAVAILABLE_RESUME_SAME_PAYMENT')
  }
}

/** One bounded pass; resume the same approval/state after any uncertain result.
 * @param {{approval: any, apiKey: string, stateDirectory?: string, account?: import('viem').LocalAccount, adapter?: ReturnType<typeof createBuyerEvmAdapter>, fetcher?: typeof fetch, prepareOnly?: boolean}} options
 * @returns {Promise<{state: string, route_id: string, trade_id?: string, tx_hash?: string, idempotent?: boolean, funds_moved?: boolean}>}
 */
export async function runBuyerFunding({ approval, apiKey, stateDirectory = undefined, account = undefined, adapter = undefined, fetcher = fetch, prepareOnly = false }) {
  if (approval?.version !== 1 || !uuid.test(approval.route_id) || typeof apiKey !== 'string' || !apiKey.trim()) fail('BUYER_CONFIGURATION_INVALID')
  const base = origin(approval.origin)
  let lockSignal
  const api = async (method, path, body, allowConfirming = false) => {
    lockSignal?.throwIfAborted()
    let response
    try {
      response = await fetcher(`${base}${path}`, { method, redirect: 'error', credentials: 'omit',
        signal: AbortSignal.any([AbortSignal.timeout(10_000), ...(lockSignal ? [lockSignal] : [])]),
        headers: { Authorization: `Bearer ${apiKey.trim()}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
      const reader = response.body?.getReader(), chunks = []
      if (!reader) fail('BUYER_RESPONSE_INVALID')
      let size = 0, value
      try {
        while (true) {
          const part = await reader.read()
          if (part.done) break
          size += part.value.byteLength
          if (size > 65_536) fail('BUYER_RESPONSE_TOO_LARGE')
          chunks.push(Buffer.from(part.value))
        }
        value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
      lockSignal?.throwIfAborted()
      if (!response.ok) {
        if (allowConfirming && response.status === 409 && value.code === 'PAYMENT_CONFIRMING' && value.retryable === true) return { confirming: true }
        fail(`BUYER_HTTP_${response.status}`)
      }
      return value
    } catch (error) {
      if (error instanceof Error && /^BUYER_[A-Z0-9_]+$/.test(error.message)) throw error
      fail('BUYER_REQUEST_UNCERTAIN_RESUME_SAME_PAYMENT')
    }
  }
  // A plan/read key without explicit authority cannot reserve or sign anything.
  if (!approval.mandate_id) {
    const result = await api('GET', `/api/routes/${approval.route_id}`)
    if (result.route?.id !== approval.route_id) fail('BUYER_ROUTE_SCOPE_MISMATCH')
    return { state: 'plan_only', route_id: approval.route_id, funds_moved: false }
  }
  if (!uuid.test(approval.mandate_id) || !/^[a-f0-9]{64}$/.test(approval.terms_hash) || !stateDirectory
    || account?.type !== 'local' || typeof account.signMessage !== 'function') fail('BUYER_CONFIGURATION_INVALID')
  if (approval.retry_operation_id !== undefined && (!uuid.test(approval.retry_operation_id) || !uuid.test(approval.previous_trade_id))
    || approval.previous_trade_id !== undefined && !approval.retry_operation_id) fail('BUYER_CONFIGURATION_INVALID')
  const grant = await api('GET', `/api/routes/${approval.route_id}/mandate`)
  const payment = pinnedMandate(grant.mandate, approval)
  if (account.address.toLowerCase() !== payment.payer_address || adapter?.chainId !== payment.chain_id) fail('BUYER_WALLET_SCOPE_MISMATCH')
  return withBuyerWalletLock(stateDirectory, payment.chain_id, payment.payer_address, async (signal) => {
    lockSignal = signal
    const reference = hash({ origin: base, route_id: approval.route_id, mandate_id: approval.mandate_id, terms_hash: approval.terms_hash, ...(approval.retry_operation_id ? { retry_operation_id: approval.retry_operation_id, previous_trade_id: approval.previous_trade_id } : {}) })
    const directory = resolve(stateDirectory), wallet = buyerWalletReference(payment.chain_id, payment.payer_address)
    const stateFile = resolve(directory, `${reference}.json`), walletFile = resolve(directory, `${wallet}.json`)
    let journal = await readBuyerPaymentJournal(stateFile)
    const currentWallet = await readBuyerPaymentJournal(walletFile)
    if (journal && (journal.reference !== reference || journal.wallet !== wallet || journal.origin !== base
      || journal.route_id !== approval.route_id || journal.mandate_id !== approval.mandate_id || journal.terms_hash !== approval.terms_hash || !uuid.test(journal.operation_id))) fail('BUYER_JOURNAL_SCOPE_MISMATCH')
    const result = () => ({ state: journal.state, route_id: journal.route_id, trade_id: journal.trade_id, tx_hash: journal.tx_hash, idempotent: true })
    if (journal && doneStates.includes(journal.state)) return result()
    if (currentWallet && (currentWallet.wallet !== wallet || !/^[a-f0-9]{64}$/.test(currentWallet.active_reference))) fail('BUYER_JOURNAL_SCOPE_MISMATCH')
    if (currentWallet && currentWallet.active_reference !== reference) {
      const previous = await readBuyerPaymentJournal(resolve(directory, `${currentWallet.active_reference}.json`))
      if (!previous || previous.wallet !== wallet || previous.reference !== currentWallet.active_reference || !doneStates.includes(previous.state)) fail('BUYER_WALLET_PAYMENT_UNRECONCILED')
    }
    await saveBuyerPaymentJournal(walletFile, { version: 1, wallet, active_reference: reference })
    if (!journal) {
      journal = { version: 1, reference, wallet, origin: base, route_id: approval.route_id, mandate_id: approval.mandate_id, terms_hash: approval.terms_hash,
        operation_id: crypto.randomUUID(), state: 'planned', submission_started: false }
      await saveBuyerPaymentJournal(stateFile, journal)
    }
    const save = async () => { signal.throwIfAborted(); await saveBuyerPaymentJournal(stateFile, journal) }
    if (!journal.trade_id) {
      const reserved = await api('POST', `/api/routes/${approval.route_id}/${approval.retry_operation_id ? 'retry' : 'execute'}`, approval.retry_operation_id
        ? { version: 1, mandate_id: approval.mandate_id, retry_operation_id: approval.retry_operation_id, previous_trade_id: approval.previous_trade_id } : { mandate_id: approval.mandate_id })
      if (reserved.route?.id !== approval.route_id || !uuid.test(reserved.trade?.id) || reserved.trade.buyer_id !== grant.mandate.buyer_id || reserved.trade.payment_rail !== 'evm'
        || !uuid.test(reserved.order?.id) || reserved.order.trade_id !== reserved.trade.id) fail('BUYER_CHECKOUT_SCOPE_MISMATCH')
      journal.trade_id = reserved.trade.id; journal.order_id = reserved.order.id; journal.state = 'reserved'; await save()
    }
    const intentPath = `/api/trades/${journal.trade_id}/fund/evm/intent`, fundPath = `/api/trades/${journal.trade_id}/fund/evm`
    if (!journal.intent) {
      journal.state = 'intent_requested'; await save()
      const created = await api('POST', intentPath, { buyer_operation_id: journal.operation_id, chain_id: payment.chain_id,
        token_address: payment.token_address, payer_address: payment.payer_address })
      const intent = created.intent
      if (!intent || !uuid.test(intent.id) || intent.buyer_operation_id !== journal.operation_id || intent.trade_id !== journal.trade_id
        || intent.buyer_id !== grant.mandate.buyer_id || intent.origin !== base || intent.chain_id !== payment.chain_id
        || intent.payer_address !== payment.payer_address || intent.token_address !== payment.token_address || intent.treasury_address !== payment.treasury_address
        || intent.token_decimals !== grant.mandate.terms.token_decimals || intent.token_usd_price !== grant.mandate.terms.token_usd_price
        || !Number.isFinite(intent.amount_usd) || intent.amount_usd <= 0 || Math.round(intent.amount_usd * 100) > minor(grant.mandate.terms.max_per_execution)
        || BigInt(intent.token_amount) !== parseUnits((intent.amount_usd / intent.token_usd_price).toFixed(intent.token_decimals), intent.token_decimals)
        || intent.tx_hash || created.claim_required !== true) fail('BUYER_ORIGINAL_INTENT_REQUIRED')
      journal.intent = intent; journal.intent_hash = immutableIntentHash(intent); journal.state = 'intent_ready'; await save()
    }
    if (immutableIntentHash(journal.intent) !== journal.intent_hash || journal.intent.buyer_operation_id !== journal.operation_id
      || journal.intent.trade_id !== journal.trade_id) fail('BUYER_JOURNAL_SCOPE_MISMATCH')
    if (!journal.serialized_transaction) {
      if (journal.submission_started || journal.tx_hash || journal.payer_signature) fail('BUYER_ORIGINAL_TRANSACTION_REQUIRED')
      if (grant.mandate.state !== 'active' || !(Date.parse(grant.mandate.expires_at) > Date.now())) fail('BUYER_MANDATE_INACTIVE')
      const raw = await chainCall(() => adapter.prepare(journal.intent, signal)), checked = await inspectSignedEvmPayment(raw, journal.intent, payment)
      assertBuyerWalletReserve({ ...await chainCall(() => adapter.snapshot(raw, payment, signal)), paymentAmount: BigInt(journal.intent.token_amount), payment })
      const signature = await account.signMessage({ message: evmPaymentProofMessage(journal.intent, checked.tx_hash) })
      journal.serialized_transaction = raw; journal.tx_hash = checked.tx_hash; journal.payer_signature = signature; journal.state = 'signed'; await save()
    }
    const checked = await inspectSignedEvmPayment(journal.serialized_transaction, journal.intent, payment)
    if (checked.tx_hash !== journal.tx_hash || !/^0x[a-fA-F0-9]{130}$/.test(journal.payer_signature) || typeof journal.submission_started !== 'boolean') fail('BUYER_JOURNAL_SCOPE_MISMATCH')
    if (prepareOnly && !journal.submission_started) return { ...result(), state: 'prepared' }
    const proof = { intent_id: journal.intent.id, chain_id: payment.chain_id, token_address: payment.token_address, payer_address: payment.payer_address,
      tx_hash: journal.tx_hash, payer_signature: journal.payer_signature }
    async function reconcile() {
      const funded = await api('POST', fundPath, proof, true)
      if (funded.confirming) return false
      const saved = await api('GET', intentPath)
      if (saved.intent?.id !== journal.intent.id || immutableIntentHash(saved.intent) !== journal.intent_hash || saved.claim?.tx_hash !== journal.tx_hash
        || saved.claim.state !== 'confirmed' || saved.trade?.id !== journal.trade_id || funded.ok !== true) fail('BUYER_FUNDING_RECEIPT_MISMATCH')
      if (['escrow_held', 'pending_release', 'completed', 'complete', 'disputed', 'resolved'].includes(saved.trade.status)) journal.state = 'funded'
      else if (saved.trade.status === 'cancelled' && saved.trade.payout_status === 'refunded') journal.state = 'refunded'
      else if (saved.trade.status === 'cancelled' && saved.trade.payout_status === 'processing') journal.state = 'refund_pending'
      else fail('BUYER_FUNDING_RECEIPT_MISMATCH')
      await save(); return true
    }
    if (journal.submission_started && await reconcile()) return result()
    const claim = await api('POST', `${fundPath}/claim`, { intent_id: journal.intent.id, mandate_id: approval.mandate_id, buyer_operation_id: journal.operation_id,
      serialized_transaction: journal.serialized_transaction, payer_signature: journal.payer_signature })
    if (claim.claim?.tx_hash !== journal.tx_hash || claim.claim.intent_id !== journal.intent.id || claim.claim.terms_hash !== approval.terms_hash) fail('BUYER_CLAIM_SCOPE_MISMATCH')
    if (claim.send_allowed !== true) {
      if (await reconcile()) return result()
      return { ...result(), state: 'held_recover_existing_payment' }
    }
    if (journal.submission_started && await chainCall(() => adapter.lookup(journal.tx_hash, signal))) return { ...result(), state: 'awaiting_confirmation' }
    assertBuyerWalletReserve({ ...await chainCall(() => adapter.snapshot(journal.serialized_transaction, payment, signal)), paymentAmount: BigInt(journal.intent.token_amount), payment })
    // No external submission until this marker and the immutable raw bytes are durable.
    journal.submission_started = true; journal.state = 'payment_unknown'; await save()
    signal.throwIfAborted()
    let submitted
    try { submitted = await adapter.broadcast(journal.serialized_transaction, signal) } catch { fail('BUYER_BROADCAST_UNCERTAIN_RESUME_SAME_PAYMENT') }
    if (submitted?.toLowerCase() !== journal.tx_hash) fail('BUYER_BROADCAST_HASH_MISMATCH')
    if (await reconcile()) return { ...result(), idempotent: false }
    return { ...result(), state: 'awaiting_confirmation' }
  })
}

async function cli() {
  const [approvalPath, stateDirectory, mode] = process.argv.slice(2)
  if (!approvalPath || !stateDirectory || mode && mode !== '--prepare-only') fail('BUYER_APPROVAL_AND_STATE_REQUIRED')
  const approval = await readBuyerPaymentJournal(resolve(approvalPath))
  if (!approval) fail('BUYER_APPROVAL_AND_STATE_REQUIRED')
  let account, adapter
  if (approval.mandate_id) {
    const { privateKeyToAccount } = await import('viem/accounts')
    // Read only on the buyer host; never passed to app, journal, command arguments or output.
    account = privateKeyToAccount(process.env.CLAWDMARKET_BUYER_PRIVATE_KEY)
    adapter = createBuyerEvmAdapter({ chainId: approval.chain_id, rpcUrl: approval.rpc_url, account })
  }
  process.stdout.write(`${JSON.stringify(await runBuyerFunding({ approval, apiKey: process.env.CLAWDMARKET_BUYER_API_KEY, stateDirectory,
    account, adapter, prepareOnly: mode === '--prepare-only' }))}\n`)
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) cli().catch((error) => {
  process.stderr.write(`${/^BUYER_[A-Z0-9_]+$/.test(error.message) ? error.message : 'BUYER_WORKER_STOPPED_RESUME_SAME_PAYMENT'}\n`); process.exitCode = 1
})
