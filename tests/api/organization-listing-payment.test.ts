import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { encodeFunctionData, erc20Abi, keccak256, toHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { Abis, Account } from 'viem/tempo'
import { NextRequest } from 'next/server'
import { createLocalTestSchema } from '../helpers/local-schema'

let directory: string, db: typeof import('@/lib/db').db, schema: typeof import('@/lib/schema')
let domain: typeof import('@/lib/organization-listing-authorizations') & typeof import('@/lib/organization-listing-checkout'), jwt: typeof import('@/lib/auth').generateJWT
const treasuryKey = `0x${'99'.repeat(32)}` as const, treasury = privateKeyToAccount(treasuryKey).address.toLowerCase()
const l1Token = `0x${'44'.repeat(20)}`, tempoToken = '0x20c0000000000000000000000000000000000000'
const rpc = createServer()
let rpcUrl: string, signerIndex = 800, rpcReads = 0, rpcMutations = 0
let reserveMode: 'healthy' | 'balance' | 'chain' | 'decimals' = 'healthy'
let rpcHook: ((method: string) => Promise<void>) | null = null
before(async () => {
  rpc.on('request', async (incoming, outgoing) => {
    const chunks: Buffer[] = []
    for await (const chunk of incoming) chunks.push(Buffer.from(chunk))
    const parsed = JSON.parse(Buffer.concat(chunks).toString()), calls = Array.isArray(parsed) ? parsed : [parsed]
    const result = await Promise.all(calls.map(async (call: { id: number; method: string; params?: any[] }) => {
      if (/send|sign/i.test(call.method)) { rpcMutations++; return { jsonrpc: '2.0', id: call.id, error: { code: -32601, message: 'Read-only fixture forbids mutations' } } }
      await rpcHook?.(call.method)
      rpcReads++
      let value: string | undefined
      if (call.method === 'eth_chainId') value = reserveMode === 'chain' ? '0x2' : incoming.url === '/tempo' ? '0x1079' : '0x1'
      if (call.method === 'eth_getBalance') value = `0x${(10n ** 20n).toString(16)}`
      if (call.method === 'eth_call') {
        const data = call.params?.[0]?.data as string
        const amount = data?.startsWith('0x313ce567') ? reserveMode === 'decimals' ? 18n : 6n
          : reserveMode === 'balance' ? 0n : 10n ** 12n
        value = `0x${amount.toString(16).padStart(64, '0')}`
      }
      return value === undefined ? { jsonrpc: '2.0', id: call.id, error: { code: -32601, message: 'Unsupported read-only method' } }
        : { jsonrpc: '2.0', id: call.id, result: value }
    }))
    outgoing.writeHead(200, { 'Content-Type': 'application/json' }); outgoing.end(JSON.stringify(Array.isArray(parsed) ? result : result[0]))
  })
  await new Promise<void>((done) => rpc.listen(0, '127.0.0.1', done))
  rpcUrl = `http://127.0.0.1:${(rpc.address() as { port: number }).port}`
  directory = await mkdtemp(join(tmpdir(), 'clawdmarket-workspace-test-listing-payment-'))
  Object.assign(process.env, { TURSO_DATABASE_URL: `file:${join(directory, 'listing-payment.db')}`, TURSO_AUTH_TOKEN: '',
    JWT_SECRET: 'listing-payment-fixture-only', WEBHOOK_SECRET_KEY: 'listing-payment-webhook-fixture-only', TREASURY_ADDRESS: treasury,
    EVM_SETTLEMENT_PRIVATE_KEY: treasuryKey, MPP_RECIPIENT_ADDRESS: treasury, MPP_SECRET_KEY_CURRENT: 'listing-payment-mpp-fixture-only-secret',
    TEMPO_RPC_URL: rpcUrl + '/tempo', CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED: 'true', CLAWDMARKET_ROUTE_PLANNING_ENABLED: 'true',
    CLAWDMARKET_ROUTE_EXECUTION_ENABLED: 'true', CLAWDMARKET_REUSABLE_SERVICES_ENABLED: 'true',
    EVM_ACCEPTED_TOKENS: JSON.stringify([{ chainId: 1, chainName: 'Listing reserve fixture', address: l1Token, symbol: 'TEST', decimals: 6,
      fixedUsdPrice: 1, confirmations: 1, rpcUrl: rpcUrl + '/l1' }]) })
  for (const name of ['VERCEL', 'VERCEL_ENV', 'CLAWDMARKET_CANONICAL_ORIGIN', 'CLAWDMARKET_PRODUCTION_READINESS', 'CLAWDMARKET_NEW_PAYMENTS_PAUSED', 'DEV_WALLET_ADDRESS', 'DEV_FEE_WALLET_ADDRESS']) delete process.env[name]
  db = (await import('@/lib/db')).db; schema = await import('@/lib/schema'); await createLocalTestSchema(db.$client, schema)
  domain = { ...await import('@/lib/organization-listing-authorizations'), ...await import('@/lib/organization-listing-checkout') }; jwt = (await import('@/lib/auth')).generateJWT
})
after(async () => {
  assert.equal(rpcMutations, 0, 'Focused fixtures authorize no chain send or signing RPC')
  db?.$client.close(); await new Promise<void>((done) => rpc.close(() => done()))
  if (directory) await rm(directory, { recursive: true, force: true })
})
const context = (id: string) => ({ params: Promise.resolve({ id }) })
function request(path: string, actor: string, method = 'POST', body?: unknown) {
  return new NextRequest(`http://localhost${path}`, { method, headers: { 'Content-Type': 'application/json',
    Authorization: `Bearer ${jwt({ userId: actor, email: `${actor}@test.invalid`, role: 'human' })}` },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}
async function fixture(rail: 'evm' | 'mpp', sharedSigner?: any) {
  const organization = crypto.randomUUID(), agent = `agent_${crypto.randomUUID()}`, sellerAgent = `agent_${crypto.randomUUID()}`
  const owner = `owner-${organization}`, reviewer = `reviewer-${organization}`, other = `other-${organization}`, buyer = `user_agent_${agent}`, seller = `user_agent_${sellerAgent}`
  const team = crypto.randomUUID(), now = new Date(), operationId = crypto.randomUUID()
  const key = `0x${(++signerIndex).toString(16).padStart(64, '0')}` as `0x${string}`
  const signer = sharedSigner ?? (rail === 'mpp' ? Account.fromSecp256k1(key) : privateKeyToAccount(key))
  await db.insert(schema.users).values([owner, reviewer, other, buyer, seller].map((id) => ({ id, name: id, email: `${id}@test.invalid`, password_hash: 'unused' })))
  await db.insert(schema.agents).values([agent, sellerAgent].map((id) => ({ id, name: 'Listing payment fixture', description: 'Isolated reviewed listing payment fixture',
    capabilities: '["code-review"]', endpoint: 'https://example.invalid', owner_address: '', api_key: 'unused' })))
  await db.insert(schema.agent_owners).values({ agentId: agent, userId: owner, establishedBy: 'test' })
  await db.insert(schema.organizations).values({ id: organization, owner_account_id: owner, client_reference: organization, name: 'Listing payment organization', created_at: now, updated_at: now })
  await db.insert(schema.organization_teams).values({ id: team, organization_id: organization, slug: 'review', name: 'Review', created_at: now, updated_at: now })
  await db.insert(schema.organization_agent_assignments).values({ agent_id: agent, organization_id: organization, team_id: team, cost_center: 'TASK', assigned_at: now, updated_at: now })
  const membership = await import('@/lib/organization-membership'), purchasing = await import('@/lib/organization-purchasing')
  const invitation = await membership.createOrganizationInvitation(organization, owner, reviewer, crypto.randomUUID())
  assert.equal(invitation.kind, 'ok'); assert.equal((await membership.acceptOrganizationInvitation(invitation.invitation_id!, reviewer)).kind, 'ok')
  const role = await purchasing.grantPurchasingRole(organization, owner, purchasing.purchasingRoleInput.parse({ version: 1,
    client_reference: crypto.randomUUID(), account_id: reviewer, team_id: team, role: 'approver', max_purchase: '10.00', expires_at: new Date(Date.now() + 3600_000).toISOString() }))
  await db.insert(schema.payout_addresses).values({ user_id: seller, address: treasury })
  const [listing] = await db.insert(schema.listings).values({ seller_id: seller, category: 'code', title: 'Original reviewed public listing', description: 'Deliver finite original reviewed findings.', price_bankr: 1 }).returning()
  await db.insert(schema.buyer_spend_policies).values({ buyer_id: buyer, owner_account_id: owner,
    policy_json: '{"approval_required_above":50,"max_per_execution":500}', version: 1, created_at: now, updated_at: now })
  const payment = rail === 'evm' ? { rail: 'evm', chain_id: 1, token_address: l1Token, payer_address: signer.address.toLowerCase(), treasury_address: treasury,
    minimum_token_reserve_units: '1000000', minimum_native_reserve_wei: '1000000000000', max_gas_cost_wei: '100000000000000' }
    : { rail: 'mpp', chain_id: 4217, token_address: tempoToken, payer_address: signer.address.toLowerCase(), treasury_address: treasury,
      minimum_token_reserve_units: '1000000', fee_token_address: tempoToken, minimum_fee_token_reserve_units: '1000000', max_fee_token_cost_units: '5000' }
  const version = rail === 'evm' ? 1 : 2
  const proposed = await domain.proposeOrganizationListing(organization, owner, domain.organizationListingInput.parse({ version, client_reference: crypto.randomUUID(),
    listing_id: listing.id, buyer_agent_id: agent, delivery: { output_format: 'json', acceptance_criteria: [], required_json_keys: ['result'], minimum_sources: 0 }, reviewer_role_id: role.role.id, expected_total: '1.05', max_daily: '10.00', max_monthly: '10.00', max_lifetime: '10.00',
    max_lifetime_chain_fee_units: rail === 'evm' ? '1000000000000000' : '50000', expires_at: new Date(Date.now() + 600_000).toISOString(),
    expected_token_decimals: 6, expected_token_usd_price: 1, payment }))
  const authorization = proposed.authorization
  await domain.approveOrganizationListing(organization, authorization.id, reviewer, domain.organizationListingDecision.parse({ version, client_reference: crypto.randomUUID(), authority_hash: authorization.authority_hash, approve: true }))
  await domain.checkoutOrganizationListing(organization, authorization.id, buyer, { version, client_reference: crypto.randomUUID(), authority_hash: authorization.authority_hash })
  const [use] = await db.select().from(schema.organization_listing_uses).where(eq(schema.organization_listing_uses.authorization_id, authorization.id))
  const [trade] = await db.select().from(schema.trades).where(eq(schema.trades.id, use.trade_id))
  return { organization, agent, sellerAgent, owner, reviewer, reviewerRole: role.role.id, other, buyer, seller, team, rail, signer, payment, authorization, trade, operationId }
}
type Fixture = Awaited<ReturnType<typeof fixture>>
async function create(f: Fixture, operation = f.operationId) {
  const api = f.rail === 'evm' ? await import('@/lib/evm-intent-api') : await import('@/app/api/trades/[id]/fund/mpp/intent/route')
  return api.POST(request(`/api/trades/${f.trade.id}/fund/${f.rail}/intent`, f.buyer, 'POST', { buyer_operation_id: operation,
    ...(f.rail === 'evm' ? { chain_id: 1, token_address: l1Token, payer_address: f.signer.address } : {}) }), context(f.trade.id))
}
async function inspect(f: Fixture, actor = f.buyer) {
  const api = f.rail === 'evm' ? await import('@/lib/evm-intent-api') : await import('@/app/api/trades/[id]/fund/mpp/intent/route')
  return api.GET(request(`/api/trades/${f.trade.id}/fund/${f.rail}/intent`, actor, 'GET'), context(f.trade.id))
}
async function signed(f: Fixture, intent: any, nonce = 7, changes = {}) {
  const serialized_transaction = f.rail === 'evm'
    ? await f.signer.signTransaction({ type: 'eip1559', chainId: 1, nonce, gas: 50_000n, maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 1n,
      to: l1Token, value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [treasury as `0x${string}`, BigInt(intent.token_amount)] }), ...changes })
    : await f.signer.signTransaction({ chainId: 4217, nonce, nonceKey: 0n, gas: 50_000n, maxFeePerGas: 100_000_000_000n, maxPriorityFeePerGas: 0n,
      feeToken: tempoToken, validBefore: Math.floor(Date.now() / 1000) + 120,
      calls: [{ to: tempoToken, value: 0n, data: encodeFunctionData({ abi: Abis.tip20, functionName: 'transferWithMemo', args: [treasury as `0x${string}`, BigInt(intent.token_amount), keccak256(toHex(`clawdmarket:${f.trade.id}`))] }) }], ...changes })
  const payer_signature = f.rail === 'evm' ? await f.signer.signMessage({ message: (await import('@/lib/evm-payment-proof')).evmPaymentProofMessage(intent, keccak256(serialized_transaction)) }) : undefined
  return { intent_id: intent.id, mandate_id: f.authorization.id, buyer_operation_id: f.operationId, serialized_transaction,
    ...(payer_signature ? { payer_signature } : {}) }
}
async function claim(f: Fixture, body: unknown, actor = f.buyer) {
  const api = f.rail === 'evm' ? await import('@/app/api/trades/[id]/fund/evm/claim/route') : await import('@/app/api/trades/[id]/fund/mpp/claim/route')
  return api.POST(request(`/api/trades/${f.trade.id}/fund/${f.rail}/claim`, actor, 'POST', body), context(f.trade.id))
}
async function confirmFixtureReceipt(f: Fixture, hash: string) {
  // Trusted fixture receipt persistence only; genuine chain settlement is a separate acceptance gate.
  const [trade] = await db.select().from(schema.trades).where(eq(schema.trades.id, f.trade.id))
  const proof = { trade, rail: f.rail, txHash: hash, externalId: f.rail === 'evm' ? trade.id : hash,
    payerAddress: f.signer.address.toLowerCase(), tokenAddress: f.rail === 'evm' ? l1Token : tempoToken, chainId: f.rail === 'evm' ? 1 : 4217,
    tokenSymbol: f.rail === 'evm' ? 'TEST' : 'pathUSD', tokenDecimals: 6, tokenAmount: 1_050_000n, tokenUsdPrice: 1, usdValue: 1.05 }
  const funding = await import('@/lib/trade-funding')
  if (trade.status === 'cancelled') await funding.recordCancelledExternalFunding(proof)
  else await funding.recordExternalTradeFunding(proof)
}

/** Establish genuine legacy authority through its public domain path, never listing-derived route IDs. */
async function legacyPaymentFixture(f: Fixture, family: 'route' | 'spending' | 'task'): Promise<Fixture> {
  if (family === 'task') {
    const task = `legacy-task-${crypto.randomUUID()}`, bid = crypto.randomUUID()
    await db.insert(schema.tasks).values({ id: task, posterAgentId: f.agent, title: 'Separate original reviewed task',
      description: 'Deliver the independently agreed task result.', requiredCapabilities: '["code-review"]', budgetUsd: 1,
      status: 'assigned', assignedAgentId: f.sellerAgent, winningBidId: bid,
      deadlineAt: new Date(Date.now() + 900_000).toISOString(), expiresAt: new Date(Date.now() + 1800_000).toISOString() })
    await db.insert(schema.bids).values({ id: bid, taskId: task, bidderAgentId: f.sellerAgent, status: 'accepted', priceUsd: 1,
      message: 'Original separately accepted task bid', etaSeconds: 3600 })
    await db.insert(schema.task_workspaces).values({ task_id: task, agreed_price: 1, output_format: 'json',
      acceptance_criteria: '[]', required_json_keys: '["result"]' })
    const tasks = await import('@/lib/organization-task-authorizations'), version = f.rail === 'evm' ? 1 : 2
    const proposed = await tasks.proposeOrganizationTask(f.organization, f.owner, tasks.organizationTaskInput.parse({ version,
      client_reference: crypto.randomUUID(), task_id: task, winning_bid_id: bid, reviewer_role_id: f.reviewerRole,
      expected_total: '1.05', max_daily: '10.00', max_monthly: '10.00', max_lifetime: '10.00',
      max_lifetime_chain_fee_units: f.rail === 'evm' ? '1000000000000000' : '50000',
      expires_at: new Date(Date.now() + 600_000).toISOString(), expected_token_decimals: 6, expected_token_usd_price: 1, payment: f.payment }))
    const authorization = proposed.authorization
    await tasks.approveOrganizationTask(f.organization, authorization.id, f.reviewer,
      { version, client_reference: crypto.randomUUID(), authority_hash: authorization.authority_hash, approve: true })
    await tasks.checkoutOrganizationTask(f.organization, authorization.id, f.buyer,
      { version, client_reference: crypto.randomUUID(), authority_hash: authorization.authority_hash })
    const [use] = await db.select().from(schema.organization_task_uses).where(eq(schema.organization_task_uses.authorization_id, authorization.id))
    const [trade] = await db.select().from(schema.trades).where(eq(schema.trades.id, use.trade_id))
    return { ...f, trade, operationId: crypto.randomUUID(), authorization: { ...f.authorization, id: authorization.id, authority_hash: authorization.authority_hash } }
  }
  const service = crypto.randomUUID(), policy = { required: true, methods: ['buyer_review', 'schema'], acceptance: { version: 1, mode: 'explicit_buyer' } }
  await db.insert(schema.service_definitions).values({ id: service, seller_id: f.seller, title: 'Separate original service obligation',
    description: 'Return the separately reviewed original service result.', capabilities: '["code-review"]', price_minor: 100, status: 'active',
    provider_protocol: 'leased_v1', estimated_latency_seconds: 30, max_concurrency: 4, output_schema: '{"type":"object"}', verification_policy: JSON.stringify(policy) })
  if (family === 'route') {
    const routes = await import('@/lib/organization-route-authorizations'), version = f.rail === 'evm' ? 1 : 2
    const proposed = await routes.proposeOrganizationRoute(f.organization, f.owner, routes.organizationRouteInput.parse({ version,
      client_reference: crypto.randomUUID(), agent_id: f.agent, reviewer_role_id: f.reviewerRole,
      route_request: { client_reference: crypto.randomUUID(), objective: 'Review the separately approved service payment', input: {}, required_capabilities: ['code-review'],
        max_budget: { amount: '1.05', currency: 'USD' }, verification: policy, provider_requirements: { approved_providers: [f.seller] }, payment_policy: { allowed_rails: [f.rail] } },
      max_daily: '10.00', max_monthly: '10.00', max_lifetime: '10.00',
      ...(f.rail === 'evm' ? { max_lifetime_gas_cost_wei: '1000000000000000' } : { max_lifetime_fee_token_cost_units: '50000' }),
      mandate: { version: 1, client_reference: crypto.randomUUID(), max_aggregate: '1.05', max_per_execution: '1.05', max_retry_budget: '0.00', max_attempts: 1,
        approved_providers: [f.seller], max_latency_seconds: 60, private_data: 'selected_provider_only', expires_at: new Date(Date.now() + 600_000).toISOString(), payment: f.payment } }))
    const authorization = proposed.authorization
    await routes.approveOrganizationRoute(f.organization, authorization.id, f.reviewer,
      { version, client_reference: crypto.randomUUID(), authority_hash: authorization.authority_hash, approve: true })
    const execution = await (await import('@/app/api/routes/[id]/execute/route')).POST(request(`/api/routes/${authorization.route_id}/execute`, f.buyer, 'POST',
      { mandate_id: authorization.mandate.id }), context(authorization.route_id))
    assert.equal(execution.status, 201, JSON.stringify(await execution.clone().json()))
    return { ...f, trade: (await execution.json()).trade, operationId: crypto.randomUUID(),
      authorization: { ...f.authorization, id: authorization.mandate.id, authority_hash: authorization.authority_hash } }
  }
  const accounts = await import('@/lib/organization-spending-accounts'), purchasing = await import('@/lib/organization-purchasing')
  const grant = await accounts.createSpendingAccount(f.organization, f.owner, accounts.spendingAccountInput.parse({ version: f.rail === 'evm' ? 2 : 3,
    client_reference: crypto.randomUUID(), name: 'Separate original service spending', buyer_agent_id: f.agent, team_id: f.team, cost_center: 'TASK',
    allowed_services: [{ service_id: service, provider_share_id: null }], max_purchase: '1.05', max_daily: '10.00', max_monthly: '10.00', max_lifetime: '10.00',
    expires_at: new Date(Date.now() + 900_000).toISOString(), expected_token_decimals: 6, expected_token_usd_price: 1,
    payment: { ...f.payment, ...(f.rail === 'evm' ? { max_lifetime_gas_cost_wei: '1000000000000000' } : { max_lifetime_fee_token_cost_units: '50000' }) } }))
  const order = { client_reference: crypto.randomUUID(), objective: 'Review the separately approved spending purchase', input: {}, payment_rail: f.rail, expected_price: '1.00', max_total: '1.05' }
  const proposed = await purchasing.createPurchaseRequest(f.organization, f.owner, purchasing.purchaseRequestInput.parse({ version: 1, client_reference: crypto.randomUUID(),
    buyer_agent_id: f.agent, service_id: service, requester_role_id: null, reviewer_role_id: f.reviewerRole, order, expires_at: new Date(Date.now() + 900_000).toISOString() }))
  const approved = await purchasing.approvePurchase(f.organization, proposed.request.id, f.reviewer, purchasing.purchaseDecisionInput.parse({ version: 1,
    client_reference: crypto.randomUUID(), request_hash: proposed.request.request_hash, approve: true, expires_at: new Date(Date.now() + 600_000).toISOString() }))
  const keyRequest = new NextRequest('http://localhost', { headers: { Authorization: `Bearer ${grant.api_key}` } })
  const evidence = await accounts.resolveSpendingAccount(keyRequest, f.organization)
  assert.ok(evidence)
  const reserved = await (await import('@/lib/service-order-reservation')).reserveServiceOrder({ serviceId: service,
    principal: { userId: f.buyer, agentId: f.agent, kind: 'registered-agent', usesCookieAuth: false }, organizationSpendingEvidence: evidence,
    request: accounts.spendingOrderInput.parse({ service_id: service, order: { ...order, purchasing_approval_id: approved.approval.id } }).order })
  const [storedAccount] = await db.select().from(schema.organization_spending_accounts).where(eq(schema.organization_spending_accounts.id, grant.account.id))
  return { ...f, trade: reserved.trade, operationId: crypto.randomUUID(), authorization: { ...f.authorization, id: grant.account.id, authority_hash: storedAccount.authority_hash } }
}

for (const rail of ['evm', 'mpp'] as const) {
  test(`reviewed listing ${rail} retains one original intent and exact concurrent claims without route or service identities`, async () => {
    const f = await fixture(rail), made = await create(f)
    assert.equal(made.status, 201, JSON.stringify(await made.clone().json()))
    const intent = (await made.json()).intent
    const replay = await create(f); assert.equal(replay.status, 200); assert.deepEqual((await replay.json()).intent, intent)
    assert.equal((await create(f, crypto.randomUUID())).status, 409)
    assert.equal((await inspect(f, f.seller)).status, 403)
    const body = await signed(f, intent), replies = await Promise.all([claim(f, body), claim(f, body), claim(f, body)])
    const results = await Promise.all(replies.map((response) => response.json()))
    for (const [i, result] of results.entries()) {
      assert.equal(replies[i].status, 200, JSON.stringify(result)); assert.equal(result.send_allowed, true)
      assert.equal(result.claim.authorization_id, f.authorization.id); assert.equal(result.claim.authority_hash, f.authorization.authority_hash)
      assert.equal(result.claim.trade_id, f.trade.id); assert.equal(result.claim.tx_hash, keccak256(body.serialized_transaction))
    }
    assert.equal(results.filter((result) => !result.idempotent).length, 1)
    assert.equal(JSON.stringify(results).includes(body.serialized_transaction), false)
    assert.equal((await claim(f, await signed(f, intent, 8))).status, 409)
    assert.equal((await db.select().from(schema.service_orders).where(eq(schema.service_orders.trade_id, f.trade.id))).length, 0)
    assert.equal((await db.select().from(schema.route_funding_steps).where(eq(schema.route_funding_steps.trade_id, f.trade.id))).length, 0)
    await confirmFixtureReceipt(f, keccak256(body.serialized_transaction))
    assert.equal((await (await inspect(f)).json()).claim.state, 'confirmed')
    assert.equal((await (await claim(f, body)).json()).send_allowed, false)
  })
  test(`reviewed listing ${rail} revocation keeps exact proof, original trade and wallet hold until verified receipt`, async () => {
    const f = await fixture(rail), intent = (await (await create(f)).json()).intent, body = await signed(f, intent)
    assert.equal((await claim(f, body)).status, 200)
    const other = await fixture(rail, f.signer), otherIntent = (await (await create(other)).json()).intent, otherBody = await signed(other, otherIntent, 8)
    let denied = await claim(other, otherBody); assert.equal(denied.status, 409); assert.equal((await denied.json()).code, 'BUYER_WALLET_PAYMENT_UNRECONCILED')
    await domain.revokeOrganizationListing(f.organization, f.authorization.id, f.owner)
    const held = await claim(f, body); assert.equal(held.status, 200); assert.equal((await held.json()).send_allowed, false)
    assert.equal((await create(f)).status, 200)
    await db.update(schema.trades).set({ status: 'cancelled', payout_status: 'processing' }).where(eq(schema.trades.id, f.trade.id))
    const readsBeforeProof = rpcReads, hash = keccak256(body.serialized_transaction)
    const proofModule = rail === 'evm' ? await import('@/lib/organization-listing-payment') : await import('@/lib/organization-listing-tempo-payment')
    if ('assertListingEvmProof' in proofModule) {
      await proofModule.assertListingEvmProof(f.trade.id, intent.id, hash, f.signer.address)
      await assert.rejects(() => proofModule.assertListingEvmProof(f.trade.id, intent.id, `0x${'ab'.repeat(32)}`, f.signer.address), /BUYER_PAYMENT_CLAIM_REQUIRED/)
    } else {
      await proofModule.assertListingTempoProof(f.trade.id, hash, f.signer.address)
      await assert.rejects(() => proofModule.assertListingTempoProof(f.trade.id, `0x${'ab'.repeat(32)}`, f.signer.address), /BUYER_PAYMENT_CLAIM_REQUIRED/)
    }
    assert.equal(rpcReads, readsBeforeProof, 'historical hash matching never requests another send or reserve check')
    denied = await claim(other, otherBody); assert.equal(denied.status, 409)
    await confirmFixtureReceipt(f, hash)
    assert.equal((await (await inspect(f)).json()).claim.state, 'confirmed')
    assert.equal((await claim(other, otherBody)).status, 200)
    await confirmFixtureReceipt(other, keccak256(otherBody.serialized_transaction))
    const third = await fixture(rail, f.signer), thirdIntent = (await (await create(third)).json()).intent
    denied = await claim(third, await signed(third, thirdIntent, 8)); assert.equal(denied.status, 409); assert.equal((await denied.json()).code, 'BUYER_WALLET_NONCE_ALREADY_CLAIMED')
  })
  test(`reviewed listing ${rail} refuses fresh claims after current reviewer/department/quote permission changes`, async () => {
    for (const change of ['reviewer', 'department', 'quote', 'text', 'owner']) {
      const f = await fixture(rail), intent = (await (await create(f)).json()).intent, body = await signed(f, intent)
      if (change === 'reviewer') await db.update(schema.organization_purchasing_roles).set({ state: 'revoked' }).where(eq(schema.organization_purchasing_roles.id, f.reviewerRole))
      if (change === 'department') await db.update(schema.organization_teams).set({ status: 'archived' }).where(eq(schema.organization_teams.id, f.team))
      if (change === 'quote') await db.update(schema.listings).set({ price_bankr: 2 }).where(eq(schema.listings.id, f.trade.listing_id))
      if (change === 'text') await db.update(schema.listings).set({ description: 'Changed after original review' }).where(eq(schema.listings.id, f.trade.listing_id))
      if (change === 'owner') await db.update(schema.organizations).set({ owner_account_id: f.other }).where(eq(schema.organizations.id, f.organization))
      const response = await claim(f, body); assert.equal(response.status, 409, change + JSON.stringify(await response.clone().json()))
      assert.equal((await (await inspect(f)).json()).claim, null)
    }
  })
  test(`reviewed listing ${rail} claim requires original buyer, grant, operation and bounded bytes; pause preserves recovery`, async () => {
    const f = await fixture(rail), intent = (await (await create(f)).json()).intent, body = await signed(f, intent)
    assert.equal((await claim(f, body, f.seller)).status, 403, 'scope derives the original buyer before inspecting signed bytes')
    for (const changed of [{ ...body, mandate_id: crypto.randomUUID() }, { ...body, buyer_operation_id: crypto.randomUUID() },
      await signed(f, intent, 7, { maxFeePerGas: rail === 'evm' ? 3_000_000_000n : 100_000_000_001n })]) {
      assert.equal((await claim(f, changed)).status, 409)
    }
    process.env.CLAWDMARKET_NEW_PAYMENTS_PAUSED = 'true'
    try { const blocked = await claim(f, body); assert.equal(blocked.status, 409); assert.equal((await blocked.json()).code, 'NEW_PAYMENTS_PAUSED') }
    finally { delete process.env.CLAWDMARKET_NEW_PAYMENTS_PAUSED }
    assert.equal((await claim(f, body)).status, 200)
    process.env.CLAWDMARKET_NEW_PAYMENTS_PAUSED = 'true'
    try {
      const held = await claim(f, body); assert.equal(held.status, 200); assert.equal((await held.json()).send_allowed, false)
      assert.equal((await create(f)).status, 200)
    } finally { delete process.env.CLAWDMARKET_NEW_PAYMENTS_PAUSED }
    await confirmFixtureReceipt(f, keccak256(body.serialized_transaction))
  })
  test(`reviewed listing ${rail} rechecks actual reserve precision and balances; signed claims cannot be erased`, async () => {
    const f = await fixture(rail), intent = (await (await create(f)).json()).intent, body = await signed(f, intent)
    for (const mode of ['balance', 'chain', 'decimals'] as const) {
      reserveMode = mode
      try { const denied = await claim(f, body); assert.ok(denied.status >= 409); assert.equal((await (await inspect(f)).json()).claim, null) }
      finally { reserveMode = 'healthy' }
    }
    assert.equal((await claim(f, body)).status, 200)
    reserveMode = 'balance'
    try { assert.equal((await (await claim(f, body)).json()).send_allowed, false) } finally { reserveMode = 'healthy' }
    if (rail === 'evm') {
      const api = await import('@/lib/evm-intent-api'), deleted = await api.DELETE(request(`/api/trades/${f.trade.id}/fund/evm/intent`, f.buyer, 'DELETE', { reason: 'wallet_rejected', intent_id: intent.id }), context(f.trade.id))
      assert.equal(deleted.status, 409); assert.equal((await deleted.json()).code, 'BUYER_ORIGINAL_PAYMENT_RECOVERY_REQUIRED')
    }
    await confirmFixtureReceipt(f, keccak256(body.serialized_transaction))
  })
  test(`reviewed listing ${rail} serializes revocation requested during reserve RPC and closes the next exact claim`, async () => {
    for (const priorClaim of [false, true]) {
      const f = await fixture(rail), intent = (await (await create(f)).json()).intent, body = await signed(f, intent)
      if (priorClaim) assert.equal((await claim(f, body)).status, 200)
      let requested = false, revocation: Promise<boolean> | null = null, revocationError: unknown
      rpcHook = async (method) => {
        if (requested || method !== 'eth_call') return
        requested = true
        // The current purchasing write owns the writer lock. Queue independent
        // revocation without blocking the RPC whose completion releases that lock.
        revocation = domain.revokeOrganizationListing(f.organization, f.authorization.id, f.owner)
          .then(() => true, (error: unknown) => { revocationError = error; return false })
      }
      let response: Response
      try { response = await claim(f, body) } finally { rpcHook = null }
      assert.equal(requested, true)
      assert.equal(response.status, 200, JSON.stringify(await response.clone().json()))
      assert.equal((await response.json()).send_allowed, true)
      assert.ok(revocation); assert.equal(await revocation, true, String(revocationError))
      const finalClaim = await claim(f, body)
      assert.equal(finalClaim.status, 200); assert.equal((await finalClaim.json()).send_allowed, false)
      const saved = (await (await inspect(f)).json()).claim
      assert.ok(saved); assert.equal(saved.tx_hash, keccak256(body.serialized_transaction)); assert.equal(saved.state, 'claimed')
    }
  })
  test(`reviewed listing ${rail} cancellation expires its original listing and generic checkout cannot replace it`, async () => {
    const f = await fixture(rail), intent = (await (await create(f)).json()).intent, body = await signed(f, intent)
    assert.equal((await claim(f, body)).status, 200)
    await (await import('@/lib/trade-funding')).expireTradePayment(f.trade)
    const [listing] = await db.select().from(schema.listings).where(eq(schema.listings.id, f.trade.listing_id))
    assert.equal(listing.status, 'expired')
    const [use] = await db.select().from(schema.organization_listing_uses).where(eq(schema.organization_listing_uses.authorization_id, f.authorization.id))
    const recovered = await domain.checkoutOrganizationListing(f.organization, f.authorization.id, f.buyer,
      { version: f.authorization.version, client_reference: use.client_reference, authority_hash: f.authorization.authority_hash })
    assert.equal(recovered.created, false); assert.equal(recovered.trade?.id, f.trade.id); assert.equal(recovered.trade?.status, 'cancelled')
    // Listing state alone cannot undo the original obligation or reopen catalog authority.
    await db.update(schema.listings).set({ status: 'active' }).where(eq(schema.listings.id, listing.id))
    assert.equal(await (await import('@/lib/listing-visibility')).originalReviewedListing(listing.id), true)
    const catalog = await (await import('@/app/api/listings/route')).GET(new NextRequest(`http://localhost/api/listings?seller_id=${f.seller}&status=active`))
    assert.equal(catalog.status, 200); assert.equal(JSON.stringify(await catalog.json()).includes(listing.id), false)
    const purchase = await (await import('@/app/api/trades/route')).POST(request('/api/trades', f.other, 'POST',
      { listing_id: listing.id, amount: 1, payment_rail: rail, client_reference: crypto.randomUUID() }))
    assert.equal(purchase.status, 409); assert.equal((await purchase.json()).error_code, 'LISTING_NOT_AVAILABLE')
    assert.equal((await db.select().from(schema.trades).where(eq(schema.trades.listing_id, listing.id))).length, 1)
    await db.update(schema.listings).set({ status: 'expired' }).where(eq(schema.listings.id, listing.id))
    await confirmFixtureReceipt(f, keccak256(body.serialized_transaction))
    assert.equal((await (await inspect(f)).json()).claim.state, 'confirmed')
  })
  test(`reviewed listing ${rail} verified proof after revocation commits rejection, original claim and expired listing together`, async () => {
    const f = await fixture(rail), intent = (await (await create(f)).json()).intent, body = await signed(f, intent)
    assert.equal((await claim(f, body)).status, 200)
    await domain.revokeOrganizationListing(f.organization, f.authorization.id, f.owner)
    await assert.rejects(() => confirmFixtureReceipt(f, keccak256(body.serialized_transaction)),
      (error: unknown) => (error as { code?: string }).code === 'PROVIDER_ELIGIBILITY_CHANGED')
    const [listing] = await db.select().from(schema.listings).where(eq(schema.listings.id, f.trade.listing_id))
    const [trade] = await db.select().from(schema.trades).where(eq(schema.trades.id, f.trade.id))
    assert.equal(listing.status, 'expired'); assert.equal(trade.status, 'cancelled'); assert.equal(trade.payout_status, 'processing')
    assert.equal((await (await inspect(f)).json()).claim.state, 'confirmed')
    assert.equal((await db.select().from(schema.payment_receipts).where(eq(schema.payment_receipts.trade_id, f.trade.id))).length, 1)
    assert.equal((await db.select().from(schema.organization_listing_uses).where(eq(schema.organization_listing_uses.trade_id, f.trade.id))).length, 1)
  })
}

test('reviewed listing Tempo actual pull requires original challenge and bytes, and rechecks revocation before first submission', async () => {
  const f = await fixture('mpp'), intent = (await (await create(f)).json()).intent, body = await signed(f, intent)
  const { assertBuyerMppPull } = await import('@/lib/buyer-mpp-payment'), { assertMarketplaceMppPullAllowed } = await import('@/lib/marketplace-mpp-payment')
  const pull = { serialized_transaction: body.serialized_transaction, challenge: intent.challenge }
  await assert.rejects(() => assertBuyerMppPull(f.trade.id, f.signer.address, pull, true), /BUYER_ORIGINAL_CREDENTIAL_REQUIRED/)
  await claim(f, body)
  await assert.rejects(() => assertMarketplaceMppPullAllowed(f.trade.id), (error: unknown) => (error as { code?: string }).code === 'MPP_MANDATE_PULL_NOT_READY')
  await assert.rejects(() => assertBuyerMppPull(f.trade.id, f.signer.address, { ...pull, challenge: { ...intent.challenge, id: 'changed' } }, true), /BUYER_ORIGINAL_CREDENTIAL_REQUIRED/)
  const changed = await signed(f, intent, 8)
  await assert.rejects(() => assertBuyerMppPull(f.trade.id, f.signer.address, { ...pull, serialized_transaction: changed.serialized_transaction }, true), /PAYMENT_TRANSACTION_CONFLICT/)
  await domain.revokeOrganizationListing(f.organization, f.authorization.id, f.owner)
  await assert.rejects(() => assertBuyerMppPull(f.trade.id, f.signer.address, pull, true), /LISTING_/)
  assert.equal((await (await inspect(f)).json()).claim.first_submission_at, null)
})

for (const rail of ['evm', 'mpp'] as const) for (const family of ['route', 'spending', 'task'] as const) {
  test(`original ${rail} wallet holds and consumed nonces exclude listing and ${family} claims in both directions`, async () => {
    for (const listingFirst of [true, false]) {
      const listing = await fixture(rail), legacyBase = await fixture(rail, listing.signer), legacy = await legacyPaymentFixture(legacyBase, family)
      const first = listingFirst ? listing : legacy, second = listingFirst ? legacy : listing
      const firstIntent = (await (await create(first)).json()).intent, secondIntent = (await (await create(second)).json()).intent
      const firstBytes = await signed(first, firstIntent, 7), secondBytes = await signed(second, secondIntent, 8)
      const accepted = await claim(first, firstBytes); assert.equal(accepted.status, 200, JSON.stringify(await accepted.clone().json()))
      let blocked = await claim(second, secondBytes); assert.equal(blocked.status, 409); assert.equal((await blocked.json()).code, 'BUYER_WALLET_PAYMENT_UNRECONCILED')
      await db.update(schema.trades).set({ status: 'cancelled', payout_status: 'processing' }).where(eq(schema.trades.id, first.trade.id))
      blocked = await claim(second, secondBytes); assert.equal(blocked.status, 409, 'cancellation is not confirmation of original bytes')
      await confirmFixtureReceipt(first, keccak256(firstBytes.serialized_transaction))
      assert.equal((await claim(second, secondBytes)).status, 200)
      await confirmFixtureReceipt(second, keccak256(secondBytes.serialized_transaction))
      const base = await fixture(rail, listing.signer), third = listingFirst ? base : await legacyPaymentFixture(base, family)
      const thirdIntent = (await (await create(third)).json()).intent
      blocked = await claim(third, await signed(third, thirdIntent, 8)); assert.equal(blocked.status, 409)
      assert.equal((await blocked.json()).code, 'BUYER_WALLET_NONCE_ALREADY_CLAIMED')
    }
  })
}

for (const rail of ['evm', 'mpp'] as const) {
  test(`reviewed listing ${rail} retains frozen delivery checks and exact explicit acceptance after revocation`, async () => {
    const f = await fixture(rail), intent = (await (await create(f)).json()).intent, body = await signed(f, intent)
    assert.equal((await claim(f, body)).status, 200)
    await confirmFixtureReceipt(f, keccak256(body.serialized_transaction))
    await domain.revokeOrganizationListing(f.organization, f.authorization.id, f.owner)
    await db.update(schema.listings).set({ title: 'Changed catalog title', description: 'Changed public description', price_bankr: 99 })
      .where(eq(schema.listings.id, f.trade.listing_id))
    const api = await import('@/app/api/trades/[id]/delivery/route'), acceptance = await import('@/lib/trade-acceptance')
    const send = (actor: string, artifact: unknown) => api.POST(request(`/api/trades/${f.trade.id}/delivery`, actor, 'POST',
      { summary: 'Original finite reviewed result is ready for buyer assessment.', artifact }), context(f.trade.id))
    assert.equal((await send(f.other, { result: 'private result' })).status, 403)
    const invalid = await send(f.seller, { wrong_key: 'Does not satisfy the agreed structure' })
    assert.equal(invalid.status, 422, JSON.stringify(await invalid.clone().json()))
    assert.equal((await db.select().from(schema.trade_deliveries).where(eq(schema.trade_deliveries.trade_id, f.trade.id))).length, 0)
    const delivered = await send(f.seller, { result: 'A structurally valid result still needs explicit buyer review' })
    assert.equal(delivered.status, 201, JSON.stringify(await delivered.clone().json()))
    const receipt = await delivered.json(), hash = receipt.delivery.content_hash
    assert.equal((await send(f.seller, { result: 'A structurally valid result still needs explicit buyer review' })).status, 200)
    assert.equal((await send(f.seller, { result: 'Changed private result' })).status, 409)
    const [trade] = await db.select().from(schema.trades).where(eq(schema.trades.id, f.trade.id))
    assert.equal(trade.status, 'pending_release'); assert.equal(trade.auto_confirm_at, null)
    await assert.rejects(() => acceptance.assertReadyForBuyerAcceptance(trade.id), /EXPLICIT_ACCEPTANCE_REQUIRED/)
    await assert.rejects(() => acceptance.assertReadyForBuyerAcceptance(trade.id, db, '0'.repeat(64)), /DELIVERY_CHANGED/)
    await acceptance.assertReadyForBuyerAcceptance(trade.id, db, hash)
    for (const reason of ['auto_confirm', 'seller_payout', 'buyer_confirm'] as const) {
      await assert.rejects(() => acceptance.assertTradeReleaseAllowed(trade.id, reason), /EXPLICIT_ACCEPTANCE_REQUIRED/)
    }
    const status = await acceptance.tradeAcceptanceStatus(trade.id)
    assert.equal(status.mode, 'explicit_buyer'); assert.equal(status.auto_confirm_enabled, false); assert.equal(status.accepted, false)
    assert.equal((await db.select().from(schema.service_orders).where(eq(schema.service_orders.trade_id, trade.id))).length, 0)
    assert.equal((await db.select().from(schema.task_workspaces).where(eq(schema.task_workspaces.trade_id, trade.id))).length, 0)
  })
}
