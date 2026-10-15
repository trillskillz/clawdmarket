import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile, access, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { createWalletClient, erc20Abi, http } from 'viem'
import { mainnet } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { createLocalTestSchema } from '../helpers/local-schema'
import { reviewedContractFixture } from '../helpers/reviewed-contract-fixture'
import { startDisposableWorkflowChain } from '../helpers/disposable-workflow-chain'
import { creditDepositMessage } from '@/lib/credit-proof'
import { ClawdMarketClient, ClawdMarketTransportError } from '../../sdk/typescript/src/index'

const enabled = Boolean(process.env.CLAWDMARKET_TEST_ANVIL_BINARY)
const payer = privateKeyToAccount(`0x${'18'.repeat(32)}`), treasuryKey = `0x${'99'.repeat(32)}` as const
let directory: string, db: typeof import('@/lib/db').db, schema: typeof import('@/lib/schema')
let chain: Awaited<ReturnType<typeof startDisposableWorkflowChain>>, wallet: ReturnType<typeof createWalletClient>
let fund: typeof import('@/app/api/organizations/[id]/contract-authorizations/[authorizationId]/fund/route'), jwt: typeof import('@/lib/auth').generateJWT
before(async () => {
  if (!enabled) return
  directory = await mkdtemp(join(tmpdir(), 'clawdmarket-workspace-test-contract-scoped-funding-'))
  Object.assign(process.env, { TURSO_DATABASE_URL: `file:${join(directory, 'funding.db')}`, TURSO_AUTH_TOKEN: '',
    JWT_SECRET: 'contract-funding-fixture-only', AGENT_API_KEY_PEPPER: 'contract-funding-fixture-only',
    WEBHOOK_SECRET_KEY: 'contract-funding-fixture-only', CHAT_ENCRYPTION_KEY: 'contract-funding-fixture-only',
    CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED: 'true', CLAWDMARKET_REVIEWED_CONTRACT_FUNDING_ENABLED: 'true' })
  for (const name of ['VERCEL', 'VERCEL_ENV', 'DEV_WALLET_ADDRESS', 'DEV_FEE_WALLET_ADDRESS', 'CLAWDMARKET_NEW_PAYMENTS_PAUSED']) delete process.env[name]
  chain = await startDisposableWorkflowChain(process.env.CLAWDMARKET_TEST_ANVIL_BINARY!, payer.address, treasuryKey, 8453)
  Object.assign(process.env, { TREASURY_ADDRESS: chain.treasury, EVM_SETTLEMENT_PRIVATE_KEY: treasuryKey,
    EVM_ACCEPTED_TOKENS: JSON.stringify([{ chainId: 8453, address: chain.token, symbol: 'USDC', decimals: 6, fixedUsdPrice: 1, confirmations: 1, rpcUrl: chain.url }]) })
  wallet = createWalletClient({ chain: { ...mainnet, id: 8453 }, transport: http(chain.url), account: payer })
  db = (await import('@/lib/db')).db; schema = await import('@/lib/schema'); await createLocalTestSchema(db.$client, schema)
  await db.$client.execute('PRAGMA journal_mode=WAL')
  for (const file of ['contract-original-submissions-v1', 'contract-exact-acceptance-v1', 'contract-original-credit-release-v1', 'contract-original-adjudication-v1', 'contract-original-funding-reference-v1']) {
    await db.$client.executeMultiple(await readFile(`migrations/2026-10-15-${file}.sql`, 'utf8'))
  }
  jwt = (await import('@/lib/auth')).generateJWT
  fund = await import('@/app/api/organizations/[id]/contract-authorizations/[authorizationId]/fund/route')
})
after(async () => { db?.$client.close(); if (chain) await chain.stop(); if (directory) await rm(directory, { recursive: true, force: true }) })
const token = (actor: string) => jwt({ userId: actor, email: `${actor}@test.invalid`, role: 'human' })
function request(path: string, actor: string, method = 'GET', body?: unknown, headers?: Record<string, string>) {
  return new NextRequest(`http://localhost${path}`, { method, headers: { Authorization: `Bearer ${token(actor)}`, 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}
async function depositCredit(buyer: string) {
  const credit = await import('@/lib/account-credit')
  const deposit = await credit.createDeposit(buyer, { amount_minor: 105, payer: payer.address, client_reference: crypto.randomUUID() })
  const [intent] = await db.select().from(schema.credit_deposits).where(eq(schema.credit_deposits.id, deposit.id))
  const latest = await chain.rpc('eth_getBlockByNumber', ['latest', false])
  await chain.rpc('evm_setNextBlockTimestamp', [Math.max(Math.floor(Date.now() / 1000) + 1, Math.floor(intent.created_at.getTime() / 1000) + 1, Number(BigInt(latest.timestamp)) + 1)])
  const hash = await wallet.writeContract({ account: payer, chain: { ...mainnet, id: 8453 }, address: chain.token, abi: erc20Abi, functionName: 'transfer', args: [chain.treasury, 1_050_000n] })
  await chain.client.waitForTransactionReceipt({ hash })
  await credit.confirmDeposit(buyer, { id: deposit.id, tx_hash: hash, signature: await payer.signMessage({ message: creditDepositMessage(deposit, hash) }) })
}
async function fixture(approved = true, ceiling = '2.10') {
  const f = await reviewedContractFixture({ db, schema }, true, true)
  await depositCredit(f.buyer)
  Object.assign(f.input, { max_daily: ceiling, max_monthly: ceiling, max_lifetime: ceiling })
  const proposal = await (await import('@/app/api/organizations/[id]/contract-authorizations/route')).POST(request(f.prefix, f.owner, 'POST', f.input), { params: Promise.resolve({ id: f.org }) })
  assert.equal(proposal.status, 201, JSON.stringify(await proposal.clone().json()))
  const a = (await proposal.json()).authorization
  if (approved) {
    const response = await (await import('@/app/api/organizations/[id]/contract-authorizations/[authorizationId]/approval/route')).POST(request(`${f.prefix}/${a.id}/approval`, f.reviewer, 'POST', {
      version: 1, client_reference: crypto.randomUUID(), authority_hash: a.authority_hash, approve: true }), { params: Promise.resolve({ id: f.org, authorizationId: a.id }) })
    assert.equal(response.status, 201, JSON.stringify(await response.clone().json()))
  }
  return { ...f, a, funding: { version: 1 as const, client_reference: crypto.randomUUID(), authority_hash: a.authority_hash },
    path: `${f.prefix}/${a.id}/fund`, context: { params: Promise.resolve({ id: f.org, authorizationId: a.id }) } }
}
async function post(f: Awaited<ReturnType<typeof fixture>>, actor = f.buyer, body: unknown = f.funding, headers?: Record<string, string>) {
  return fund.POST(request(f.path, actor, 'POST', body, headers), f.context)
}
async function unchanged(f: Awaited<ReturnType<typeof fixture>>) {
  assert.equal((await db.select().from(schema.contracts).where(eq(schema.contracts.id, f.original.contract.id)))[0].state, 'DRAFT')
  assert.equal((await db.select().from(schema.listings).where(eq(schema.listings.id, f.listing.id)))[0].status, 'active')
  for (const table of [schema.organization_contract_uses, schema.organization_contract_funding_requests, schema.organization_contract_attributions]) {
    assert.equal((await db.select().from(table).where(eq(table.contract_id, f.original.contract.id))).length, 0)
  }
  assert.equal((await (await import('@/lib/account-credit')).creditBalance(f.buyer)).available_minor, 105)
}
test('fresh scoped funding is separately closed by default while exact original buyer/reference funding commits once under current review and budget policy', { skip: !enabled }, async () => {
  const f = await fixture()
  delete process.env.CLAWDMARKET_REVIEWED_CONTRACT_FUNDING_ENABLED
  try { const response = await post(f); assert.equal(response.status, 503); assert.equal((await response.json()).code, 'ORGANIZATION_CONTRACT_FUNDING_DISABLED'); await unchanged(f) }
  finally { process.env.CLAWDMARKET_REVIEWED_CONTRACT_FUNDING_ENABLED = 'true' }
  for (const actor of [f.owner, f.reviewer, f.seller, f.other]) assert.equal((await post(f, actor)).status, 404)
  assert.equal((await post(f, f.buyer, f.funding, { Authorization: 'Bearer invalid', Cookie: `auth-token=${token(f.buyer)}` })).status, 403)
  const { createNamedAgentCredential } = await import('@/lib/agent-named-credentials')
  const read = await createNamedAgentCredential({ agentId: f.buyerAgent, name: 'Cannot fund', scopes: ['agent:read'], actorCredentialId: null })
  assert.equal(read.kind, 'created'); if (read.kind !== 'created') throw new Error('Read credential fixture failed')
  assert.equal((await post(f, f.buyer, f.funding, { Authorization: '', 'X-ClawdMarket-Agent-Key': read.api_key })).status, 401)
  const replies = await Promise.all([post(f), post(f)])
  assert.deepEqual(replies.map(r => r.status).sort(), [200, 201])
  const first = await replies[0].json(), second = await replies[1].json()
  assert.equal(first.funding.id, second.funding.id); assert.equal(first.funding.gross_minor, 105); assert.equal(first.funding.principal_minor, 100)
  assert.equal(first.funding.upfront_fee_minor, 5); assert.equal(first.funding.seller_receives, 'nonwithdrawable_account_credit')
  assert.equal(first.contract.id, f.original.contract.id); assert.equal(first.credit_remaining_principal_minor, 100)
  assert.equal((await (await import('@/lib/account-credit')).creditBalance(f.buyer)).available_minor, 0)
  assert.equal((await db.select().from(schema.organization_contract_funding_requests).where(eq(schema.organization_contract_funding_requests.contract_id, f.original.contract.id))).length, 1)
  const recovered = await fund.GET(request(`${f.path}?client_reference=${f.funding.client_reference}`, f.buyer, 'GET', undefined, { Authorization: '', 'X-ClawdMarket-Agent-Key': read.api_key }), f.context)
  assert.equal(recovered.status, 200); assert.equal(recovered.headers.get('Cache-Control'), 'private, no-store')
  assert.equal((await post(f, f.buyer, { ...f.funding, authority_hash: '0'.repeat(64) })).status, 409)
  const legacy = await (await import('@/app/api/contracts/[id]/route')).PATCH(request(`/api/contracts/${f.original.contract.id}`, f.buyer, 'PATCH', { action: 'fund' }), { params: Promise.resolve({ id: f.original.contract.id }) })
  assert.equal(legacy.status, 409, 'generic funding remains excluded')
})

test('fresh review, credit rail, department and buyer ceilings fail before any original obligation is committed', { skip: !enabled }, async () => {
  for (const kind of ['pending', 'rail', 'department', 'buyer_cap', 'team_cap', 'database_pause']) {
    const f = await fixture(kind !== 'pending')
    if (kind === 'rail') await db.update(schema.seller_payment_preferences).set({ supported_rails: '["evm"]' }).where(eq(schema.seller_payment_preferences.seller_id, f.seller))
    if (kind === 'department') await db.update(schema.organization_agent_assignments).set({ cost_center: 'OTHER' }).where(eq(schema.organization_agent_assignments.agent_id, f.buyerAgent))
    if (kind === 'buyer_cap') await db.update(schema.buyer_spend_policies).set({ policy_json: '{"max_per_execution":104,"approval_required_above":50}' }).where(eq(schema.buyer_spend_policies.buyer_id, f.buyer))
    if (kind === 'team_cap') await (await import('@/lib/organization-team-budgets')).updateTeamBudget(f.org, f.team, f.owner, { expected_version: 0, max_per_execution: 104, max_daily: null, max_monthly: null })
    if (kind === 'database_pause') await (await import('@/lib/payment-control')).setNewPaymentControl({ paused: true, reason: 'disposable-test-only', actorUserId: f.owner })
    try { const response = await post(f); assert.equal(response.status, kind === 'database_pause' ? 503 : 409, `${kind}: ${JSON.stringify(await response.clone().json())}`); await unchanged(f) }
    finally { if (kind === 'database_pause') await (await import('@/lib/payment-control')).setNewPaymentControl({ paused: false, reason: 'disposable-test-only', actorUserId: f.owner }) }
  }
})

test('final funding-reference append failure rolls back credit, fee, attribution, original use, contract and inventory together', { skip: !enabled }, async () => {
  const f = await fixture()
  await db.$client.execute("CREATE TRIGGER injected_contract_funding_append BEFORE INSERT ON organization_contract_funding_requests BEGIN SELECT RAISE(ABORT, 'injected_contract_funding_append'); END")
  try { assert.equal((await post(f)).status, 503); await unchanged(f) }
  finally { await db.$client.execute('DROP TRIGGER injected_contract_funding_append') }
  assert.equal((await db.select().from(schema.credit_entries).where(eq(schema.credit_entries.reference, f.original.contract.id))).length, 0)
  assert.equal((await post(f)).status, 201)
})

async function completePublicWork(f: Awaited<ReturnType<typeof fixture>>) {
  const root = await import('@/app/api/contracts/[id]/route'), output = await import('@/app/api/contracts/[id]/milestones/[milestoneId]/submissions/route'), milestone = await import('@/app/api/contracts/[id]/milestones/[milestoneId]/route'), release = await import('@/app/api/contracts/[id]/milestones/[milestoneId]/release/route')
  const originalWork = await milestone.GET(request(`/api/contracts/${f.original.contract.id}/milestones/${f.original.milestones[0].id}`, f.seller),
    { params: Promise.resolve({ id: f.original.contract.id, milestoneId: f.original.milestones[0].id }) })
  assert.equal(originalWork.status, 200)
  const disclosed = (await originalWork.json()).settlement_terms
  assert.deepEqual(disclosed, { rail: 'credit', redeemable: false, seller_receives: 'nonwithdrawable_account_credit', upfront_fee_minor: 5, refundable_principal_minor: 100 })
  assert.equal((await root.PATCH(request(`/api/contracts/${f.original.contract.id}`, f.seller, 'PATCH', { action: 'start' }), { params: Promise.resolve({ id: f.original.contract.id }) })).status, 200)
  for (const m of f.original.milestones) {
    const path = `/api/contracts/${f.original.contract.id}/milestones/${m.id}`, context = { params: Promise.resolve({ id: f.original.contract.id, milestoneId: m.id }) }
    const work = await output.POST(request(`${path}/submissions`, f.seller, 'POST', { version: 1, client_reference: crypto.randomUUID(), artifact_bundle: { report: 'ACTUAL_PRIVATE_DELIVERY_CONTENT' } }), context)
    assert.equal(work.status, 201); const body = await work.json()
    const acceptance = await milestone.PATCH(request(path, f.buyer, 'PATCH', { action: 'approve', version: 1, client_reference: crypto.randomUUID(),
      submission_id: body.submission.id, content_hash: body.submission.content_hash, approve: true }), context)
    assert.equal(acceptance.status, 201); const accepted = await acceptance.json()
    const paid = await release.POST(request(`${path}/release`, f.buyer, 'POST', { version: 1, client_reference: crypto.randomUUID(), acceptance_id: accepted.decision.id,
      submission_id: body.submission.id, content_hash: body.submission.content_hash }), context)
    assert.equal(paid.status, 201); assert.equal((await paid.json()).financial_posting_confirmed, true)
  }
}
test('both buyer SDKs recover actual lost committed scoped funding replies, finish public work and recover original funding after completion/closure', { skip: !enabled }, async () => {
  for (const language of ['typescript', 'python']) {
    const f = await fixture(), calls: Array<{ method: string; body: unknown }> = []; let committed: any
    const feesBefore = (await (await import('@/lib/account-credit')).creditBalance('system_marketplace_fees')).available_minor
    const server = createServer(async (incoming, outgoing) => {
      try {
        let body = ''; for await (const chunk of incoming) body += chunk
        calls.push({ method: incoming.method!, body: body ? JSON.parse(body) : null })
        const req = new NextRequest(`http://localhost${incoming.url}`, { method: incoming.method, headers: { Authorization: incoming.headers.authorization!, 'Content-Type': 'application/json' }, ...(incoming.method === 'POST' ? { body } : {}) })
        const response = await (incoming.method === 'POST' ? fund.POST(req, f.context) : fund.GET(req, f.context)), result = await response.json()
        if (!committed && incoming.method === 'POST') {
          assert.equal(response.status, 201); committed = result
          const revoked = await (await import('@/app/api/organizations/[id]/contract-authorizations/[authorizationId]/route')).DELETE(request(`${f.prefix}/${f.a.id}`, f.owner, 'DELETE'), f.context)
          assert.equal(revoked.status, 200)
          process.env.CLAWDMARKET_REVIEWED_CONTRACT_FUNDING_ENABLED = 'false'; process.env.CLAWDMARKET_NEW_PAYMENTS_PAUSED = 'true'
          await db.update(schema.organizations).set({ owner_account_id: f.other }).where(eq(schema.organizations.id, f.org))
          await db.update(schema.seller_payment_preferences).set({ supported_rails: '[]' }).where(eq(schema.seller_payment_preferences.seller_id, f.seller))
          outgoing.destroy()
        } else { outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(JSON.stringify(result)) }
      } catch (error) { outgoing.statusCode = 500; outgoing.end(JSON.stringify({ error: String(error) })) }
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`, client = new ClawdMarketClient({ apiKey: token(f.buyer), baseUrl: base })
      let result: any
      if (language === 'typescript') {
        await assert.rejects(client.fundOriginalOrganizationContract(f.org, f.a.id, f.funding), ClawdMarketTransportError); assert.equal(calls.length, 1)
        result = { recovered: await client.recoverOriginalOrganizationContractFunding(f.org, f.a.id, f.funding.client_reference), replay: await client.fundOriginalOrganizationContract(f.org, f.a.id, f.funding) }
      } else {
        const source = `import os,json
from clawdmarket import ClawdMarketClient,ClawdMarketTransportError
f=json.loads(os.environ['CLAWDMARKET_LOCAL_FUNDING_FIXTURE']);c=ClawdMarketClient(f['token'],base_url=f['base'])
try:
    c.fund_original_organization_contract(f['org'],f['authorization'],f['body'])
except ClawdMarketTransportError:
    pass
else:
    raise AssertionError('Expected lost committed funding reply')
r=c.recover_original_organization_contract_funding(f['org'],f['authorization'],f['body']['client_reference'])
p=c.fund_original_organization_contract(f['org'],f['authorization'],f['body'])
print(json.dumps({'recovered':r,'replay':p}))`
        const processResult = await promisify(execFile)('python3', ['-c', source], { env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONPATH: 'sdk/python',
          CLAWDMARKET_LOCAL_FUNDING_FIXTURE: JSON.stringify({ token: token(f.buyer), base, org: f.org, authorization: f.a.id, body: f.funding }) }, timeout: 30000 })
        result = JSON.parse(processResult.stdout)
      }
      assert.deepEqual(calls.map(c => c.method), ['POST', 'GET', 'POST']); assert.deepEqual(calls[0].body, f.funding); assert.deepEqual(calls[2].body, f.funding)
      assert.deepEqual(result.recovered.funding, committed.funding); assert.deepEqual(result.replay.funding, committed.funding)
      assert.equal(result.replay.idempotent, true); assert.equal(result.replay.credit_remaining_principal_minor, 100)
      await completePublicWork(f)
      const final = await client.recoverOriginalOrganizationContractFunding(f.org, f.a.id, f.funding.client_reference)
      assert.equal(final.funding.id, committed.funding.id); assert.equal(final.contract.state, 'COMPLETED'); assert.equal(final.credit_remaining_principal_minor, 0)
      assert.equal(JSON.stringify(final).includes('ACTUAL_PRIVATE_DELIVERY_CONTENT'), false)
      assert.equal((await client.fundOriginalOrganizationContract(f.org, f.a.id, f.funding)).idempotent, true)
      const credit = await import('@/lib/account-credit')
      assert.equal((await credit.creditBalance(f.buyer)).available_minor, 0); assert.equal((await credit.creditBalance(f.buyer)).escrow_minor, 0)
      assert.equal((await credit.creditBalance(f.seller)).available_minor, 100)
      assert.equal((await credit.creditBalance('system_marketplace_fees')).available_minor, feesBefore + 5)
      assert.equal((await (await import('@/lib/organization-contract-uses')).organizationContractExposure(db, f.org, f.buyer)).lifetime, 105)
      assert.equal((await db.select().from(schema.trades)).length, 0, 'original contract identity is retained')
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); process.env.CLAWDMARKET_REVIEWED_CONTRACT_FUNDING_ENABLED = 'true'; delete process.env.CLAWDMARKET_NEW_PAYMENTS_PAUSED }
  }
})

async function additional(f: Awaited<ReturnType<typeof fixture>>, sameReference = false) {
  await depositCredit(f.buyer)
  const [listing] = await db.insert(schema.listings).values({ seller_id: f.seller, category: 'code', title: 'Second original inventory', description: 'Separate controlled agreement', price_bankr: 1, status: 'active' }).returning()
  const response = await (await import('@/app/api/contracts/route')).POST(request('/api/contracts', f.buyer, 'POST', {
    client_reference: crypto.randomUUID(), listing_id: listing.id, milestones: [
      { title: 'Second agreement first report', amount: .4, acceptance_spec: { required_artifacts: ['report'] } }, { title: 'Second agreement last report', amount: .6 },
    ] }))
  assert.equal(response.status, 201); const original = await response.json()
  const input = { ...f.input, client_reference: crypto.randomUUID(), contract_id: original.contract.id }
  const proposed = await (await import('@/app/api/organizations/[id]/contract-authorizations/route')).POST(request(f.prefix, f.owner, 'POST', input), { params: Promise.resolve({ id: f.org }) })
  assert.equal(proposed.status, 201); const a = (await proposed.json()).authorization
  const approved = await (await import('@/app/api/organizations/[id]/contract-authorizations/[authorizationId]/approval/route')).POST(request(`${f.prefix}/${a.id}/approval`, f.reviewer, 'POST', {
    version: 1, client_reference: crypto.randomUUID(), authority_hash: a.authority_hash, approve: true }), { params: Promise.resolve({ id: f.org, authorizationId: a.id }) })
  assert.equal(approved.status, 201)
  return { ...f, listing, original, a, input, funding: { version: 1 as const, client_reference: sameReference ? f.funding.client_reference : crypto.randomUUID(), authority_hash: a.authority_hash },
    path: `${f.prefix}/${a.id}/fund`, context: { params: Promise.resolve({ id: f.org, authorizationId: a.id }) } }
}
function processFund(f: Awaited<ReturnType<typeof fixture>>, barrier: string, boundary?: 'before' | 'after') {
  const command = { org: f.org, authorization: f.a.id, buyer: f.buyer, contractId: f.original.contract.id, body: f.funding, barrier, boundary }
  const child = spawn(process.execPath, ['--conditions=react-server', '--import', 'tsx', 'tests/helpers/contract-scoped-funding-process.ts', JSON.stringify(command)], {
    cwd: process.cwd(), env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = '', errors = ''; child.stdout!.on('data', data => output += data); child.stderr!.on('data', data => errors += data)
  const result = new Promise<{ status: number; body: any }>((resolve, reject) => {
    child.on('error', reject); child.on('exit', (code, signal) => {
      if (code !== 0 || signal) reject(new Error(`Funding child ${signal ?? code}: ${errors}`))
      else { try { resolve(JSON.parse(output)) } catch (error) { reject(error) } }
    })
  })
  void result.catch(() => {})
  return { child, result, errors: () => errors }
}
async function waitFor(path: string, worker: ReturnType<typeof processFund>) {
  const deadline = Date.now() + 25000
  while (true) {
    try { await access(path); return } catch {
      assert.equal(worker.child.exitCode, null, worker.errors())
      assert.ok(Date.now() < deadline, `Funding process barrier missing: ${worker.errors()}`)
      await new Promise(resolve => setTimeout(resolve, 15))
    }
  }
}
async function releaseProcesses(workers: Array<ReturnType<typeof processFund>>, barriers: string[]) {
  await Promise.all(workers.map((worker, i) => waitFor(`${barriers[i]}.ready`, worker)))
  await Promise.all(barriers.map(path => writeFile(`${path}.go`, '')))
}
for (const mode of ['same', 'conflicting_reference', 'shared_budget'] as const) test(`separate actual fund processes preserve ${mode} original authority and one financial reservation`, { skip: !enabled }, async () => {
  const f = await fixture(true, mode === 'shared_budget' ? '1.05' : '2.10')
  const second = mode === 'same' ? f : await additional(f, mode === 'conflicting_reference')
  const barriers = [join(directory, crypto.randomUUID()), join(directory, crypto.randomUUID())]
  const workers = [processFund(f, barriers[0]), processFund(second, barriers[1])]
  try {
    await releaseProcesses(workers, barriers)
    const replies = await Promise.all(workers.map(w => w.result))
    assert.deepEqual(replies.map(r => r.status).sort(), mode === 'same' ? [200, 201] : [201, 409], JSON.stringify(replies))
    const accepted = replies.find(r => r.status === 201)!, refused = replies.find(r => r.status === 409)
    if (mode === 'same') assert.equal(replies[0].body.funding.id, replies[1].body.funding.id)
    if (mode === 'conflicting_reference') assert.equal(refused!.body.code, 'CONTRACT_FUND_REFERENCE_CONFLICT')
    if (mode === 'shared_budget') assert.match(refused!.body.code, /ORGANIZATION_CONTRACT_(DAILY|MONTHLY|LIFETIME)_EXPOSURE/)
    const credit = await import('@/lib/account-credit')
    assert.equal((await credit.creditBalance(f.buyer)).available_minor, mode === 'same' ? 0 : 105)
    assert.equal((await credit.creditBalance(f.buyer)).escrow_minor, 100)
    assert.equal((await db.select().from(schema.organization_contract_uses).where(eq(schema.organization_contract_uses.contract_id, accepted.body.contract.id))).length, 1)
    if (mode !== 'same') {
      const loser = accepted.body.contract.id === f.original.contract.id ? second : f
      assert.equal((await db.select().from(schema.contracts).where(eq(schema.contracts.id, loser.original.contract.id)))[0].state, 'DRAFT')
      assert.equal((await db.select().from(schema.listings).where(eq(schema.listings.id, loser.listing.id)))[0].status, 'active')
      assert.equal((await db.select().from(schema.credit_entries).where(eq(schema.credit_entries.reference, loser.original.contract.id))).length, 0)
      if (mode === 'shared_budget') {
        const cancel = await (await import('@/app/api/contracts/[id]/route')).PATCH(request(`/api/contracts/${accepted.body.contract.id}`, f.buyer, 'PATCH', { action: 'cancel' }), { params: Promise.resolve({ id: accepted.body.contract.id }) })
        assert.equal(cancel.status, 200)
        const retry = await post(loser); assert.equal(retry.status, 409); assert.match((await retry.json()).code, /EXPOSURE/)
        assert.equal((await credit.creditBalance(f.buyer)).available_minor, 205, 'principal refund retains the original fee and cannot replenish reviewed gross')
      }
    }
  } finally { for (const worker of workers) if (worker.child.exitCode === null && worker.child.signalCode === null) worker.child.kill('SIGKILL') }
})
for (const boundary of ['before', 'after'] as const) test(`actual ${boundary}-commit funding SIGKILL preserves original inventory, credit and request recovery`, { skip: !enabled }, async () => {
  const f = await fixture(), marker = join(directory, crypto.randomUUID()), worker = processFund(f, marker, boundary)
  const exited = new Promise<void>(resolve => worker.child.once('exit', () => resolve()))
  try {
    await releaseProcesses([worker], [marker]); await waitFor(`${marker}.boundary`, worker)
    const staged = JSON.parse(await readFile(`${marker}.boundary`, 'utf8'))
    worker.child.kill('SIGKILL'); await exited; assert.equal(worker.child.signalCode, 'SIGKILL')
    if (boundary === 'before') await unchanged(f)
    else {
      const row = (await db.select().from(schema.organization_contract_funding_requests).where(eq(schema.organization_contract_funding_requests.contract_id, f.original.contract.id)))[0]
      assert.equal(row.id, staged.id)
      const revoked = await (await import('@/app/api/organizations/[id]/contract-authorizations/[authorizationId]/route')).DELETE(request(`${f.prefix}/${f.a.id}`, f.owner, 'DELETE'), f.context)
      assert.equal(revoked.status, 200)
      process.env.CLAWDMARKET_REVIEWED_CONTRACT_FUNDING_ENABLED = 'false'; process.env.CLAWDMARKET_NEW_PAYMENTS_PAUSED = 'true'
    }
    const nextMarker = join(directory, crypto.randomUUID()), restarted = processFund(f, nextMarker)
    try {
      await releaseProcesses([restarted], [nextMarker]); const recovered = await restarted.result
      assert.equal(recovered.status, boundary === 'before' ? 201 : 200)
      assert.equal(recovered.body.contract.id, f.original.contract.id)
      assert.deepEqual(recovered.body.milestones.map((m: any) => m.id), f.original.milestones.map((m: any) => m.id))
      assert.equal(recovered.body.credit_remaining_principal_minor, 100)
      if (boundary === 'after') assert.equal(recovered.body.funding.id, staged.id)
      assert.equal((await db.select().from(schema.organization_contract_funding_requests).where(eq(schema.organization_contract_funding_requests.contract_id, f.original.contract.id))).length, 1)
      const cancelled = await (await import('@/app/api/contracts/[id]/route')).PATCH(request(`/api/contracts/${f.original.contract.id}`, f.buyer, 'PATCH', { action: 'cancel' }), { params: Promise.resolve({ id: f.original.contract.id }) })
      assert.equal(cancelled.status, 200)
      const original = await fund.GET(request(`${f.path}?client_reference=${f.funding.client_reference}`, f.buyer), f.context)
      assert.equal(original.status, 200); assert.equal((await original.json()).credit_remaining_principal_minor, 0)
      assert.equal((await (await import('@/lib/account-credit')).creditBalance(f.buyer)).available_minor, 100)
      assert.equal((await (await import('@/lib/listing-visibility')).originalReviewedContractListing(f.listing.id)), true)
    } finally { if (restarted.child.exitCode === null && restarted.child.signalCode === null) restarted.child.kill('SIGKILL') }
  } finally {
    if (worker.child.exitCode === null && worker.child.signalCode === null) worker.child.kill('SIGKILL')
    await exited; process.env.CLAWDMARKET_REVIEWED_CONTRACT_FUNDING_ENABLED = 'true'; delete process.env.CLAWDMARKET_NEW_PAYMENTS_PAUSED
  }
})

test('finite buyer and seller CLI journals recover actual committed fund/output/accept/release after SIGKILL without repeating writes or leaking private output', { skip: !enabled }, async () => {
  const f = await fixture(), credit = await import('@/lib/account-credit')
  const feesBefore = (await credit.creditBalance('system_marketplace_fees')).available_minor
  const root = await import('@/app/api/contracts/[id]/route'), work = await import('@/app/api/contracts/[id]/milestones/[milestoneId]/route')
  const output = await import('@/app/api/contracts/[id]/milestones/[milestoneId]/submissions/route'), release = await import('@/app/api/contracts/[id]/milestones/[milestoneId]/release/route')
  let committed: (value: any) => void = () => {}, dropAction = '', writes = 0
  const server = createServer(async (incoming, outgoing) => {
    try {
      let body = ''; for await (const chunk of incoming) body += chunk
      const req = new NextRequest(`http://localhost${incoming.url}`, { method: incoming.method,
        headers: { Authorization: incoming.headers.authorization!, 'Content-Type': 'application/json' }, ...(body ? { body } : {}) })
      let response: Response, action = ''
      if (req.nextUrl.pathname === f.path) { response = await (incoming.method === 'POST' ? fund.POST(req, f.context) : fund.GET(req, f.context)); action = 'fund' }
      else if (req.nextUrl.pathname === `/api/contracts/${f.original.contract.id}`) response = await root.GET(req, { params: Promise.resolve({ id: f.original.contract.id }) })
      else {
        const parts = req.nextUrl.pathname.split('/'), context = { params: Promise.resolve({ id: parts[3], milestoneId: parts[5] }) }
        if (incoming.method === 'GET') response = await work.GET(req, context)
        else if (parts[6] === 'submissions') { response = await output.POST(req, context); action = 'submit' }
        else if (parts[6] === 'release') { response = await release.POST(req, context); action = 'release' }
        else { response = await work.PATCH(req, context); action = 'accept' }
      }
      const result = await response.json()
      if (incoming.method !== 'GET') writes++
      if (incoming.method !== 'GET' && dropAction === action && response.status === 201) {
        dropAction = ''; committed(result); return // Leave the actual committed reply unacknowledged until its worker is killed.
      }
      outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(JSON.stringify(result))
    } catch (error) { outgoing.statusCode = 500; outgoing.end(JSON.stringify({ error: String(error) })) }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const buyerState = join(directory, `buyer-${crypto.randomUUID()}`), sellerState = join(directory, `seller-${crypto.randomUUID()}`)
  const common = { version: 1, origin: base, buyer_id: f.buyer, seller_id: f.seller, contract_id: f.original.contract.id, credit_terms_acknowledged: true }
  const launch = (path: string, action: string) => {
    const child = spawn(process.execPath, ['scripts/contract-command-worker.mjs', '--command', path, '--state-dir', action === 'submit' ? sellerState : buyerState], {
      env: { ...process.env, CLAWDMARKET_BUYER_API_KEY: token(f.buyer), CLAWDMARKET_PROVIDER_API_KEY: token(f.seller) }, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = '', stderr = ''; child.stdout.on('data', bytes => stdout += bytes); child.stderr.on('data', bytes => stderr += bytes)
    const result = new Promise<any>((resolve, reject) => {
      child.on('error', reject); child.on('exit', (code, signal) => {
        if (code || signal) reject(new Error(`${signal ?? code}: ${stderr}`)); else { try { resolve(JSON.parse(stdout)) } catch (error) { reject(error) } }
      })
    })
    void result.catch(() => {})
    return { child, result, stdout: () => stdout }
  }
  const command = async (plan: Record<string, any>, kill = true) => {
    const path = join(directory, `command-${crypto.randomUUID()}.json`)
    await writeFile(path, JSON.stringify(plan), { mode: 0o600 })
    const written = writes
    let killed: ReturnType<typeof launch> | undefined
    try {
      if (kill) {
        let timer: ReturnType<typeof setTimeout>
        const observed = new Promise<any>((resolve, reject) => { committed = resolve; timer = setTimeout(() => reject(new Error('CLI never reached original committed write')), 20000) })
        dropAction = plan.action; killed = launch(path, plan.action)
        let original: any
        try { original = await Promise.race([observed, killed.result.then(() => { throw new Error('Expected actual lost committed reply') })]) } finally { clearTimeout(timer!) }
        assert.ok(original); killed.child.kill('SIGKILL'); await assert.rejects(killed.result, /SIGKILL/)
        assert.equal(killed.stdout(), '')
      }
      const restart = launch(path, plan.action)
      const result = await restart.result
      assert.equal(result.state, 'recorded'); assert.equal(result.action, plan.action)
      assert.equal(writes, written + 1, 'restart recovers by original reference without another financial/output/decision POST')
      assert.equal(JSON.stringify(result).includes('PRIVATE_WORKER_OUTPUT'), false)
      const replay = await launch(path, plan.action).result
      assert.deepEqual(replay.receipt, result.receipt); assert.equal(writes, written + 1)
      return result
    } finally { if (killed && killed.child.exitCode === null && killed.child.signalCode === null) killed.child.kill('SIGKILL') }
  }
  try {
    const funding = await command({ ...common, action: 'fund', actor_id: f.buyer, organization_id: f.org, authorization_id: f.a.id,
      gross_minor: 105, principal_minor: 100, upfront_fee_minor: 5, milestone_ids: f.original.milestones.map((m: any) => m.id), body: f.funding })
    assert.equal(funding.receipt.gross_minor, 105)
    const revoked = await (await import('@/app/api/organizations/[id]/contract-authorizations/[authorizationId]/route')).DELETE(request(`${f.prefix}/${f.a.id}`, f.owner, 'DELETE'), f.context)
    assert.equal(revoked.status, 200)
    process.env.CLAWDMARKET_REVIEWED_CONTRACT_FUNDING_ENABLED = 'false'; process.env.CLAWDMARKET_NEW_PAYMENTS_PAUSED = 'true'
    assert.equal((await root.PATCH(request(`/api/contracts/${f.original.contract.id}`, f.seller, 'PATCH', { action: 'start' }), { params: Promise.resolve({ id: f.original.contract.id }) })).status, 200)
    for (const [index, m] of f.original.milestones.entries()) {
      const scope = { ...common, milestone_id: m.id }
      const submitted = await command({ ...scope, action: 'submit', actor_id: f.seller, body: { version: 1, client_reference: crypto.randomUUID(), artifact_bundle: { report: `PRIVATE_WORKER_OUTPUT_${index}` } } })
      assert.equal(submitted.receipt.authorizes_payment, false)
      const accepted = await command({ ...scope, action: 'accept', actor_id: f.buyer, body: { version: 1, client_reference: crypto.randomUUID(), submission_id: submitted.receipt.id, content_hash: submitted.receipt.content_hash, approve: true } })
      assert.equal(accepted.receipt.financial_release_performed, false)
      assert.equal((await credit.creditBalance(f.seller)).available_minor, index === 0 ? 0 : 40, 'explicit acceptance alone never releases funds')
      const paid = await command({ ...scope, action: 'release', actor_id: f.buyer, body: { version: 1, client_reference: crypto.randomUUID(), acceptance_id: accepted.receipt.id, submission_id: submitted.receipt.id, content_hash: submitted.receipt.content_hash } })
      assert.equal(paid.receipt.financial_posting_confirmed, true)
    }
    assert.equal((await credit.creditBalance(f.buyer)).available_minor, 0); assert.equal((await credit.creditBalance(f.buyer)).escrow_minor, 0)
    assert.equal((await credit.creditBalance(f.seller)).available_minor, 100)
    assert.equal((await credit.creditBalance('system_marketplace_fees')).available_minor, feesBefore + 5)
    assert.equal((await db.select().from(schema.contracts).where(eq(schema.contracts.id, f.original.contract.id)))[0].state, 'COMPLETED')
    for (const state of [buyerState, sellerState]) for (const file of (await readdir(state)).filter(f => f.endsWith('.json'))) {
      const text = await readFile(join(state, file), 'utf8'), journal = JSON.parse(text)
      assert.equal(journal.phase, 'recorded'); assert.equal(text.includes(token(f.buyer)), false); assert.equal(text.includes(token(f.seller)), false)
    }
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
    process.env.CLAWDMARKET_REVIEWED_CONTRACT_FUNDING_ENABLED = 'true'; delete process.env.CLAWDMARKET_NEW_PAYMENTS_PAUSED
  }
})
