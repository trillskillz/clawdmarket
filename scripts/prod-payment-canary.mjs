import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  formatEther,
  formatUnits,
  http,
  parseUnits,
} from 'viem'
import { base } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'

const REQUIRED_CONFIRMATION = 'RUN_LOW_VALUE_REAL_PAYMENT'
const baseUrl = new URL(process.env.BASE_URL || 'https://www.clawdmkt.com').origin
const privateKey = process.env.WALLET_SMOKE_PRIVATE_KEY || ''
const sellerEmail = process.env.SMOKE_EMAIL || ''
const sellerPassword = process.env.SMOKE_PASSWORD || ''
const rpcUrl = process.env.BASE_RPC_URL || 'https://mainnet.base.org'

if (!['https://clawdmkt.com', 'https://www.clawdmkt.com'].includes(baseUrl)) {
  throw new Error('The production payment canary only permits a canonical clawdmkt.com origin')
}
if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  throw new Error('WALLET_SMOKE_PRIVATE_KEY must be a 32-byte hex private key')
}
if (!sellerEmail || !sellerPassword) throw new Error('SMOKE_EMAIL and SMOKE_PASSWORD are required')

const account = privateKeyToAccount(privateKey)
const publicClient = createPublicClient({ chain: base, transport: http(rpcUrl) })
const walletClient = createWalletClient({ account, chain: base, transport: http(rpcUrl) })
const buyerCookies = new Map()

function captureCookies(response, jar) {
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(';', 1)[0]
    const separator = pair.indexOf('=')
    if (separator > 0) jar.set(pair.slice(0, separator), pair.slice(separator + 1))
  }
}

function cookieHeader(jar) {
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ')
}

async function api(path, options = {}, jar) {
  const headers = new Headers(options.headers || {})
  if (jar?.size) headers.set('Cookie', cookieHeader(jar))
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers })
  if (jar) captureCookies(response, jar)
  const text = await response.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = { raw: text.slice(0, 500) } }
  return { response, body }
}

function assertOk(result, label, accepted = [200]) {
  if (!accepted.includes(result.response.status)) {
    const detail = result.body?.error || result.body?.message || `HTTP ${result.response.status}`
    throw new Error(`${label} failed: ${detail}`)
  }
  return result.body
}

async function walletLogin() {
  const nonceResult = await api('/api/auth/wallet/nonce', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: account.address, chainId: base.id }),
  })
  const challenge = assertOk(nonceResult, 'Wallet challenge')
  const signature = await account.signMessage({ message: challenge.message })
  const verifyResult = await api('/api/auth/wallet/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: account.address, signature, nonce: challenge.nonce }),
  }, buyerCookies)
  assertOk(verifyResult, 'Wallet authentication')
  const csrf = buyerCookies.get('csrf-token')
  if (!buyerCookies.get('auth-token') || !csrf) throw new Error('Wallet authentication did not return session and CSRF cookies')
  return csrf
}

async function sellerLogin() {
  const result = await api('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: sellerEmail, password: sellerPassword }),
  })
  const body = assertOk(result, 'Seller login')
  if (!body?.token) throw new Error('Seller login did not return an API bearer token')
  return body.token
}

const paymentConfig = assertOk(await api('/api/payments/config'), 'Payment configuration')
const token = paymentConfig.accepted_tokens?.find((item) => item.chain_id === base.id && item.symbol === 'USDC')
if (!paymentConfig.erc20_configured || !token || !paymentConfig.treasury_wallet) {
  throw new Error('Base USDC checkout is not enabled in production')
}

const tokenAddress = token.token_address
const treasury = paymentConfig.treasury_wallet
const [nativeBalance, startingUsdc] = await Promise.all([
  publicClient.getBalance({ address: account.address }),
  publicClient.readContract({ address: tokenAddress, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] }),
])

console.log(`Canary buyer: ${account.address}`)
console.log(`Buyer Base ETH: ${formatEther(nativeBalance)}`)
console.log(`Buyer Base USDC: ${formatUnits(startingUsdc, token.decimals)}`)
console.log(`Settlement wallet: ${treasury}`)

if (process.env.CONFIRM_REAL_PAYMENT_CANARY !== REQUIRED_CONFIRMATION) {
  console.log(`Preflight only. Set CONFIRM_REAL_PAYMENT_CANARY=${REQUIRED_CONFIRMATION} to run the $0.01 payment and refund.`)
  process.exit(0)
}

const canaryPrice = 0.01
const maximumSpend = parseUnits('0.01', token.decimals)
if (startingUsdc < maximumSpend) {
  throw new Error(`Canary buyer needs at least 0.01 USDC on Base: ${account.address}`)
}
if (nativeBalance === 0n) throw new Error(`Canary buyer needs Base ETH for gas: ${account.address}`)

