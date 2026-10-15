/** Finite buyer-host funding of one independently reviewed public listing. */
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Credential } from 'mppx'
import { keccak256, parseUnits, toHex } from 'viem'
import { Account } from 'viem/tempo'
import { canonicalJSON } from './verifier-contract.mjs'
import { readBuyerPaymentJournal, saveBuyerPaymentJournal } from './buyer-payment-journal.mjs'
import { buyerWalletReference, withBuyerWalletLock } from './buyer-wallet-lock.mjs'
import { inspectSignedEvmPayment, assertBuyerWalletReserve } from '../lib/buyer-signed-transaction.mjs'
import { inspectSignedTempoPayment } from '../lib/buyer-tempo-transaction.mjs'
import { assertBuyerTempoReserve } from '../lib/buyer-tempo-fees.mjs'
import { evmPaymentProofMessage } from '../lib/evm-payment-message.mjs'
import { createBuyerEvmAdapter } from './buyer-evm-adapter.mjs'
import { createBuyerTempoAdapter } from './buyer-tempo-adapter.mjs'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const digest = value => createHash('sha256').update(canonicalJSON(value)).digest('hex')
const terminal = ['funded', 'refunded']
function fail(code) { throw new Error(code) }
function origin(value) {
  const url = new URL(value)
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/'
    || url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) fail('BUYER_ORIGIN_INVALID')
  return url.origin
}
const frozenIntent = intent => digest({ ...intent, tx_hash: undefined, payer_signature: undefined })
async function chain(operation) {
  try { return await operation() } catch (error) {
    if (/^BUYER_[A-Z0-9_]+$/.test(error.message || '')) throw error
    fail('BUYER_CHAIN_UNAVAILABLE_RESUME_SAME_PAYMENT')
  }
}
export function validateBuyerListingApproval(approval) {
  if (![1, 2].includes(approval?.version) || !['organization_id', 'authorization_id'].every(key => uuid.test(approval[key]))
    || typeof approval.listing_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{2,199}$/.test(approval.listing_id)
    || typeof approval.buyer_id !== 'string' || !approval.buyer_id.startsWith('user_agent_') || !/^[a-f0-9]{64}$/.test(approval.authority_hash || '')
    || !Number.isSafeInteger(approval.total_minor) || approval.total_minor < 1 || !Number.isFinite(Date.parse(approval.expires_at))) fail('BUYER_LISTING_APPROVAL_INVALID')
  const payment = approval.payment
  if (!payment || payment.rail !== (approval.version === 1 ? 'evm' : 'mpp')
    || !['token_address', 'payer_address', 'treasury_address'].every(key => /^0x[0-9a-f]{40}$/.test(payment[key] || ''))
    || !Number.isInteger(approval.token_decimals) || approval.token_decimals < 0 || approval.token_decimals > 36
    || !Number.isFinite(approval.token_usd_price) || approval.token_usd_price <= 0
    || payment.rail === 'evm' && payment.chain_id !== 1
    || payment.rail === 'mpp' && (payment.chain_id !== 4217 || approval.token_decimals !== 6 || approval.token_usd_price !== 1
      || approval.fee_token_decimals !== 6 || payment.fee_token_address !== payment.token_address)) fail('BUYER_LISTING_APPROVAL_INVALID')
  return payment
}

