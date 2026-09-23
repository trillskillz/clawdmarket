import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  formatEther,
  formatUnits,
  getAddress,
  http,
  parseUnits,
} from 'viem'
import { base } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'

const REQUIRED_CONFIRMATION = 'RUN_LOW_VALUE_REAL_PAYMENT'
const PAYOUT_CONFIRMATION = 'RUN_LOW_VALUE_REAL_SELLER_PAYOUT'
const sellerPayoutCanary = process.env.CONFIRM_REAL_SELLER_PAYOUT_CANARY === PAYOUT_CONFIRMATION
const expectedSellerPayout = getAddress('0x89D8f773a0F59A429B71610B31c5d9c85Ca39E5d')
const baseUrl = new URL(process.env.BASE_URL || 'https://www.clawdmkt.com').origin
const rawPrivateKey = (process.env.WALLET_SMOKE_PRIVATE_KEY || '').trim()
const privateKey = `0x${rawPrivateKey.replace(/^0x/i, '')}`
const expectedAddress = process.env.WALLET_SMOKE_ADDRESS || ''
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
if (!expectedAddress || account.address.toLowerCase() !== getAddress(expectedAddress).toLowerCase()) {
  throw new Error('Canary private key does not match WALLET_SMOKE_ADDRESS')
}
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
const maximumSpend = parseUnits(sellerPayoutCanary ? '0.11' : '0.01', token.decimals)
const minimumBuyerGasReserve = 50_000_000_000_000n
const [nativeBalance, startingUsdc] = await Promise.all([
  publicClient.getBalance({ address: account.address }),
  publicClient.readContract({ address: tokenAddress, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] }),
])

console.log(`Canary buyer: ${account.address}`)
console.log(`Buyer Base ETH: ${formatEther(nativeBalance)}`)
console.log(`Buyer Base USDC: ${formatUnits(startingUsdc, token.decimals)}`)
console.log(`Settlement wallet: ${treasury}`)

if (startingUsdc < maximumSpend) {
  throw new Error(`Canary buyer needs at least 0.01 USDC on Base: ${account.address}`)
}
if (nativeBalance < minimumBuyerGasReserve) {
  throw new Error(`Canary buyer needs at least 0.00005 ETH on Base for gas: ${account.address}`)
}

if (!paymentConfig.mpp_configured || !paymentConfig.mpp_recipient) {
  throw new Error('Tempo pathUSD payment challenges are not enabled in production')
}
const expectedTempoCurrency = '0x20c0000000000000000000000000000000000000'
const expectedTempoChainId = 4217
if (paymentConfig.trade_settlement?.mpp?.currency?.toLowerCase() !== expectedTempoCurrency
  || paymentConfig.trade_settlement?.mpp?.chainId !== expectedTempoChainId) {
  throw new Error('Production MPP configuration is not Tempo mainnet pathUSD')
}
const mppChallenge = await api('/api/mcp', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0', id: 'payment-canary-preflight', method: 'tools/call',
    params: { name: 'list_agents', arguments: { limit: 1 } },
  }),
})
const challenges = mppChallenge.body?.error?.data?.challenges
const challenge = Array.isArray(challenges)
  ? challenges.find((item) => item.method === 'tempo' && item.intent === 'charge')
  : null
if (mppChallenge.response.status !== 402 || !challenge
  || challenge.request?.currency?.toLowerCase() !== expectedTempoCurrency
  || challenge.request?.recipient?.toLowerCase() !== paymentConfig.mpp_recipient.toLowerCase()
  || challenge.request?.methodDetails?.chainId !== expectedTempoChainId
  || challenge.request?.amount !== '1000') {
  throw new Error('Tempo MPP challenge does not match the production payment configuration')
}
console.log('Tempo MPP 0.001 pathUSD payment challenge matches production configuration')

const sellerToken = await sellerLogin()
const sellerHeaders = {
  Authorization: `Bearer ${sellerToken}`,
  'Content-Type': 'application/json',
}
const sellerPayout = assertOk(await api('/api/payments/payout-address', { headers: sellerHeaders }), 'Canary seller payout check')
if (!sellerPayout.address) throw new Error('Configure the dedicated canary seller payout wallet before running. This script never changes seller payout settings.')
getAddress(sellerPayout.address)
if (sellerPayoutCanary && getAddress(sellerPayout.address) !== expectedSellerPayout) {
  throw new Error('Dedicated smoke seller payout does not match the owner-approved destination')
}
console.log('Dedicated canary seller payout wallet is configured')

if (process.env.CONFIRM_REAL_PAYMENT_CANARY !== REQUIRED_CONFIRMATION && !sellerPayoutCanary) {
  console.log(`Preflight passed. Set CONFIRM_REAL_PAYMENT_CANARY=${REQUIRED_CONFIRMATION} to run the $0.01 payment and refund.`)
  process.exit(0)
}

const canaryPrice = sellerPayoutCanary ? 0.10 : 0.01
let listingId = null
let tradeId = null

