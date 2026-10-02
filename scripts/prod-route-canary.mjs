import { createPublicClient, createWalletClient, erc20Abi, formatEther, formatUnits, getAddress, http, parseUnits } from 'viem'
import { base } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'

const live = process.env.CONFIRM_REAL_ROUTE_CANARY === 'RUN_CAPPED_REAL_ROUTE'
const baseUrl = new URL(process.env.BASE_URL || 'https://www.clawdmkt.com').origin
if (!['https://clawdmkt.com', 'https://www.clawdmkt.com'].includes(baseUrl)) throw new Error('Canonical production origin required')
const rawKey = (process.env.WALLET_SMOKE_PRIVATE_KEY || '').trim()
const key = `0x${rawKey.replace(/^0x/i, '')}`
if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error('WALLET_SMOKE_PRIVATE_KEY is required')
const account = privateKeyToAccount(key)
if (account.address.toLowerCase() !== getAddress(process.env.WALLET_SMOKE_ADDRESS || '').toLowerCase()) throw new Error('Smoke wallet address mismatch')
if (!process.env.SMOKE_EMAIL || !process.env.SMOKE_PASSWORD) throw new Error('Smoke seller credentials required')
const client = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL || 'https://mainnet.base.org') })
const wallet = createWalletClient({ account, chain: base, transport: http(process.env.BASE_RPC_URL || 'https://mainnet.base.org') })
const cookies = new Map()
function capture(response) {
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(';', 1)[0]
    const index = pair.indexOf('=')
    if (index > 0) cookies.set(pair.slice(0, index), pair.slice(index + 1))
  }
}
async function api(path, options = {}, withCookies = false) {
  const headers = new Headers(options.headers || {})
  if (withCookies && cookies.size) headers.set('Cookie', [...cookies].map(([k, v]) => `${k}=${v}`).join('; '))
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers })
  if (withCookies) capture(response)
  const raw = await response.text()
  let body
  try { body = raw ? JSON.parse(raw) : null } catch { body = { error: raw.slice(0, 300) } }
  return { status: response.status, body }
}
function ok(result, label, statuses = [200]) {
  if (!statuses.includes(result.status)) throw new Error(`${label}: HTTP ${result.status} ${result.body?.error_code || result.body?.code || result.body?.error || result.body?.message || ''}`)
  return result.body
}
const json = (data) => JSON.stringify(data)
const sellerAuth = ok(await api('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json({ email: process.env.SMOKE_EMAIL, password: process.env.SMOKE_PASSWORD }) }), 'Seller login')
if (!sellerAuth?.user?.id || !sellerAuth?.token) throw new Error('Seller login did not return ID and token')
const sellerHeaders = { Authorization: `Bearer ${sellerAuth.token}`, 'Content-Type': 'application/json' }
const nonce = ok(await api('/api/auth/wallet/nonce', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json({ address: account.address, chainId: base.id }) }), 'Wallet nonce')
const signature = await account.signMessage({ message: nonce.message })
const buyerAuth = ok(await api('/api/auth/wallet/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json({ address: account.address, signature, nonce: nonce.nonce }) }, true), 'Wallet login')
if (!buyerAuth?.user?.id || !cookies.has('auth-token') || !cookies.has('csrf-token')) throw new Error('Wallet login did not return ID and session')
if (buyerAuth.user.id === sellerAuth.user.id) throw new Error('Canary buyer and seller must be distinct')
const buyerHeaders = { 'Content-Type': 'application/json', 'X-CSRF-Token': cookies.get('csrf-token') }
console.log(`Canary buyer ID: ${buyerAuth.user.id}`)
console.log(`Canary seller ID: ${sellerAuth.user.id}`)
const config = ok(await api('/api/payments/config'), 'Payment configuration')
const token = config.accepted_tokens?.find((item) => item.chain_id === base.id && item.symbol === 'USDC')
if (!config.erc20_configured || !token || !config.treasury_wallet) throw new Error('Base USDC checkout unavailable')
const payout = ok(await api('/api/payments/payout-address', { headers: sellerHeaders }), 'Seller payout')
const expectedPayout = getAddress('0x89D8f773a0F59A429B71610B31c5d9c85Ca39E5d')
if (!payout.address || getAddress(payout.address) !== expectedPayout) throw new Error('Dedicated seller payout address mismatch')
const [eth, usdc] = await Promise.all([
  client.getBalance({ address: account.address }),
  client.readContract({ address: token.token_address, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] }),
])
console.log(`Buyer Base ETH: ${formatEther(eth)}`)
console.log(`Buyer Base USDC: ${formatUnits(usdc, token.decimals)}`)
if (eth < 50_000_000_000_000n || usdc < parseUnits('0.11', token.decimals)) throw new Error('Canary buyer balance is below the $0.11 plus gas requirement')
const ready = ok(await api('/api/health/ready'), 'Production readiness')
if (ready.status === 'error' || ready.ready === false) throw new Error('Production readiness is unhealthy')
const docs = ok(await api('/api/docs'), 'Machine contract')
console.log(`Production contract: ${docs.info?.['x-agent-contract-version']}`)
if (!live) {
  console.log('Route preflight passed; no service, route, or payment was created')
  process.exit(0)
}
if (docs.info?.['x-agent-contract-version'] !== '1.57') throw new Error('Contract 1.57 must be deployed before the funded canary')
if (buyerAuth.user.id !== process.env.ROUTE_CANARY_BUYER_ID || sellerAuth.user.id !== process.env.ROUTE_CANARY_SELLER_ID) throw new Error('Scoped canary IDs do not match authenticated identities')
if (!/^\d+$/.test(process.env.GITHUB_RUN_ID || '')) throw new Error('Funded route canary requires a stable GitHub run ID')
const suffix = `run-${process.env.GITHUB_RUN_ID}`
let serviceId = null
let routeId = null
let tradeId = null
let paymentHash = null
let paymentSendStarted = false
let funded = false
try {
  const service = ok(await api('/api/services', { method: 'POST', headers: sellerHeaders, body: json({
    title: `Controlled route canary ${suffix}`,
    description: 'Controlled production service for a single authorized route and $0.11 Base checkout; delivery is a test artifact.',
    capabilities: ['code-review'], input_schema: { type: 'object', required: ['sample'], properties: { sample: { type: 'string' } }, additionalProperties: false },
    output_schema: {}, pricing: { model: 'fixed', amount: '0.10', currency: 'USD' },
    estimated_latency_seconds: 60, max_concurrency: 1, execution_mode: 'contracted', provider_protocol: 'leased_v1',
    verification_policy: { required: true, methods: ['buyer_review'] }, status: 'active',
  }) }), 'Service publication', [201]).service
  serviceId = service?.id
  if (!serviceId || !service.readiness?.purchasable || service.current_capacity !== 1) throw new Error('Canary service is not purchasable with capacity one')
  console.log(`Service: ${serviceId}`)
  const planBody = { client_reference: `route-canary-${suffix}`, objective: 'Review this controlled route canary sample for a valid completion.',
    required_capabilities: ['code-review'], input: { sample: 'Controlled production route canary input' },
    max_budget: { amount: '0.11', currency: 'USD' }, deadline_seconds: 300,
    verification: { required: true, methods: ['buyer_review'] }, payment_policy: { allowed_rails: ['evm'] }, retry_policy: { max_attempts: 1 } }
  const route = ok(await api('/api/routes/plan', { method: 'POST', headers: buyerHeaders, body: json(planBody) }, true), 'Route plan', [201])
  routeId = route.route?.id
  if (!routeId || route.route.candidates?.length !== 1 || route.route.candidates[0].service_id !== serviceId || route.planning?.funds_moved !== false) throw new Error('Route did not select exactly the canary service without funding')
  const replayPlan = ok(await api('/api/routes/plan', { method: 'POST', headers: buyerHeaders, body: json(planBody) }, true), 'Route plan replay')
  if (replayPlan.route?.id !== routeId || !replayPlan.idempotent) throw new Error('Route plan replay created a second route')
  const selected = ok(await api(`/api/routes/${routeId}/execute`, { method: 'POST', headers: buyerHeaders }, true), 'Route execute', [201])
  tradeId = selected.trade?.id
  const checkout = selected.checkout
  if (!tradeId || selected.order?.service_id !== serviceId || selected.trade.status !== 'pending' || checkout?.rail !== 'evm' || checkout.amount_usd !== 0.11 || checkout.treasury?.toLowerCase() !== config.treasury_wallet.toLowerCase()) throw new Error('Unpaid route checkout violates the $0.11 guard')
  const replayExecute = ok(await api(`/api/routes/${routeId}/execute`, { method: 'POST', headers: buyerHeaders }, true), 'Route execute replay')
  if (replayExecute.trade?.id !== tradeId || replayExecute.order?.id !== selected.order.id || !replayExecute.idempotent) throw new Error('Route execute replay created another order')
  console.log(`Route: ${routeId}; order: ${selected.order.id}; trade: ${tradeId}`)
  const sellerStart = await client.readContract({ address: token.token_address, abi: erc20Abi, functionName: 'balanceOf', args: [expectedPayout] })
  const intent = ok(await api(checkout.intent_url, { method: 'POST', headers: buyerHeaders, body: json({ chain_id: base.id, token_address: token.token_address, payer_address: account.address }) }, true), 'Payment intent', [201])
  if (!intent.created || intent.intent?.treasury_address?.toLowerCase() !== config.treasury_wallet.toLowerCase()) throw new Error('Payment intent did not match the configured treasury')
  const amount = parseUnits(checkout.amount_usd.toFixed(token.decimals), token.decimals)
  if (amount !== parseUnits('0.11', token.decimals)) throw new Error('Payment amount exceeds approved cap')
  const { request } = await client.simulateContract({ account, address: token.token_address, abi: erc20Abi, functionName: 'transfer', args: [config.treasury_wallet, amount] })
  paymentSendStarted = true
  paymentHash = await wallet.writeContract(request)
  console.log(`Base payment transaction: ${paymentHash}`)
  const proof = { intent_id: intent.intent.id, chain_id: base.id, token_address: token.token_address, tx_hash: paymentHash, payer_address: account.address }
  const challenge = ok(await api(checkout.funding_url, { method: 'POST', headers: buyerHeaders, body: json(proof) }, true), 'Payer challenge', [428])
  const payerSignature = await account.signMessage({ message: challenge.message })
  await client.waitForTransactionReceipt({ hash: paymentHash, confirmations: token.confirmations || 3, timeout: 120_000 })
  for (let index = 0; index < 12; index += 1) {
    const result = await api(`/api/trades/${tradeId}/fund/evm`, { method: 'POST', headers: buyerHeaders, body: json({ ...proof, payer_signature: payerSignature }) }, true)
    if (result.status === 409 && result.body?.code === 'PAYMENT_CONFIRMING' && result.body?.retryable) { await new Promise((resolve) => setTimeout(resolve, 5000)); continue }
    const response = ok(result, 'Payment verification', [200, 202])
    if (response.trade?.status === 'escrow_held') { funded = true; break }
    await new Promise((resolve) => setTimeout(resolve, 5000))
  }
  if (!funded) throw new Error('Payment state uncertain; inspect the same transaction and trade, never send another transfer')
  const work = ok(await api(`/api/trades/${tradeId}/work-order`, { headers: sellerHeaders }), 'Funded seller work order').work_order
  if ((await api(`/api/trades/${tradeId}/work-order`)).status !== 401) throw new Error('Unauthenticated work-order read was not denied')
  const attemptId = work?.execution_attempt?.id
  if (work?.id !== selected.order.id || work?.trade_id !== tradeId || work?.provider_protocol !== 'leased_v1' || !attemptId || work.input?.sample !== planBody.input.sample) throw new Error('Seller work order did not match the funded route')
  const action = { attempt_id: attemptId, action: 'accept' }
  ok(await api(`/api/trades/${tradeId}/work-order/attempt`, { method: 'POST', headers: sellerHeaders, body: json(action) }), 'Provider acceptance', [201])
  const replayAccept = ok(await api(`/api/trades/${tradeId}/work-order/attempt`, { method: 'POST', headers: sellerHeaders, body: json(action) }), 'Provider acceptance replay')
  if (!replayAccept.idempotent) throw new Error('Provider acceptance replay was not idempotent')
  const delivery = { summary: `Controlled canary review completed for route ${routeId}. This is a test artifact.`, execution_attempt_id: attemptId }
  const submitted = ok(await api(`/api/trades/${tradeId}/delivery`, { method: 'POST', headers: sellerHeaders, body: json(delivery) }), 'Provider delivery', [201])
  const replayDelivery = ok(await api(`/api/trades/${tradeId}/delivery`, { method: 'POST', headers: sellerHeaders, body: json(delivery) }), 'Provider delivery replay')
  if (!submitted.delivery?.id || replayDelivery.delivery?.id !== submitted.delivery.id || !replayDelivery.idempotent) throw new Error('Delivery replay was not idempotent')
  let completed = null
  for (let index = 0; index < 12; index += 1) {
    const result = ok(await api(`/api/trades/${tradeId}/confirm`, { method: 'POST', headers: buyerHeaders }, true), 'Buyer confirmation', [200, 202])
    if (result.status === 'completed' && result.trade?.payout_status === 'complete') { completed = result; break }
    await new Promise((resolve) => setTimeout(resolve, 5000))
  }
  if (!completed) throw new Error('Seller settlement is still processing; inspect this trade before any new action')
  const sellerEnd = await client.readContract({ address: token.token_address, abi: erc20Abi, functionName: 'balanceOf', args: [expectedPayout] })
  if (sellerEnd - sellerStart !== parseUnits('0.10', token.decimals)) throw new Error('Seller wallet did not receive exactly $0.10 USDC')
  const owned = ok(await api(`/api/routes/${routeId}`, { headers: buyerHeaders }, true), 'Completed route inspection')
  if (owned.route?.id !== routeId || owned.route?.state !== 'completed' || owned.route?.service_order_id !== selected.order.id || owned.provider_execution?.state === 'missing') throw new Error('Completed route inspection is inconsistent')
  const finalOrder = ok(await api(`/api/service-orders/${selected.order.id}`, { headers: buyerHeaders }, true), 'Completed order inspection')
  if (finalOrder.order?.state !== 'completed' || !finalOrder.order.capacity_released_at || finalOrder.trade?.id !== tradeId || finalOrder.trade?.payout_status !== 'complete') throw new Error('Completed order or settlement state is inconsistent')
  const finalService = ok(await api(`/api/services/${serviceId}`, { headers: sellerHeaders }), 'Service capacity inspection').service
  if (finalService.current_capacity !== 1) throw new Error('Service capacity was not released exactly once')
  console.log(`PASS: capped routed Base checkout, leased provider delivery, buyer review, and $0.10 seller payout; route ${routeId}; trade ${tradeId}; delivery ${submitted.delivery.id}`)
} finally {
  if (routeId && !paymentSendStarted) {
    try {
      const cancel = await api(`/api/routes/${routeId}`, { method: 'DELETE', headers: buyerHeaders }, true)
      if (cancel.status !== 200) console.warn(`Unpaid route cleanup returned HTTP ${cancel.status}; inspect route ${routeId}`)
    } catch { console.warn(`Unpaid route cleanup could not be confirmed; inspect route ${routeId}`) }
  }
  if (serviceId) {
    try {
      const cleanup = await api(`/api/services/${serviceId}`, { method: 'PATCH', headers: sellerHeaders, body: json({ status: 'archived' }) })
      if (cleanup.status !== 200) console.warn(`Canary service cleanup returned HTTP ${cleanup.status}; inspect service ${serviceId}`)
    } catch { console.warn(`Canary service cleanup could not be confirmed; inspect service ${serviceId}`) }
  }
  if (tradeId && paymentHash && !funded) console.warn(`Payment state uncertain for trade ${tradeId}, tx ${paymentHash}; do not run a second payment`)
  if (tradeId && paymentSendStarted && !paymentHash) console.warn(`Payment send outcome uncertain for trade ${tradeId}; inspect chain and trade before any retry`)
}