/** Never accepts delivery, replaces a checkout, signs another transaction or tops up a wallet. */
export async function runBuyerListingFunding({ approval, apiKey, stateDirectory, account, adapter, fetcher = fetch, prepareOnly = false }) {
  const payment = validateBuyerListingApproval(approval), base = origin(approval.origin)
  if (typeof apiKey !== 'string' || !apiKey.trim() || !stateDirectory || account?.type !== 'local'
    || typeof account.signTransaction !== 'function' || account.address.toLowerCase() !== payment.payer_address
    || adapter?.chainId !== payment.chain_id || adapter.rpcUrl !== new URL(approval.rpc_url).toString()) fail('BUYER_CONFIGURATION_INVALID')
  return withBuyerWalletLock(stateDirectory, payment.chain_id, payment.payer_address, async signal => {
    const api = async (method, path, body, { credential, confirming = false } = {}) => {
      signal.throwIfAborted()
      try {
        const response = await fetcher(base + path, { method, redirect: 'error', credentials: 'omit',
          signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]), headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json',
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(credential ? { 'Payment-Authorization': credential } : {}) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
        const reader = response.body?.getReader(), chunks = []; if (!reader) fail('BUYER_RESPONSE_INVALID')
        let size = 0, value
        try {
          while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 65_536) fail('BUYER_RESPONSE_TOO_LARGE'); chunks.push(Buffer.from(part.value)) }
          value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
        signal.throwIfAborted()
        if (!response.ok) {
          if (confirming && response.status === 409 && value.code === 'PAYMENT_CONFIRMING' && value.retryable === true) return { confirming: true }
          fail(`BUYER_HTTP_${response.status}`)
        }
        return value
      } catch (error) {
        if (/^BUYER_[A-Z0-9_]+$/.test(error.message || '')) throw error
        fail('BUYER_REQUEST_UNCERTAIN_RESUME_SAME_PAYMENT')
      }
    }
    const directory = resolve(stateDirectory), reference = digest({ kind: 'organization-listing-funding-v1', origin: base, approval })
    const wallet = buyerWalletReference(payment.chain_id, payment.payer_address), stateFile = resolve(directory, reference + '.json'), walletFile = resolve(directory, wallet + '.json')
    let journal = await readBuyerPaymentJournal(stateFile)
    if (journal && (journal.reference !== reference || journal.approval_hash !== digest(approval) || journal.wallet !== wallet || journal.origin !== base
      || journal.authorization_id !== approval.authorization_id || journal.listing_id !== approval.listing_id || !uuid.test(journal.operation_id)
      || !uuid.test(journal.checkout_reference) || journal.rail !== payment.rail)) fail('BUYER_JOURNAL_SCOPE_MISMATCH')
    const previousWallet = await readBuyerPaymentJournal(walletFile)
    if (previousWallet && (previousWallet.wallet !== wallet || !/^[a-f0-9]{64}$/.test(previousWallet.active_reference))) fail('BUYER_JOURNAL_SCOPE_MISMATCH')
    if (previousWallet && previousWallet.active_reference !== reference) {
      const previous = await readBuyerPaymentJournal(resolve(directory, previousWallet.active_reference + '.json'))
      if (!previous || previous.reference !== previousWallet.active_reference || previous.wallet !== wallet || !terminal.includes(previous.state)) fail('BUYER_WALLET_PAYMENT_UNRECONCILED')
    }
    const save = async () => { signal.throwIfAborted(); await saveBuyerPaymentJournal(stateFile, journal); signal.throwIfAborted() }
    if (!journal) {
      journal = { version: 1, reference, approval_hash: digest(approval), wallet, origin: base, authorization_id: approval.authorization_id,
        listing_id: approval.listing_id, operation_id: crypto.randomUUID(), checkout_reference: crypto.randomUUID(), rail: payment.rail, state: 'planned', submission_started: false }
      await save()
    }
    await saveBuyerPaymentJournal(walletFile, { version: 1, wallet, active_reference: reference })
    const checkoutPath = `/api/organizations/${approval.organization_id}/listing-authorizations/${approval.authorization_id}/checkout`
    const checkCheckout = value => {
      const authority = value.payment_authority, terms = authority?.terms
      if (value.ok !== true || value.authorization_id !== approval.authorization_id || value.authority_hash !== approval.authority_hash || value.listing_id !== approval.listing_id
        || authority?.id !== approval.authorization_id || authority.authority_hash !== approval.authority_hash
        || authority.kind !== `organization_listing_v${approval.version}` || digest(terms?.payment) !== digest(payment)
        || terms.token_decimals !== approval.token_decimals || terms.token_usd_price !== approval.token_usd_price || terms.expires_at !== approval.expires_at
        || payment.rail === 'mpp' && terms.fee_token_decimals !== 6) fail('BUYER_CHECKOUT_SCOPE_MISMATCH')
      if (value.trade && (!uuid.test(value.trade.id) || value.trade.buyer_id !== approval.buyer_id || value.trade.payment_rail !== payment.rail
        || Math.round(value.trade.total_cost * 100) !== approval.total_minor || journal.trade_id && value.trade.id !== journal.trade_id)) fail('BUYER_CHECKOUT_SCOPE_MISMATCH')
      return value
    }
    let checkout = checkCheckout(await api('GET', checkoutPath))
    if (!checkout.trade) {
      if (journal.trade_id || journal.intent || journal.serialized_transaction || journal.submission_started) fail('BUYER_ORIGINAL_CHECKOUT_REQUIRED')
      journal.state = 'checkout_requested'; await save()
      checkout = checkCheckout(await api('POST', checkoutPath, { version: approval.version, client_reference: journal.checkout_reference, authority_hash: approval.authority_hash }))
    }
    if (!checkout.trade) fail('BUYER_ORIGINAL_CHECKOUT_REQUIRED')
    journal.trade_id = checkout.trade.id; await save()
    const path = `/api/trades/${journal.trade_id}/fund/${payment.rail}`
    const result = () => ({ state: journal.state, authorization_id: approval.authorization_id, listing_id: approval.listing_id,
      trade_id: journal.trade_id, tx_hash: journal.tx_hash ?? null, idempotent: true })
    const inspection = () => api('GET', path + '/intent')
    const tokenAmount = parseUnits(((approval.total_minor / 100) / approval.token_usd_price).toFixed(approval.token_decimals), approval.token_decimals).toString()
    const checkIntent = intent => {
      if (!intent || !uuid.test(intent.id) || intent.buyer_operation_id !== journal.operation_id || intent.trade_id !== journal.trade_id
        || intent.buyer_id !== approval.buyer_id || intent.origin !== base || intent.chain_id !== payment.chain_id
        || intent.payer_address !== payment.payer_address || intent.token_address !== payment.token_address || intent.treasury_address !== payment.treasury_address
        || intent.token_decimals !== approval.token_decimals || Math.round(intent.amount_usd * 100) !== approval.total_minor || intent.token_amount !== tokenAmount
        || !Number.isFinite(Date.parse(intent.expires_at)) || Date.parse(intent.expires_at) > Date.parse(approval.expires_at)) fail('BUYER_ORIGINAL_INTENT_REQUIRED')
      if (payment.rail === 'mpp') {
        const challenge = intent.challenge
        if (intent.authorization_id !== approval.authorization_id || intent.authority_hash !== approval.authority_hash
          || challenge?.method !== 'tempo' || challenge.intent !== 'charge' || challenge.request?.amount !== intent.token_amount
          || challenge.request.currency?.toLowerCase() !== payment.token_address || challenge.request.recipient?.toLowerCase() !== payment.treasury_address
          || challenge.request.externalId !== journal.trade_id || challenge.request.methodDetails?.chainId !== payment.chain_id
          || challenge.request.methodDetails?.memo !== keccak256(toHex(`clawdmarket:${journal.trade_id}`)) || challenge.request.methodDetails?.feePayer === true
          || challenge.request.methodDetails?.splits?.length || challenge.expires !== intent.expires_at) fail('BUYER_ORIGINAL_INTENT_REQUIRED')
      } else if (intent.token_usd_price !== approval.token_usd_price) fail('BUYER_ORIGINAL_INTENT_REQUIRED')
      return intent
    }
    if (!journal.intent) {
      if (journal.serialized_transaction || journal.tx_hash || journal.submission_started) fail('BUYER_ORIGINAL_INTENT_REQUIRED')
      journal.state = 'intent_requested'; await save()
      const made = await api('POST', path + '/intent', { buyer_operation_id: journal.operation_id,
        ...(payment.rail === 'evm' ? { chain_id: payment.chain_id, token_address: payment.token_address, payer_address: payment.payer_address } : {}) })
      if (made.claim_required !== true || made.intent?.tx_hash) fail('BUYER_ORIGINAL_INTENT_REQUIRED')
      journal.intent = checkIntent(made.intent); journal.intent_hash = frozenIntent(journal.intent); journal.state = 'intent_ready'; await save()
    }
    checkIntent(journal.intent)
    if (frozenIntent(journal.intent) !== journal.intent_hash) fail('BUYER_JOURNAL_SCOPE_MISMATCH')
    let server = await inspection()
    if (!server.intent || frozenIntent(server.intent) !== journal.intent_hash) fail('BUYER_ORIGINAL_INTENT_REQUIRED')
    const inspect = raw => payment.rail === 'evm' ? inspectSignedEvmPayment(raw, journal.intent, payment) : inspectSignedTempoPayment(raw, journal.intent, payment)
    const reserve = async raw => {
      const snapshot = await chain(() => adapter.snapshot(raw, payment, signal)), common = { ...snapshot, paymentAmount: BigInt(journal.intent.token_amount), payment }
      if (payment.rail === 'evm') assertBuyerWalletReserve(common); else assertBuyerTempoReserve(common)
    }
    if (!journal.serialized_transaction) {
      if (journal.submission_started || journal.tx_hash || journal.payer_signature || journal.credential || server.claim) fail('BUYER_ORIGINAL_TRANSACTION_REQUIRED')
      const raw = await chain(() => adapter.prepare(journal.intent, signal)), checked = await inspect(raw); await reserve(raw)
      journal.serialized_transaction = raw; journal.tx_hash = checked.tx_hash
      if (payment.rail === 'evm') journal.payer_signature = await account.signMessage({ message: evmPaymentProofMessage(journal.intent, checked.tx_hash) })
      else journal.credential = Credential.serialize({ challenge: journal.intent.challenge, payload: { type: 'transaction', signature: raw }, source: `did:pkh:eip155:${payment.chain_id}:${payment.payer_address}` })
      journal.state = 'signed'; await save()
    }
    const checked = await inspect(journal.serialized_transaction)
    if (journal.tx_hash !== checked.tx_hash || typeof journal.submission_started !== 'boolean'
      || payment.rail === 'evm' && !/^0x[a-fA-F0-9]{130}$/.test(journal.payer_signature || '')
      || payment.rail === 'mpp' && journal.credential !== Credential.serialize({ challenge: journal.intent.challenge,
        payload: { type: 'transaction', signature: journal.serialized_transaction }, source: `did:pkh:eip155:${payment.chain_id}:${payment.payer_address}` })) fail('BUYER_JOURNAL_SCOPE_MISMATCH')
    const claimMatches = claim => claim?.intent_id === journal.intent.id && claim.trade_id === journal.trade_id
      && claim.authorization_id === approval.authorization_id && claim.authority_hash === approval.authority_hash
      && claim.tx_hash === journal.tx_hash && claim.chain_id === payment.chain_id && claim.payer_address === payment.payer_address && claim.nonce === checked.nonce
      && (payment.rail === 'mpp' ? claim.valid_before === checked.valid_before && claim.maximum_fee_token_cost_units === checked.maximum_fee_token_cost_units
        && claim.fee_token_address === payment.fee_token_address : claim.maximum_execution_gas_cost_wei === checked.maximum_execution_gas_cost_wei)
    if (server.claim && !claimMatches(server.claim)) fail('BUYER_CLAIM_SCOPE_MISMATCH')
    const proof = payment.rail === 'evm' ? { intent_id: journal.intent.id, chain_id: payment.chain_id, token_address: payment.token_address,
      payer_address: payment.payer_address, tx_hash: journal.tx_hash, payer_signature: journal.payer_signature } : { tx_hash: journal.tx_hash, payer_address: payment.payer_address }
    if (server.claim?.state === 'confirmed' && server.trade?.id === journal.trade_id) {
      if (['escrow_held', 'pending_release', 'completed', 'complete', 'disputed', 'resolved'].includes(server.trade.status)) {
        journal.state = 'funded'; await save(); return result()
      }
      if (server.trade.status === 'cancelled' && server.trade.payout_status === 'refunded') {
        journal.state = 'refunded'; await save(); return result()
      }
    }
    const reconcile = async () => {
      const funded = await api('POST', path, proof, { confirming: true })
      if (funded.confirming) return false
      server = await inspection()
      if (!server.intent || frozenIntent(server.intent) !== journal.intent_hash || !claimMatches(server.claim)
        || server.claim.state !== 'confirmed' || server.trade?.id !== journal.trade_id || funded.ok !== true) fail('BUYER_FUNDING_RECEIPT_MISMATCH')
      if (['escrow_held', 'pending_release', 'completed', 'complete', 'disputed', 'resolved'].includes(server.trade.status)) journal.state = 'funded'
      else if (server.trade.status === 'cancelled' && server.trade.payout_status === 'refunded') journal.state = 'refunded'
      else if (server.trade.status === 'cancelled' && server.trade.payout_status === 'processing') journal.state = 'refund_pending'
      else fail('BUYER_FUNDING_RECEIPT_MISMATCH')
      await save(); return true
    }
    if (server.claim?.state === 'confirmed' || journal.submission_started || server.claim?.first_submission_at) {
      const observed = server.claim?.state === 'confirmed' || await chain(() => adapter.lookup(journal.tx_hash, signal))
      if (observed) {
        if (await reconcile()) return result()
        return { ...result(), state: 'awaiting_confirmation' }
      }
    }
    const claimBody = { intent_id: journal.intent.id, mandate_id: approval.authorization_id, buyer_operation_id: journal.operation_id,
      serialized_transaction: journal.serialized_transaction, ...(payment.rail === 'evm' ? { payer_signature: journal.payer_signature } : {}) }
    const claim = async () => {
      const value = await api('POST', path + '/claim', claimBody)
      if (!claimMatches(value.claim)) fail('BUYER_CLAIM_SCOPE_MISMATCH')
      return value
    }
    let claimed = await claim()
    if (claimed.send_allowed !== true) {
      const observed = await chain(() => adapter.lookup(journal.tx_hash, signal))
      if (journal.submission_started || observed) {
        journal.submission_started = true; journal.state = 'payment_unknown'; await save()
        if (await reconcile()) return result()
      }
      return { ...result(), state: 'held_recover_existing_payment' }
    }
    journal.state = 'claimed'; await save()
    if (prepareOnly && !journal.submission_started && !server.claim?.first_submission_at) return { ...result(), state: 'prepared' }
    await reserve(journal.serialized_transaction)
    journal.submission_started = true; journal.state = 'payment_unknown'; await save()
    // Reserve RPCs and journal I/O can race revocation. Recheck the identical claim last.
    claimed = await claim()
    if (claimed.send_allowed !== true) {
      if (await chain(() => adapter.lookup(journal.tx_hash, signal)) && await reconcile()) return result()
      return { ...result(), state: 'held_recover_existing_payment' }
    }
    signal.throwIfAborted()
    if (payment.rail === 'evm') {
      let hash; try { hash = await adapter.broadcast(journal.serialized_transaction, signal) } catch { fail('BUYER_BROADCAST_UNCERTAIN_RESUME_SAME_PAYMENT') }
      if (hash?.toLowerCase() !== journal.tx_hash) fail('BUYER_BROADCAST_HASH_MISMATCH')
    } else await api('POST', path, undefined, { credential: journal.credential, confirming: true })
    if (await reconcile()) return { ...result(), idempotent: false }
    return { ...result(), state: 'awaiting_confirmation' }
  })
}