try {
  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
  const listing = assertOk(await api('/api/listings', {
    method: 'POST',
    headers: sellerHeaders,
    body: JSON.stringify({
      category: 'other',
      title: `Production payment canary ${suffix}`,
      description: sellerPayoutCanary
        ? 'Automated low-value production payment and seller payout canary. The delivery is a test artifact, not a service.'
        : 'Automated low-value production payment and refund canary. No seller work is requested.',
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
  console.log(`Canary trade: ${tradeId}`)
  if (checkout.amount_usd !== (sellerPayoutCanary ? 0.11 : canaryPrice)) throw new Error(`Canary spend guard rejected quoted total ${checkout.amount_usd}`)
  if (checkout.treasury?.toLowerCase() !== treasury.toLowerCase()) throw new Error('Checkout treasury does not match payment configuration')

  const intentResult = assertOk(await api(checkout.intent_url, {
    method: 'POST', headers: buyerHeaders,
    body: JSON.stringify({ chain_id: base.id, token_address: tokenAddress, payer_address: account.address }),
  }, buyerCookies), 'Canary payment intent', [201])
  const intent = intentResult.intent
  if (!intentResult.created || intent.treasury_address.toLowerCase() !== treasury.toLowerCase()) throw new Error('Canary did not receive a new matching payment intent')

  if (!sellerPayoutCanary) {
    assertOk(await api(`/api/trades/${encodeURIComponent(tradeId)}/cancel`, {
      method: 'POST', headers: buyerHeaders,
    }, buyerCookies), 'Canary reservation cancellation')
  }

  const startingSellerUsdc = sellerPayoutCanary
    ? await publicClient.readContract({ address: tokenAddress, abi: erc20Abi, functionName: 'balanceOf', args: [expectedSellerPayout] })
    : null

  const amount = parseUnits(checkout.amount_usd.toFixed(token.decimals), token.decimals)
  if (amount > maximumSpend) throw new Error('Canary spend exceeds the hard spend limit')
  const { request } = await publicClient.simulateContract({
    account,
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [treasury, amount],
  })
  const paymentHash = await walletClient.writeContract(request)
  console.log(`Payment transaction: ${paymentHash}`)
  const proofBody = { intent_id: intent.id, chain_id: base.id, token_address: tokenAddress, tx_hash: paymentHash, payer_address: account.address }
  const proofChallenge = assertOk(await api(checkout.funding_url, {
    method: 'POST', headers: buyerHeaders, body: JSON.stringify(proofBody),
  }, buyerCookies), 'Canary payer authorization', [428])
  const payerSignature = await account.signMessage({ message: proofChallenge.message })
  await publicClient.waitForTransactionReceipt({ hash: paymentHash, confirmations: token.confirmations || 3, timeout: 120_000 })

  let funded = null
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const result = await api(`/api/trades/${encodeURIComponent(tradeId)}/fund/evm`, {
      method: 'POST',
      headers: buyerHeaders,
      body: JSON.stringify({
        ...proofBody,
        payer_signature: payerSignature,
      }),
    }, buyerCookies)
    if (result.response.status === 409 && result.body?.code === 'PAYMENT_CONFIRMING' && result.body?.retryable === true) {
      if (attempt === 11) throw new Error(`Payment ${paymentHash} is confirmed on Base but the site RPC did not verify it within the retry window; resume this same transaction, do not send again`)
      await new Promise((resolve) => setTimeout(resolve, 5_000))
      continue
    }
    funded = assertOk(result, 'Canary payment verification', [200, 202])
    if (sellerPayoutCanary && funded?.trade?.status === 'escrow_held') break
    const transfer = funded?.transfers?.find((item) => item.kind === 'buyer_refund')
    if (!sellerPayoutCanary && funded?.status === 'late_payment_refunded' && transfer?.status === 'confirmed' && transfer?.tx_hash) break
    if (attempt === 11) throw new Error('Payment did not reach the expected state within the canary retry window')
    await new Promise((resolve) => setTimeout(resolve, 5_000))
  }

  if (sellerPayoutCanary) {
    assertOk(await api(`/api/trades/${encodeURIComponent(tradeId)}/delivery`, {
      method: 'POST', headers: sellerHeaders,
      body: JSON.stringify({ summary: `Automated payment canary delivery for trade ${tradeId}; no service was purchased.` }),
    }), 'Canary seller delivery', [201])
    let completed = false
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const result = assertOk(await api(`/api/trades/${encodeURIComponent(tradeId)}/confirm`, {
        method: 'POST', headers: buyerHeaders,
      }, buyerCookies), 'Canary buyer confirmation', [200, 202])
      if (result.status === 'completed' && result.trade?.payout_status === 'complete') {
        completed = true
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 5_000))
    }
    if (!completed) throw new Error(`Seller payout is still processing for trade ${tradeId}; do not create a second payment`)
    const endingSellerUsdc = await publicClient.readContract({ address: tokenAddress, abi: erc20Abi, functionName: 'balanceOf', args: [expectedSellerPayout] })
    if (endingSellerUsdc - startingSellerUsdc !== parseUnits('0.10', token.decimals)) {
      throw new Error(`Seller payout balance did not increase by exactly 0.10 USDC for trade ${tradeId}`)
    }
    console.log(`PASS: $0.11 Base USDC checkout, delivery, buyer confirmation, and $0.10 seller payout completed for trade ${tradeId}`)
    process.exitCode = 0
  } else {
  const refund = funded.transfers.find((item) => item.kind === 'buyer_refund')
  await publicClient.waitForTransactionReceipt({ hash: refund.tx_hash, confirmations: token.confirmations || 3, timeout: 120_000 })
  const endingUsdc = await publicClient.readContract({ address: tokenAddress, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] })
  if (endingUsdc < startingUsdc) {
    throw new Error(`Refund balance check failed: started ${formatUnits(startingUsdc, token.decimals)}, ended ${formatUnits(endingUsdc, token.decimals)} USDC`)
  }
  console.log(`Refund transaction: ${refund.tx_hash}`)
  console.log(`PASS: $0.01 Base USDC payment verification and full late-payment refund completed for trade ${tradeId}`)
  }
} finally {
  if (listingId) {
    const cleanup = await api(`/api/listings/${encodeURIComponent(listingId)}`, { method: 'DELETE', headers: sellerHeaders })
    if (![200, 409].includes(cleanup.response.status)) {
      console.warn(`Canary listing cleanup returned HTTP ${cleanup.response.status}`)
    }
  }
}
