import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { execFile, spawn } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { privateKeyToAccount } from 'viem/accounts'
import { Account } from 'viem/tempo'
import { createLocalTestSchema } from '../helpers/local-schema'
import { startDisposableWorkflowChain } from '../helpers/disposable-workflow-chain'
import { startDisposableTempoChain } from '../helpers/disposable-tempo-chain'
import { runBuyerListingFunding } from '../../scripts/buyer-listing-worker.mjs'
import { createBuyerEvmAdapter } from '../../scripts/buyer-evm-adapter.mjs'
import { createBuyerTempoAdapter } from '../../scripts/buyer-tempo-adapter.mjs'

const buyerKey = `0x${'18'.repeat(32)}` as const, treasuryKey = `0x${'99'.repeat(32)}` as const
for (const rail of ['evm', 'mpp'] as const) test(`disposable ${rail === 'evm' ? 'L1' : 'Tempo'} independently reviewed listing completes original payment, provider restart, explicit acceptance and revoked late refund`, {
  skip: !(rail === 'evm' ? process.env.CLAWDMARKET_TEST_ANVIL_BINARY : process.env.CLAWDMARKET_TEST_TEMPO_BINARY), timeout: 180_000,
}, async () => {
  if (process.env.CLAWDMARKET_TEST_LISTING_ECONOMIC_RAIL === rail) return economicScenario(rail)
  const environment: NodeJS.ProcessEnv = { ...process.env, CLAWDMARKET_TEST_LISTING_ECONOMIC_RAIL: rail }; delete environment.NODE_TEST_CONTEXT
  const output = await promisify(execFile)(process.execPath, ['--conditions=react-server', '--import', 'tsx', '--test', '--test-reporter=spec',
    `--test-name-pattern=^disposable ${rail === 'evm' ? 'L1' : 'Tempo'} independently reviewed listing`, 'tests/api/organization-listing-economic.test.ts'], {
    cwd: process.cwd(), env: environment, timeout: 170_000, maxBuffer: 1024 * 1024,
  })
  assert.match(output.stdout, /"listing_economic_acceptance":"passed"/)
  assert.match(output.stdout, /ℹ fail 0/)
  console.info(output.stdout.trim())
})