async function cli() {
  const [approvalPath, stateDirectory, mode] = process.argv.slice(2)
  if (!approvalPath || !stateDirectory || mode && mode !== '--prepare-only') fail('BUYER_APPROVAL_AND_STATE_REQUIRED')
  const path = resolve(approvalPath), directory = await lstat(dirname(path))
  if (!directory.isDirectory() || (directory.mode & 0o077) !== 0 || directory.uid !== process.getuid?.()) fail('BUYER_PRIVATE_STATE_DIRECTORY_REQUIRED')
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  let approval
  try {
    const entry = await file.stat()
    if (!entry.isFile() || entry.size > 65_536 || (entry.mode & 0o077) !== 0 || entry.uid !== process.getuid?.()) fail('BUYER_LISTING_APPROVAL_INVALID')
    approval = JSON.parse(await file.readFile('utf8'))
  } finally { await file.close() }
  const payment = validateBuyerListingApproval(approval), account = payment.rail === 'mpp'
    ? Account.fromSecp256k1(process.env.CLAWDMARKET_BUYER_PRIVATE_KEY) : (await import('viem/accounts')).privateKeyToAccount(process.env.CLAWDMARKET_BUYER_PRIVATE_KEY)
  const adapter = (payment.rail === 'mpp' ? createBuyerTempoAdapter : createBuyerEvmAdapter)({ chainId: payment.chain_id, rpcUrl: approval.rpc_url, account })
  process.stdout.write(JSON.stringify(await runBuyerListingFunding({ approval, apiKey: process.env.CLAWDMARKET_BUYER_API_KEY,
    stateDirectory, account, adapter, prepareOnly: mode === '--prepare-only' })) + '\n')
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) cli().catch(error => {
  process.stderr.write((/^BUYER_[A-Z0-9_]+$/.test(error.message || '') ? error.message : 'BUYER_WORKER_STOPPED_RESUME_SAME_PAYMENT') + '\n'); process.exitCode = 1
})