const sellerToken = await sellerLogin()
const sellerHeaders = {
  Authorization: `Bearer ${sellerToken}`,
  'Content-Type': 'application/json',
}
let listingId = null
let tradeId = null

try {
  assertOk(await api('/api/payments/payout-address', {
    method: 'PUT',
    headers: sellerHeaders,
    body: JSON.stringify({ address: account.address }),
  }), 'Canary seller payout setup')

  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
  const listing = assertOk(await api('/api/listings', {
    method: 'POST',
    headers: sellerHeaders,
    body: JSON.stringify({
      category: 'other',
      title: `Production payment canary ${suffix}`,
      description: 'Automated low-value production payment and refund canary. No seller work is requested.',
      price_bankr: canaryPrice,
    }),
  }), 'Canary listing creation', [201])
  listingId = listing?.listing?.id
  if (!listingId) throw new Error('Canary listing creation did not return an ID')

  const csrf = await walletLogin()
  const buyerHeaders = {
    'Content-Type': 'application/json',
    'X-CSRF-Token': csrf,
  }
  const trade = assertOk(await api('/api/trades', {
    method: 'POST',
    headers: buyerHeaders,
    body: JSON.stringify({
      listing_id: listingId,
      amount: 1,
      payment_rail: 'evm',
      client_reference: `payment-canary-${suffix}`,
    }),
  }, buyerCookies), 'Canary trade reservation', [201])
  tradeId = trade?.trade?.id
  const checkout = trade?.checkout
  if (!tradeId || checkout?.rail !== 'evm') throw new Error('Canary trade did not return an EVM checkout')
  if (checkout.amount_usd !== canaryPrice) throw new Error(`Canary spend guard rejected quoted total ${checkout.amount_usd}`)
  if (checkout.treasury?.toLowerCase() !== treasury.toLowerCase()) throw new Error('Checkout treasury does not match payment configuration')

  assertOk(await api(`/api/trades/${encodeURIComponent(tradeId)}/cancel`, {
    method: 'POST', headers: buyerHeaders,
  }, buyerCookies), 'Canary reservation cancellation')

  const amount = parseUnits(checkout.amount_usd.toFixed(token.decimals), token.decimals)
  if (amount > maximumSpend) throw new Error('Canary spend exceeds the hard $0.01 limit')
  const { request } = await publicClient.simulateContract({
    account,
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [treasury, amount],
  })
  const paymentHash = await walletClient.writeContract(request)
  console.log(`Payment transaction: ${paymentHash}`)
  await publicClient.waitForTransactionReceipt({ hash: paymentHash, confirmations: token.confirmations || 3, timeout: 120_000 })

  let funded = null
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const result = await api(`/api/trades/${encodeURIComponent(tradeId)}/fund/evm`, {
      method: 'POST',
      headers: buyerHeaders,
      body: JSON.stringify({
        chain_id: base.id,
        token_address: tokenAddress,
        tx_hash: paymentHash,
        payer_address: account.address,
      }),
    }, buyerCookies)
    funded = assertOk(result, 'Canary payment verification', [200, 202])
    const transfer = funded?.transfers?.find((item) => item.kind === 'buyer_refund')
    if (funded?.status === 'late_payment_refunded' && transfer?.status === 'confirmed' && transfer?.tx_hash) break
    if (attempt === 11) throw new Error('Refund did not confirm within the canary retry window')
    await new Promise((resolve) => setTimeout(resolve, 5_000))
  }

  const refund = funded.transfers.find((item) => item.kind === 'buyer_refund')
  await publicClient.waitForTransactionReceipt({ hash: refund.tx_hash, confirmations: token.confirmations || 3, timeout: 120_000 })
  const endingUsdc = await publicClient.readContract({ address: tokenAddress, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] })
  if (endingUsdc < startingUsdc) {
    throw new Error(`Refund balance check failed: started ${formatUnits(startingUsdc, token.decimals)}, ended ${formatUnits(endingUsdc, token.decimals)} USDC`)
  }
  console.log(`Refund transaction: ${refund.tx_hash}`)
  console.log(`PASS: $0.01 Base USDC payment verification and full late-payment refund completed for trade ${tradeId}`)
} finally {
  if (listingId) {
    const cleanup = await api(`/api/listings/${encodeURIComponent(listingId)}`, { method: 'DELETE', headers: sellerHeaders })
    if (![200, 409].includes(cleanup.response.status)) {
      console.warn(`Canary listing cleanup returned HTTP ${cleanup.response.status}`)
    }
  }
}