async function economicScenario(rail: 'evm' | 'mpp') {
  const directory = await mkdtemp(join(tmpdir(), 'clawdmarket-workspace-test-listing-economic-'))
  Object.assign(process.env, { TURSO_DATABASE_URL: `file:${join(directory, 'listing.db')}`, TURSO_AUTH_TOKEN: '', JWT_SECRET: 'listing-economic-public-dummy-fixture-only',
    CHAT_ENCRYPTION_KEY: 'listing-economic-public-dummy-chat-fixture-only', WEBHOOK_SECRET_KEY: 'listing-economic-public-dummy-webhook-fixture-only',
    CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED: 'true', CLAWDMARKET_ROUTE_EXECUTION_ENABLED: 'true' })
  for (const name of ['VERCEL', 'VERCEL_ENV', 'CLAWDMARKET_CANONICAL_ORIGIN', 'CLAWDMARKET_PRODUCTION_READINESS', 'CLAWDMARKET_NEW_PAYMENTS_PAUSED', 'DEV_WALLET_ADDRESS', 'DEV_FEE_WALLET_ADDRESS']) delete process.env[name]
  const account = rail === 'mpp' ? Account.fromSecp256k1(buyerKey) : privateKeyToAccount(buyerKey)
  const chain = rail === 'mpp' ? await startDisposableTempoChain(process.env.CLAWDMARKET_TEST_TEMPO_BINARY!, account.address, treasuryKey)
    : await startDisposableWorkflowChain(process.env.CLAWDMARKET_TEST_ANVIL_BINARY!, account.address, treasuryKey)
  Object.assign(process.env, { TREASURY_ADDRESS: chain.treasury, EVM_SETTLEMENT_PRIVATE_KEY: treasuryKey, EVM_RPC_URL_1: chain.url,
    EVM_ACCEPTED_TOKENS: JSON.stringify([{ chainId: 1, chainName: 'Disposable reviewed listing L1', address: chain.token, symbol: 'TEST', decimals: 6, fixedUsdPrice: 1, confirmations: 1, rpcUrl: chain.url }]),
    ...(rail === 'mpp' ? { TEMPO_RPC_URL: chain.url, MPP_RECIPIENT_ADDRESS: chain.treasury, MPP_SECRET_KEY_CURRENT: 'listing-economic-public-dummy-tempo-secret-only' } : {}) })
  const db = (await import('@/lib/db')).db, schema = await import('@/lib/schema')
  await createLocalTestSchema(db.$client, schema)
  const jwt = (await import('@/lib/auth')).generateJWT, domain = await import('@/lib/organization-listing-authorizations')
  const payout = `0x${'33'.repeat(20)}` as const, feeCeiling = rail === 'mpp' ? '10000' : '10000000000000000'
  const server = createServer(), events: Array<{ method: string; path: string; status?: number }> = []
  let base = '', beforeHook: null | ((path: string, method: string) => Promise<boolean>) = null
  let afterHook: null | ((path: string, method: string, response: Response) => Promise<boolean>) = null
  server.on('request', async (incoming, outgoing) => {
    try {
      const chunks: Buffer[] = []; for await (const chunk of incoming) chunks.push(Buffer.from(chunk))
      const body = Buffer.concat(chunks).toString(), path = new URL(incoming.url!, base).pathname, method = incoming.method || 'GET'
      events.push({ method, path })
      if (beforeHook && await beforeHook(path, method)) { outgoing.destroy(); return }
      const parts = path.split('/'), context = { params: Promise.resolve({ id: parts[3], authorizationId: parts[5], artifactId: parts[5] }) }
      let modulePath: string
      if (parts[2] === 'organizations') modulePath = parts[6] === 'checkout'
        ? '@/app/api/organizations/[id]/listing-authorizations/[authorizationId]/checkout/route'
        : parts[6] === 'approval' ? '@/app/api/organizations/[id]/listing-authorizations/[authorizationId]/approval/route'
          : parts[5] ? '@/app/api/organizations/[id]/listing-authorizations/[authorizationId]/route' : '@/app/api/organizations/[id]/listing-authorizations/route'
      else if (parts[4] === 'fund') modulePath = `@/app/api/trades/[id]/fund/${parts[5]}${parts[6] ? '/' + parts[6] : ''}/route`
      else modulePath = `@/app/api/trades/[id]/${parts[4]}${parts[5] ? '/[artifactId]' : ''}/route`
      const handler = (await import(modulePath))[method]
      const request = new NextRequest(base + incoming.url, { method, headers: incoming.headers as Record<string, string>, ...(body ? { body } : {}) })
      const response = await handler(request, context)
      events.at(-1)!.status = response.status
      if (!response.ok && path.includes('/fund/')) console.error(JSON.stringify({ listing_fixture_http_failure: { method, path, status: response.status, body: await response.clone().json() } }))
      if (afterHook && await afterHook(path, method, response)) { outgoing.destroy(); return }
      outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(Buffer.from(await response.arrayBuffer()))
    } catch { outgoing.writeHead(500, { 'Content-Type': 'application/json' }); outgoing.end(JSON.stringify({ fixture_error: 'CONTROLLED_TEST_TRANSPORT_FAILED' })) }
  })
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done)); base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  process.env.CLAWDMARKET_CANONICAL_ORIGIN = base
  const keyFor = (actor: string) => jwt({ userId: actor, email: `${actor}@test.invalid`, role: 'human' })
  const api = async (actor: string, method: string, path: string, body?: unknown) => {
    const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${keyFor(actor)}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    const value = await response.json(); return { status: response.status, body: value }
  }
  let sequence = 0
  async function fixture() {
    const id = crypto.randomUUID(), buyerAgent = `agent_${crypto.randomUUID()}`, sellerAgent = `agent_${crypto.randomUUID()}`, listingId = `legacy-listing-${crypto.randomUUID()}`, team = crypto.randomUUID()
    const owner = `listing-owner-${id}`, reviewer = `listing-reviewer-${id}`, providerOwner = `listing-provider-owner-${id}`, buyer = `user_agent_${buyerAgent}`, seller = `user_agent_${sellerAgent}`, now = new Date()
    await db.insert(schema.users).values([owner, reviewer, providerOwner, buyer, seller].map(id => ({ id, name: id, email: `${id}@test.invalid`, password_hash: 'unused' })))
    await db.insert(schema.agents).values([buyerAgent, sellerAgent].map(id => ({ id, name: 'Original listing participant', description: 'Disposable public listing fixture', capabilities: '["code-review"]', endpoint: 'https://example.invalid', owner_address: '', api_key: 'unused' })))
    await db.insert(schema.agent_owners).values([{ agentId: buyerAgent, userId: owner, establishedBy: 'test' }, { agentId: sellerAgent, userId: providerOwner, establishedBy: 'test' }])
    await db.insert(schema.organizations).values({ id, owner_account_id: owner, client_reference: id, name: 'Independently reviewed listing', created_at: now, updated_at: now })
    await db.insert(schema.organization_teams).values({ id: team, organization_id: id, slug: 'review', name: 'Review', created_at: now, updated_at: now })
    await db.insert(schema.organization_agent_assignments).values({ agent_id: buyerAgent, organization_id: id, team_id: team, cost_center: 'ORIGINAL_LISTING', assigned_at: now, updated_at: now })
    await db.insert(schema.payout_addresses).values({ user_id: seller, address: payout })
    const membership = await import('@/lib/organization-membership'), purchasing = await import('@/lib/organization-purchasing')
    const invited = await membership.createOrganizationInvitation(id, owner, reviewer, crypto.randomUUID()); assert.equal(invited.kind, 'ok')
    assert.equal((await membership.acceptOrganizationInvitation(invited.invitation_id!, reviewer)).kind, 'ok')
    const role = await purchasing.grantPurchasingRole(id, owner, purchasing.purchasingRoleInput.parse({ version: 1, client_reference: crypto.randomUUID(), account_id: reviewer,
      team_id: team, role: 'approver', max_purchase: '10.00', expires_at: new Date(Date.now() + 3600_000).toISOString() }))
    await db.insert(schema.listings).values({ id: listingId, seller_id: seller, category: 'code', title: 'Original bounded listing report',
      description: 'Deliver the exact reviewed listing report privately.', price_bankr: 1, status: 'active' })
    const input = { version: rail === 'evm' ? 1 : 2, client_reference: crypto.randomUUID(), listing_id: listingId, buyer_agent_id: buyerAgent,
      delivery: { output_format: 'json', acceptance_criteria: ['Buyer inspects the original report'], required_json_keys: ['result', 'sources'], minimum_sources: 1 }, reviewer_role_id: role.role.id,
      expected_total: '1.05', max_daily: '10.00', max_monthly: '10.00', max_lifetime: '10.00', max_lifetime_chain_fee_units: (BigInt(feeCeiling) * 10n).toString(),
      expires_at: new Date(Date.now() + 600_000).toISOString(), expected_token_decimals: 6, expected_token_usd_price: 1,
      payment: { rail, chain_id: rail === 'evm' ? 1 : 4217, token_address: chain.token.toLowerCase(), payer_address: account.address.toLowerCase(), treasury_address: chain.treasury.toLowerCase(),
        minimum_token_reserve_units: '1000000', ...(rail === 'evm' ? { minimum_native_reserve_wei: '1000000000000', max_gas_cost_wei: feeCeiling }
          : { fee_token_address: chain.token.toLowerCase(), minimum_fee_token_reserve_units: '1000000', max_fee_token_cost_units: feeCeiling }) } }
    const prefix = `/api/organizations/${id}/listing-authorizations`
    const proposed = await api(owner, 'POST', prefix, input); assert.equal(proposed.status, 201, JSON.stringify(proposed.body))
    const authorization = proposed.body.authorization
    const approved = await api(reviewer, 'POST', `${prefix}/${authorization.id}/approval`, { version: input.version, client_reference: crypto.randomUUID(), authority_hash: authorization.authority_hash, approve: true })
    assert.equal(approved.status, 201, JSON.stringify(approved.body))
    const approval = { version: input.version, origin: base, rpc_url: chain.url, organization_id: id, authorization_id: authorization.id, authority_hash: authorization.authority_hash,
      listing_id: listingId, buyer_id: buyer, total_minor: 105, payment: authorization.terms.payment, token_decimals: authorization.terms.token_decimals,
      token_usd_price: authorization.terms.token_usd_price, ...(rail === 'mpp' ? { fee_token_decimals: authorization.terms.fee_token_decimals } : {}), expires_at: authorization.terms.expires_at }
    const state = join(directory, `${++sequence}.buyer-state`), approvalFile = join(directory, `${sequence}.approval.json`)
    await writeFile(approvalFile, JSON.stringify(approval), { mode: 0o600 })
    return { id, buyerAgent, sellerAgent, owner, reviewer, buyer, seller, listingId, authorization, approval, state, approvalFile, prefix }
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>
  const buyerArgs = (f: Fixture, prepareOnly = false) => ['scripts/buyer-listing-worker.mjs', f.approvalFile, f.state, ...(prepareOnly ? ['--prepare-only'] : [])]
  const buyerEnvironment = (f: Fixture) => ({ ...process.env, CLAWDMARKET_BUYER_API_KEY: keyFor(f.buyer), CLAWDMARKET_BUYER_PRIVATE_KEY: buyerKey })
  const buyerProcess = async (f: Fixture, prepareOnly = false) => {
    const result = await promisify(execFile)(process.execPath, buyerArgs(f, prepareOnly), { cwd: process.cwd(), env: buyerEnvironment(f), timeout: 30_000 })
    assert.equal(result.stdout.includes(buyerKey.slice(2)), false); assert.equal(result.stdout.includes(keyFor(f.buyer)), false)
    return JSON.parse(result.stdout)
  }
  const inspectJournal = async (f: Fixture) => {
    const files = (await readdir(f.state)).filter(name => name.endsWith('.json'))
    const values = await Promise.all(files.map(name => readFile(join(f.state, name), 'utf8')))
    for (const [index, text] of values.entries()) { assert.equal(text.includes(buyerKey.slice(2)), false); assert.equal(text.includes(keyFor(f.buyer)), false); assert.equal((await stat(join(f.state, files[index]))).mode & 0o077, 0) }
    return values.map(text => JSON.parse(text)).find(value => value.authorization_id === f.authorization.id)
  }
  const funded = async (f: Fixture) => {
    let result = await buyerProcess(f)
    for (let attempt = 0; result.state === 'awaiting_confirmation' && attempt < 5; attempt++) { await new Promise(done => setTimeout(done, 200)); result = await buyerProcess(f) }
    assert.equal(result.state, 'funded', JSON.stringify(result)); return result
  }
  async function providerOptions(f: Fixture, tradeId: string) {
    const handler = join(directory, `${f.listingId}.provider.mjs`), count = join(directory, `${f.listingId}.executions`), state = join(directory, `${f.listingId}.provider-state`)
    await writeFile(handler, `import {appendFile} from 'node:fs/promises';import {createHash} from 'node:crypto';export default async function(work){
      if(work.listing_id!==${JSON.stringify(f.listingId)}||work.trade_id!==${JSON.stringify(tradeId)}||work.requirements.output_format!=='json')throw Error('ORIGINAL_LISTING_MISMATCH');
      await appendFile(${JSON.stringify(count)},'executed\\n',{mode:0o600});const artifact={result:'original private accepted report',sources:['https://example.invalid/listing-source']};
      const bytes=Buffer.from(JSON.stringify(artifact));return {summary:'The assigned provider completed the original reviewed listing.',artifact,
        files:[{name:'report.json',media_type:'application/json',content_base64:bytes.toString('base64'),sha256:createHash('sha256').update(bytes).digest('hex')}]};}`, { mode: 0o600 })
    const args = ['scripts/provider-listing-worker.mjs', '--listing-id', f.listingId, '--trade-id', tradeId, '--handler', handler, '--state-dir', state]
    const environment = { ...process.env, BASE_URL: base, CLAWDMARKET_PROVIDER_API_KEY: keyFor(f.seller) }
    const run = async (prepareOnly = false) => JSON.parse((await promisify(execFile)(process.execPath, [...args, ...(prepareOnly ? ['--prepare-only'] : [])], { cwd: process.cwd(), env: environment, timeout: 30_000 })).stdout)
    return { args, environment, run, count }
  }
  const inspectUse = async (f: Fixture, tradeId: string) => {
    const uses = await db.select().from(schema.organization_listing_uses).where(eq(schema.organization_listing_uses.authorization_id, f.authorization.id))
    assert.equal((await db.select().from(schema.task_workspaces).where(eq(schema.task_workspaces.trade_id, tradeId))).length, 0); assert.equal(uses.length, 1); assert.equal(uses[0].trade_id, tradeId); assert.equal(uses[0].amount_minor, 105)
    assert.equal((await db.select().from(schema.service_orders).where(eq(schema.service_orders.trade_id, tradeId))).length, 0)
    assert.equal((await db.select().from(schema.route_funding_steps).where(eq(schema.route_funding_steps.trade_id, tradeId))).length, 0)
    return uses[0]
  }
  const settle = async (f: Fixture, tradeId: string, contentHash: string) => {
    const result = await api(f.buyer, 'POST', `/api/trades/${tradeId}/confirm`, { content_hash: contentHash })
    assert.ok([200, 202].includes(result.status), JSON.stringify(result.body))
    const transfers = await db.select().from(schema.settlement_transfers).where(eq(schema.settlement_transfers.trade_id, tradeId))
    for (const transfer of transfers) await (await import('@/lib/external-settlement')).processSettlementTransfer(transfer.id, { waitMs: 5000 })
    const [current] = await db.select().from(schema.trades).where(eq(schema.trades.id, tradeId))
    if (current.status === 'pending_release') {
      const finished = await api(f.buyer, 'POST', `/api/trades/${tradeId}/confirm`, { content_hash: contentHash }); assert.equal(finished.status, 200, JSON.stringify(finished.body))
    }
    const [complete] = await db.select().from(schema.trades).where(eq(schema.trades.id, tradeId))
    assert.equal(complete.status, 'completed'); assert.equal(complete.payout_status, 'complete')
    const [listing] = await db.select().from(schema.listings).where(eq(schema.listings.id, f.listingId)); assert.equal(listing.status, 'sold')
    const [payment] = await db.select().from(schema.payment_receipts).where(eq(schema.payment_receipts.trade_id, tradeId))
    assert.equal(payment.chain_id, rail === 'evm' ? 1 : 4217); assert.equal(payment.payment_rail, rail)
    for (const transfer of await db.select().from(schema.settlement_transfers).where(eq(schema.settlement_transfers.trade_id, tradeId))) {
      assert.equal(transfer.status, 'confirmed'); assert.equal((await chain.client.getTransactionReceipt({ hash: transfer.tx_hash as `0x${string}` })).status, 'success')
    }
    assert.equal((await chain.client.getTransactionReceipt({ hash: payment.tx_hash as `0x${string}` })).status, 'success')
  }
  async function killWorker(args: string[], environment: NodeJS.ProcessEnv, match: (path: string, method: string) => boolean, boundary: 'before' | 'after') {
    let arrive!: () => void, release!: () => void
    const arrived = new Promise<void>(done => arrive = done), blocked = new Promise<void>(done => release = done)
    const hook = async (path: string, method: string) => { if (!match(path, method)) return false; arrive(); await blocked; return true }
    if (boundary === 'before') beforeHook = hook; else afterHook = hook
    const child = spawn(process.execPath, args, { cwd: process.cwd(), env: environment, detached: true, stdio: ['ignore', 'ignore', 'pipe'] })
    let errors = ''; child.stderr.on('data', bytes => errors += bytes)
    const exited = new Promise<void>(done => child.once('exit', () => done()))
    const timeout = setTimeout(() => { if (child.pid && child.exitCode === null && child.signalCode === null) process.kill(-child.pid, 'SIGKILL'); release() }, 15_000)
    try {
      await Promise.race([arrived, exited.then(() => { throw Error(errors || 'Worker exited before the targeted original boundary') })])
      assert.ok(child.pid); process.kill(-child.pid, 'SIGKILL'); await exited
    } finally { clearTimeout(timeout); beforeHook = null; afterHook = null; release(); if (child.pid && child.exitCode === null && child.signalCode === null) process.kill(-child.pid, 'SIGKILL'); await exited }
  }
  try {
    const f = await fixture(), prepared = await buyerProcess(f, true)
    assert.equal(prepared.state, 'prepared'); const original = await inspectJournal(f)
    assert.equal(original.tx_hash, prepared.tx_hash); assert.equal(original.submission_started, false)
    const fundedOriginal = await funded(f); assert.equal(fundedOriginal.trade_id, prepared.trade_id); assert.equal(fundedOriginal.tx_hash, prepared.tx_hash)
    const provider = await providerOptions(f, prepared.trade_id), preparedDelivery = await provider.run(true)
    assert.equal(preparedDelivery.state, 'prepared')
    // Restart both hosts using the exact persisted checkout, bytes and provider output.
    const delivery = await provider.run(); assert.equal(delivery.state, 'delivered')
    assert.equal((await readFile(provider.count, 'utf8')).trim().split('\n').length, 1)
    const [waiting] = await db.select().from(schema.trades).where(eq(schema.trades.id, prepared.trade_id)); assert.equal(waiting.auto_confirm_at, null)
    assert.equal(waiting.status, 'pending_release')
    await assert.rejects(() => (import('@/lib/trade-escrow')).then(module => module.finalizeTradeCompletion(waiting, 'auto_confirm')), error => (error as { code?: string }).code === 'EXPLICIT_ACCEPTANCE_REQUIRED')
    const missing = await api(f.buyer, 'POST', `/api/trades/${prepared.trade_id}/confirm`, {}); assert.equal(missing.status, 409); assert.equal(missing.body.code, 'EXPLICIT_ACCEPTANCE_REQUIRED')
    const invalid = await api(f.buyer, 'POST', `/api/trades/${prepared.trade_id}/confirm`, { content_hash: 'f'.repeat(64) }); assert.equal(invalid.status, 409)
    await settle(f, prepared.trade_id, delivery.content_hash); await inspectUse(f, prepared.trade_id)
    const replay = await provider.run(); assert.equal(replay.delivery_id, delivery.delivery_id); assert.equal(replay.content_hash, delivery.content_hash)
    const artifact = (await db.select().from(schema.private_artifacts).where(eq(schema.private_artifacts.trade_id, prepared.trade_id)))[0]
    const download = await fetch(base + `/api/trades/${prepared.trade_id}/artifacts/${artifact.id}`, { headers: { Authorization: `Bearer ${keyFor(f.buyer)}` } })
    assert.equal(download.status, 200); assert.equal(createHash('sha256').update(Buffer.from(await download.arrayBuffer())).digest('hex'), artifact.sha256)
    const denied = await fetch(base + `/api/trades/${prepared.trade_id}/artifacts/${artifact.id}`, { headers: { Authorization: `Bearer ${keyFor(f.reviewer)}` } }); assert.equal(denied.status, 404)
    assert.equal((await buyerProcess(f)).tx_hash, prepared.tx_hash)
    for (const boundary of ['before', 'after'] as const) {
      const killed = await fixture(), checkoutPath = `${killed.prefix}/${killed.authorization.id}/checkout`
      await killWorker(buyerArgs(killed), buyerEnvironment(killed), (path, method) => path === checkoutPath && method === 'POST', boundary)
      const recovered = await funded(killed); await inspectUse(killed, recovered.trade_id)
      const killedClaim = await fixture()
      await killWorker(buyerArgs(killedClaim), buyerEnvironment(killedClaim), (path, method) => path.endsWith('/claim') && method === 'POST', boundary)
      const journal = await inspectJournal(killedClaim), claimTable = rail === 'evm' ? schema.organization_listing_payment_claims : schema.organization_listing_mpp_claims
      const claims = await db.select().from(claimTable).where(eq(claimTable.trade_id, journal.trade_id))
      assert.equal(claims.length, boundary === 'before' ? 0 : 1)
      const resumed = await funded(killedClaim); assert.equal(resumed.trade_id, journal.trade_id); assert.equal(resumed.tx_hash, journal.tx_hash); await inspectUse(killedClaim, resumed.trade_id)
      const providerFixture = await fixture(), providerFunded = await funded(providerFixture), provider = await providerOptions(providerFixture, providerFunded.trade_id)
      await killWorker(provider.args, provider.environment, (path, method) => path.endsWith('/delivery') && method === 'POST', boundary)
      const prior = await db.select().from(schema.trade_deliveries).where(eq(schema.trade_deliveries.trade_id, providerFunded.trade_id)); assert.equal(prior.length, boundary === 'before' ? 0 : 1)
      const resumedDelivery = await provider.run(); assert.equal((await readFile(provider.count, 'utf8')).trim().split('\n').length, 1)
      if (prior.length) assert.equal(resumedDelivery.delivery_id, prior[0].id)
      await settle(providerFixture, providerFunded.trade_id, resumedDelivery.content_hash); await inspectUse(providerFixture, providerFunded.trade_id)
    }
    const late = await fixture(), latePrepared = await buyerProcess(late, true), lateJournal = await inspectJournal(late), beforeLate = await chain.balance(account.address)
    const revoked = await api(late.owner, 'DELETE', `${late.prefix}/${late.authorization.id}`); assert.equal(revoked.status, 200, JSON.stringify(revoked.body))
    const escaped = await chain.client.request({ method: 'eth_sendRawTransaction', params: [lateJournal.serialized_transaction as `0x${string}`] })
    assert.equal(escaped.toLowerCase(), latePrepared.tx_hash)
    await chain.client.waitForTransactionReceipt({ hash: escaped, timeout: 5000 })
    let refunded = await buyerProcess(late)
    if (refunded.state === 'refund_pending') {
      const queued = await db.select().from(schema.settlement_transfers).where(eq(schema.settlement_transfers.trade_id, latePrepared.trade_id))
      assert.equal(queued.length, 1)
      for (const transfer of queued) await (await import('@/lib/external-settlement')).processSettlementTransfer(transfer.id, { waitMs: 5000 })
      refunded = await buyerProcess(late)
    }
    for (let attempt = 0; ['awaiting_confirmation', 'refund_pending'].includes(refunded.state) && attempt < 5; attempt++) { await new Promise(done => setTimeout(done, 200)); refunded = await buyerProcess(late) }
    assert.equal(refunded.state, 'refunded', JSON.stringify(refunded)); assert.equal(refunded.trade_id, latePrepared.trade_id); assert.equal(refunded.tx_hash, latePrepared.tx_hash)
    const [refundTrade] = await db.select().from(schema.trades).where(eq(schema.trades.id, latePrepared.trade_id)); assert.equal(refundTrade.status, 'cancelled'); assert.equal(refundTrade.payout_status, 'refunded')
    const refunds = await db.select().from(schema.settlement_transfers).where(eq(schema.settlement_transfers.trade_id, latePrepared.trade_id)); assert.equal(refunds.length, 1); assert.equal(refunds[0].kind, 'buyer_refund'); assert.equal(refunds[0].status, 'confirmed')
    const refundBalance = await chain.balance(account.address); assert.ok(refundBalance <= beforeLate)
    if (rail === 'evm') assert.equal(refundBalance, beforeLate)
    await inspectUse(late, latePrepared.trade_id)
    const recoveredCheckout = await api(late.buyer, 'GET', `${late.prefix}/${late.authorization.id}/checkout`); assert.equal(recoveredCheckout.body.trade.id, latePrepared.trade_id)
    // The last reservation remains deliberately unsent: current review closes after reserve RPCs.
    const race = await fixture(); let reads = 0
    function revokeAfterReserveReads<Args extends unknown[], Result>(snapshot: (...args: Args) => Promise<Result>) {
      return async (...args: Args) => {
        const value = await snapshot(...args)
        if (++reads === 2) await domain.revokeOrganizationListing(race.id, race.authorization.id, race.owner)
        return value
      }
    }
    const adapter = rail === 'mpp' ? (() => {
      const value = createBuyerTempoAdapter({ chainId: 4217, rpcUrl: chain.url, account })
      value.snapshot = revokeAfterReserveReads(value.snapshot)
      return value
    })() : (() => {
      const value = createBuyerEvmAdapter({ chainId: 1, rpcUrl: chain.url, account })
      value.snapshot = revokeAfterReserveReads(value.snapshot)
      return value
    })()
    const noSend = await runBuyerListingFunding({ approval: race.approval, apiKey: keyFor(race.buyer), stateDirectory: race.state, account, adapter })
    assert.equal(noSend.state, 'held_recover_existing_payment')
    assert.equal(await chain.client.request({ method: 'eth_getTransactionByHash', params: [noSend.tx_hash as `0x${string}`] }), null)
    await inspectUse(race, noSend.trade_id)
    console.info(JSON.stringify({ listing_economic_acceptance: 'passed', rail, original_checkout: prepared.trade_id, explicit_review: true,
      buyer_restart_boundaries: 4, provider_restart_boundaries: 2, original_late_refund: true, final_send_revocation: true, service_orders_fabricated: 0 }))
  } finally {
    beforeHook = null; afterHook = null; server.closeAllConnections(); await new Promise<void>(done => server.close(() => done()))
    db.$client.close(); await chain.stop(); await rm(directory, { recursive: true, force: true })
  }
}
