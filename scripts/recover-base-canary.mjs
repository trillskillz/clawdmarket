import { createPublicClient, decodeEventLog, erc20Abi, getAddress, http } from 'viem'
import { base } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'

// Recovery is intentionally pinned to one previously broadcast $0.01 payment.
// This script has no wallet client and cannot submit a new payment.
const PAYMENT_HASH = '0xb8ebdc443baa1350b52c3dbdf6ab423e45716fa015929c46600c5d390e8db99e'
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const EXPECTED_PAYER = '0x3324B8045c88c163eCf7a4C596610814cdF0dC8C'
const EXPECTED_AMOUNT = 10_000n
const baseUrl = new URL(process.env.BASE_URL || 'https://www.clawdmkt.com').origin
if (!['https://clawdmkt.com', 'https://www.clawdmkt.com'].includes(baseUrl)) {
  throw new Error('Recovery only permits a canonical clawdmkt.com origin')
}
const rawKey = (process.env.WALLET_SMOKE_PRIVATE_KEY || '').trim()
const privateKey = `0x${rawKey.replace(/^0x/i, '')}`
if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new Error('WALLET_SMOKE_PRIVATE_KEY must be a 32-byte hex key')
const account = privateKeyToAccount(privateKey)
if (account.address.toLowerCase() !== EXPECTED_PAYER.toLowerCase()
  || getAddress(process.env.WALLET_SMOKE_ADDRESS || '').toLowerCase() !== EXPECTED_PAYER.toLowerCase()) {
  throw new Error('Recovery wallet does not match the exact original payer')
}
const client = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL || 'https://mainnet.base.org') })
const cookies = new Map()

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {})
  if (cookies.size) headers.set('Cookie', [...cookies].map(([key, value]) => `${key}=${value}`).join('; '))
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers, cache: 'no-store' })
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(';', 1)[0]
    const separator = pair.indexOf('=')
    if (separator > 0) cookies.set(pair.slice(0, separator), pair.slice(separator + 1))
  }
  const raw = await response.text()
  let body
  try { body = raw ? JSON.parse(raw) : null } catch { body = { error: raw.slice(0, 200) } }
  return { status: response.status, body }
}

function expect(result, label, statuses = [200]) {
  if (!statuses.includes(result.status)) throw new Error(`${label}: ${result.body?.error || `HTTP ${result.status}`}`)
  return result.body
}

function transferAmount(receipt, from, to) {
  let amount = 0n
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== BASE_USDC.toLowerCase()) continue
    try {
      const event = decodeEventLog({ abi: erc20Abi, data: log.data, topics: log.topics })
      if (event.eventName === 'Transfer'
        && event.args.from.toLowerCase() === from.toLowerCase()
        && event.args.to.toLowerCase() === to.toLowerCase()) amount += event.args.value
    } catch {
      // Ignore other USDC events in the same transaction.
    }
  }
  return amount
}

const config = expect(await api('/api/payments/config'), 'Production payment configuration')
const token = config.accepted_tokens?.find((item) => item.chain_id === base.id && item.token_address?.toLowerCase() === BASE_USDC.toLowerCase())
if (!config.erc20_configured || !token || token.decimals !== 6 || !config.treasury_wallet) {
  throw new Error('Production Base USDC configuration does not match the original payment')
}
const treasury = getAddress(config.treasury_wallet)
const receipt = await client.getTransactionReceipt({ hash: PAYMENT_HASH })
const transaction = await client.getTransaction({ hash: PAYMENT_HASH })
const confirmations = await client.getTransactionConfirmations({ transactionReceipt: receipt })
if (receipt.status !== 'success' || transaction.from.toLowerCase() !== EXPECTED_PAYER.toLowerCase()
  || transaction.to?.toLowerCase() !== BASE_USDC.toLowerCase()
  || confirmations < (token.confirmations || 3)
  || transferAmount(receipt, EXPECTED_PAYER, treasury) !== EXPECTED_AMOUNT) {
  throw new Error('Original Base transaction does not match the exact payer, token, treasury, amount, and confirmation guard')
}
console.log(`Verified original $0.01 Base USDC transaction ${PAYMENT_HASH} on-chain`)

const challenge = expect(await api('/api/auth/wallet/nonce', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ address: account.address, chainId: base.id }),
}), 'Wallet challenge')
const signature = await account.signMessage({ message: challenge.message })
expect(await api('/api/auth/wallet/verify', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ address: account.address, signature, nonce: challenge.nonce }),
}), 'Wallet login')
const csrf = cookies.get('csrf-token')
if (!csrf || !cookies.get('auth-token')) throw new Error('Wallet login did not return session and CSRF cookies')
const buyerHeaders = { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }

let match = null
for (let page = 1; page <= 5 && !match; page += 1) {
  const list = expect(await api(`/api/trades?page=${page}&limit=100`), 'Buyer trade list')
  for (const trade of list.trades || []) {
    if (trade.payment_rail !== 'evm' || trade.status !== 'cancelled'
      || !trade.listing_title?.startsWith('Production payment canary ')) continue
    const found = expect(await api(`/api/trades/${encodeURIComponent(trade.id)}/fund/evm/intent`), 'Canary intent lookup')
    if (found.intent?.tx_hash?.toLowerCase() === PAYMENT_HASH) {
      if (match) throw new Error('Multiple canary intents claim the same transaction')
      match = { trade, intent: found.intent }
    }
  }
  if (!list.has_more) break
}
if (!match) throw new Error('No cancelled canary trade has the original payment hash attached; do not send another payment')
const { trade, intent } = match
if (intent.chain_id !== base.id || intent.token_address?.toLowerCase() !== BASE_USDC.toLowerCase()
  || intent.treasury_address?.toLowerCase() !== treasury.toLowerCase()
  || intent.payer_address?.toLowerCase() !== EXPECTED_PAYER.toLowerCase()
  || BigInt(intent.token_amount || '0') !== EXPECTED_AMOUNT
  || Number(intent.amount_usd) !== 0.01) {
  throw new Error('Saved payment intent does not match the original $0.01 Base payment')
}
console.log(`Resuming only cancelled canary trade ${trade.id}`)

let payerSignature = intent.payer_signature || ''
let refundHash = null
for (let attempt = 0; attempt < 24; attempt += 1) {
  const proof = {
    intent_id: intent.id, chain_id: base.id, token_address: BASE_USDC,
    tx_hash: PAYMENT_HASH, payer_address: EXPECTED_PAYER,
    ...(payerSignature ? { payer_signature: payerSignature } : {}),
  }
  const result = await api(`/api/trades/${encodeURIComponent(trade.id)}/fund/evm`, {
    method: 'POST', headers: buyerHeaders, body: JSON.stringify(proof),
  })
  if (result.status === 428 && result.body?.code === 'PAYER_AUTHORIZATION_REQUIRED') {
    payerSignature = await account.signMessage({ message: result.body.message })
    continue
  }
  if (result.status === 409 && result.body?.code === 'PAYMENT_CONFIRMING' && result.body?.retryable === true) {
    console.log(`Site RPC has not verified the existing transaction yet (attempt ${attempt + 1}/24)`)
  } else {
    const funded = expect(result, 'Existing payment verification/refund', [200, 202])
    const transfer = funded?.transfers?.find((item) => item.kind === 'buyer_refund')
    if (funded.status === 'late_payment_refunded' && transfer?.status === 'confirmed' && transfer.tx_hash) {
      refundHash = transfer.tx_hash
      break
    }
    if (funded.status !== 'late_payment_refund_processing') {
      throw new Error(`Unexpected recovery state: ${funded.status || 'missing'}`)
    }
    console.log(`Refund state: ${transfer?.status || 'not yet queued'}`)
  }
  if (attempt < 23) await new Promise((resolve) => setTimeout(resolve, 5_000))
}
if (!refundHash) throw new Error('Existing payment was not refunded within the recovery window; do not send another payment')
const refunded = await client.waitForTransactionReceipt({ hash: refundHash, confirmations: token.confirmations || 3, timeout: 120_000 })
if (refunded.status !== 'success' || transferAmount(refunded, treasury, EXPECTED_PAYER) < EXPECTED_AMOUNT) {
  throw new Error('Reported refund does not contain a confirmed full $0.01 Base USDC return transfer')
}
console.log(`PASS: original payment was fully refunded; refund transaction ${refundHash}`)
