import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { createWalletClient, erc20Abi, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { createLocalTestSchema } from '../helpers/local-schema'
import { startDisposableWorkflowChain } from '../helpers/disposable-workflow-chain'
import { creditDepositMessage } from '@/lib/credit-proof'

let directory: string, baseUrl: string, db: typeof import('@/lib/db').db, schema: typeof import('@/lib/schema'), jwt: typeof import('@/lib/auth').generateJWT
let domain: typeof import('@/lib/organization-purchasing')
const server = createServer()
const payer = privateKeyToAccount(`0x${'18'.repeat(32)}`), treasuryKey = `0x${'97'.repeat(32)}` as const
let chain: Awaited<ReturnType<typeof startDisposableWorkflowChain>> | undefined
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'clawdmarket-workspace-test-purchasing-'))
  Object.assign(process.env, { TURSO_DATABASE_URL: `file:${join(directory, 'purchasing.db')}`, TURSO_AUTH_TOKEN: '', JWT_SECRET: 'purchasing-tests-only-secret',
    CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED: 'true', CLAWDMARKET_REUSABLE_SERVICES_ENABLED: 'true', CLAWDMARKET_ACCOUNT_CREDIT_ENABLED: 'true',
    EVM_SETTLEMENT_PRIVATE_KEY: treasuryKey, TREASURY_ADDRESS: privateKeyToAccount(treasuryKey).address })
  if (process.env.CLAWDMARKET_TEST_ANVIL_BINARY) chain = await startDisposableWorkflowChain(process.env.CLAWDMARKET_TEST_ANVIL_BINARY, payer.address, treasuryKey, 8453)
  process.env.EVM_ACCEPTED_TOKENS = JSON.stringify([{ chainId: 8453, chainName: 'Disposable purchasing chain',
    address: chain?.token || `0x${'44'.repeat(20)}`, symbol: 'USDC', decimals: 6, fixedUsdPrice: 1, confirmations: 1, rpcUrl: chain?.url || 'https://example.invalid' }])
  db = (await import('@/lib/db')).db; schema = await import('@/lib/schema'); await createLocalTestSchema(db.$client, schema)
  jwt = (await import('@/lib/auth')).generateJWT; domain = await import('@/lib/organization-purchasing')
  const roleApi = await import('@/app/api/organizations/[id]/purchasing/roles/route')
  const requestApi = await import('@/app/api/organizations/[id]/purchasing/requests/route')
  const inspectApi = await import('@/app/api/organizations/[id]/purchasing/requests/[requestId]/route')
  const approvalApi = await import('@/app/api/organizations/[id]/purchasing/requests/[requestId]/approval/route')
  const orderApi = await import('@/app/api/services/[id]/orders/route')
  const depositsApi = await import('@/app/api/wallet/deposits/route')
  const workApi = await import('@/app/api/trades/[id]/work-order/route')
  const attemptApi = await import('@/app/api/trades/[id]/work-order/attempt/route')
  const deliverApi = await import('@/app/api/trades/[id]/delivery/route')
  const confirmApi = await import('@/app/api/trades/[id]/confirm/route')
  const intentApi = await import('@/app/api/trades/[id]/fund/evm/intent/route')
  const fundingApi = await import('@/app/api/trades/[id]/fund/evm/route')
  server.on('request', async (incoming, outgoing) => {
    try {
      const chunks = []; for await (const chunk of incoming) chunks.push(chunk)
      const body = Buffer.concat(chunks).toString(), path = incoming.url!.split('?')[0], parts = path.split('/')
      const request = new NextRequest(baseUrl + path, { method: incoming.method, headers: incoming.headers as Record<string, string>, ...(body ? { body } : {}) })
      let response: Response
      if (path.includes('/purchasing/')) {
        const params = { params: Promise.resolve({ id: parts[3], requestId: parts[6] }) }
        if (path.endsWith('/roles')) response = await roleApi[incoming.method as 'GET' | 'POST' | 'DELETE'](request, params)
        else if (path.endsWith('/approval')) response = await approvalApi[incoming.method as 'POST' | 'DELETE'](request, params)
        else if (parts[6]) response = await inspectApi[incoming.method as 'GET' | 'DELETE'](request, params)
        else response = await requestApi.POST(request, params)
      } else if (path.includes('/services/')) response = await orderApi.POST(request, { params: Promise.resolve({ id: parts[3] }) })
      else if (path === '/api/wallet/deposits') response = await depositsApi[incoming.method as 'POST' | 'PUT'](request)
      else {
        const params = { params: Promise.resolve({ id: parts[3] }) }
        response = path.endsWith('/fund/evm/intent') ? await intentApi.POST(request, params) : path.endsWith('/fund/evm') ? await fundingApi.POST(request, params) : path.endsWith('/attempt') ? await attemptApi.POST(request, params) : path.endsWith('/delivery') ? await deliverApi.POST(request, params)
          : path.endsWith('/confirm') ? await confirmApi.POST(request, params) : await workApi.GET(request, params)
      }
      outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(await response.text())
    } catch (error) { outgoing.writeHead(500); outgoing.end(JSON.stringify({ error: String(error) })) }
  })
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done)); baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
after(async () => { await new Promise<void>(done => server.close(() => done())); db?.$client.close(); await chain?.stop(); if (directory) await rm(directory, { recursive: true, force: true }) })
const token = (actor: string) => jwt({ userId: actor, email: `${actor}@test.invalid`, role: 'human' })
async function call(path: string, actor: string, method = 'GET', body?: unknown, key = false) {
  const response = await fetch(baseUrl + path, { method, headers: { 'Content-Type': 'application/json', ...(key ? { 'X-ClawdMarket-Agent-Key': actor } : { Authorization: `Bearer ${token(actor)}` }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  return { status: response.status, body: await response.json(), headers: response.headers }
}
async function fixture() {
  const id = crypto.randomUUID(), agent = crypto.randomUUID(), owner = `owner-${id}`, requester = `requester-${id}`, reviewer = `reviewer-${id}`,
    viewer = `viewer-${id}`, seller = `seller-${id}`, buyer = `user_agent_${agent}`, team = crypto.randomUUID(), otherTeam = crypto.randomUUID(), service = crypto.randomUUID()
  const now = new Date(), primary = `clawdmarket-test-${agent}`
  await db.insert(schema.users).values([owner, requester, reviewer, viewer, seller, buyer].map(id => ({ id, name: id, email: `${id}@test.invalid`, password_hash: 'unused' })))
  const { hashAgentApiKey } = await import('@/lib/registered-agent-auth')
  await db.insert(schema.agents).values({ id: agent, name: 'Purchasing buyer', description: 'Controlled organization purchasing buyer', capabilities: '["code-review"]',
    endpoint: 'https://example.invalid', owner_address: '', api_key: hashAgentApiKey(primary) })
  await db.insert(schema.agent_owners).values({ agentId: agent, userId: owner, establishedBy: 'test' })
  await db.insert(schema.organizations).values({ id, owner_account_id: owner, client_reference: id, name: 'Purchasing organization', created_at: now, updated_at: now })
  const organizationId = id
  await db.insert(schema.organization_teams).values([team, otherTeam].map((id, i) => ({ id, organization_id: organizationId, slug: `team-${i}`, name: `Department ${i}`, created_at: now, updated_at: now })))
  await db.insert(schema.organization_agent_assignments).values({ agent_id: agent, organization_id: id, team_id: team, cost_center: 'ENGINEERING', assigned_at: now, updated_at: now })
  const { createOrganizationInvitation, acceptOrganizationInvitation } = await import('@/lib/organization-membership')
  for (const account of [requester, reviewer, viewer]) {
    const invited = await createOrganizationInvitation(id, owner, account, crypto.randomUUID()); assert.equal(invited.kind, 'ok')
    if (invited.kind !== 'ok') throw Error('Invitation fixture failed')
    assert.equal((await acceptOrganizationInvitation(invited.invitation_id!, account)).kind, 'ok')
  }
  await db.insert(schema.payout_addresses).values({ user_id: seller, address: privateKeyToAccount(`0x${'19'.repeat(32)}`).address })
  await db.insert(schema.service_definitions).values({ id: service, seller_id: seller, title: 'Private approved review', description: 'Return a structured result from the approved private input.',
    capabilities: '["code-review"]', price_minor: 100, status: 'active', provider_protocol: 'leased_v1', estimated_latency_seconds: 30, max_concurrency: 3,
    output_schema: '{"type":"object","required":["result"],"properties":{"result":{"type":"string"}},"additionalProperties":false}',
    verification_policy: '{"required":true,"methods":["buyer_review","schema"],"acceptance":{"version":1,"mode":"explicit_buyer"}}' })
  await db.insert(schema.buyer_spend_policies).values({ buyer_id: buyer, owner_account_id: owner, policy_json: '{"approval_required_above":50,"max_per_execution":200}', version: 1, created_at: now, updated_at: now })
  const { createNamedAgentCredential } = await import('@/lib/agent-named-credentials')
  const named = await createNamedAgentCredential({ agentId: agent, name: 'Purchasing payment credential', scopes: ['agent:read', 'payments:write'], actorCredentialId: null })
  assert.equal(named.kind, 'created'); if (named.kind !== 'created') throw Error('Credential fixture failed')
  return { id, agent, owner, requester, reviewer, viewer, seller, buyer, team, otherTeam, service, key: named.api_key, prefix: `/api/organizations/${id}/purchasing` }
}
type Fixture = Awaited<ReturnType<typeof fixture>>
async function grant(f: Fixture, kind: 'requester' | 'approver', mutation = {}) {
  const input = { version: 1, client_reference: crypto.randomUUID(), account_id: kind === 'requester' ? f.requester : f.reviewer,
    team_id: f.team, role: kind, max_purchase: '1.05', expires_at: new Date(Date.now() + 3600_000).toISOString(), ...mutation }
  const response = await call(f.prefix + '/roles', f.owner, 'POST', input); assert.equal(response.status, 201, JSON.stringify(response.body))
  return { input, row: response.body.role }
}
async function quote(f: Fixture, mutation = {}) {
  const requester = await grant(f, 'requester'), reviewer = await grant(f, 'approver')
  const order = { client_reference: crypto.randomUUID(), objective: 'Review the exact private code input', input: { private_code: 'const result = 42' }, payment_rail: 'evm', max_total: '1.05', expected_price: '1.00' }
  const input = { version: 1, client_reference: crypto.randomUUID(), buyer_agent_id: f.agent, service_id: f.service,
    requester_role_id: requester.row.id, reviewer_role_id: reviewer.row.id, order, expires_at: new Date(Date.now() + 1800_000).toISOString(), ...mutation }
  const response = await call(f.prefix + '/requests', f.requester, 'POST', input); assert.equal(response.status, 201, JSON.stringify(response.body))
  return { input, row: response.body.request, requester, reviewer }
}
async function approved(f: Fixture, mutation = {}) {
  const q = await quote(f, mutation), path = f.prefix + '/requests/' + q.row.id
  const decision = { version: 1, client_reference: crypto.randomUUID(), request_hash: q.row.request_hash, approve: true,
    expires_at: new Date(Date.parse(q.input.expires_at) - 1000).toISOString() }
  const response = await call(path + '/approval', f.reviewer, 'POST', decision); assert.equal(response.status, 201, JSON.stringify(response.body))
  return { ...q, path, decision, approval: response.body.approval, checkout: { ...q.input.order, purchasing_approval_id: response.body.approval.id } }
}
async function buy(f: Fixture, body: unknown) { return call(`/api/services/${f.service}/orders`, f.key, 'POST', body, true) }
async function counts(f: Fixture) {
  const orders = await db.select().from(schema.service_orders).where(eq(schema.service_orders.buyer_id, f.buyer))
  const [service] = await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id, f.service))
  return { orders: orders.length, capacity: service.active_orders }
}

test('explicit roles and private requests preserve exact replay, reject ordinary viewers/read keys and enforce bounded input/CSRF', async () => {
  const f = await fixture(), g = await grant(f, 'requester')
  assert.equal((await call(f.prefix + '/roles', f.owner, 'POST', g.input)).status, 200)
  const changed = await call(f.prefix + '/roles', f.owner, 'POST', { ...g.input, max_purchase: '2.00' }); assert.equal(changed.body.error_code, 'PURCHASING_REFERENCE_CONFLICT')
  assert.equal((await call(f.prefix + '/roles', f.viewer, 'POST', g.input)).status, 404)
  const q = await quote(f), path = f.prefix + '/requests/' + q.row.id
  assert.equal((await call(path, f.viewer)).status, 404)
  const inspection = await call(path, f.reviewer); assert.equal(inspection.status, 200); assert.equal(inspection.headers.get('cache-control'), 'private, no-store')
  assert.equal((await call(f.prefix + '/requests', f.requester, 'POST', q.input)).status, 200)
  const { createOrganizationServiceAccount } = await import('@/lib/organization-service-accounts')
  const read = await createOrganizationServiceAccount(f.id, f.owner, { client_reference: crypto.randomUUID(), name: 'Read-only purchasing isolation', lifetime_days: 1 })
  assert.equal(read.kind, 'ok'); if (read.kind !== 'ok') throw Error('Key fixture failed')
  const response = await fetch(baseUrl + path, { headers: { Authorization: `Bearer ${read.api_key}` } }); assert.equal(response.status, 401)
  const cookie = await fetch(baseUrl + f.prefix + '/roles', { method: 'POST', headers: { Cookie: `auth-token=${token(f.owner)}`, 'Content-Type': 'application/json' }, body: JSON.stringify(g.input) }); assert.equal(cookie.status, 403)
  assert.equal((await call(f.prefix + '/roles', f.owner, 'POST', { ...g.input, padding: 'x'.repeat(17000) })).status, 413)
  assert.equal((await call(f.prefix + '/roles', f.owner, 'POST', { ...g.input, expires_at: new Date(Date.now() + 91 * 86400_000).toISOString(), client_reference: crypto.randomUUID() })).status, 400)
  assert.deepEqual(await counts(f), { orders: 0, capacity: 0 })
})

test('one exact approval clears only the threshold and cannot authorize copied input, rail, reference, organization or routed work', async () => {
  const f = await fixture(), a = await approved(f)
  const missing = await buy(f, a.input.order); assert.equal(missing.body.error_code, 'BUYER_APPROVAL_REQUIRED')
  for (const change of [{ input: {} }, { client_reference: crypto.randomUUID() }, { payment_rail: 'mpp' }, { objective: 'Change the approved purchase objective' }, { max_total: '2.00' }]) {
    const response = await buy(f, { ...a.checkout, ...change }); assert.equal(response.status, 409, JSON.stringify(response.body))
  }
  const other = await fixture(); assert.equal((await buy(other, a.checkout)).status, 404)
  const { checkBuyerPolicyConstraints } = await import('@/lib/buyer-spend-policy')
  assert.equal(checkBuyerPolicyConstraints({ approval_required_above: 1 }, { totalMinor: 105, sellerId: f.seller, paymentRail: 'evm',
    purchaseEvidence: { approvalId: a.approval.id, requestHash: a.row.request_hash, buyerId: f.buyer, totalMinor: 105, sellerId: f.seller, paymentRail: 'evm' } }), 'BUYER_APPROVAL_REQUIRED')
  const reserve = (await import('@/lib/service-order-reservation')).reserveServiceOrder
  await assert.rejects(() => reserve({ serviceId: f.service, routeId: crypto.randomUUID(), principal: { userId: f.buyer, agentId: f.agent, kind: 'registered-agent', usesCookieAuth: false }, request: { ...domain.purchaseRequestInput.parse(a.input).order, purchasing_approval_id: a.approval.id } }), /Approval is for a direct service order/)
  assert.deepEqual(await counts(f), { orders: 0, capacity: 0 })
})

test('role ceilings and selected independent reviewers reject cross-department, self-review and substituted decisions', async () => {
  const f = await fixture(), requester = await grant(f,'requester',{max_purchase:'1.04'}), reviewer = await grant(f,'approver')
  const input = { version:1,client_reference:crypto.randomUUID(),buyer_agent_id:f.agent,service_id:f.service,requester_role_id:requester.row.id,
    reviewer_role_id:reviewer.row.id,order:{client_reference:crypto.randomUUID(),objective:'Review the approved private code',input:{},payment_rail:'evm',max_total:'1.05'},expires_at:new Date(Date.now()+1800_000).toISOString() }
  assert.equal((await call(f.prefix+'/requests',f.requester,'POST',input)).body.error_code,'PURCHASING_ROLE_INVALID')
  const cross = await grant(f,'requester',{team_id:f.otherTeam})
  assert.equal((await call(f.prefix+'/requests',f.requester,'POST',{...input,requester_role_id:cross.row.id})).body.error_code,'PURCHASING_ROLE_INVALID')
  const ownReview = await grant(f,'approver',{account_id:f.requester})
  const valid = await grant(f,'requester')
  assert.equal((await call(f.prefix+'/requests',f.requester,'POST',{...input,requester_role_id:valid.row.id,reviewer_role_id:ownReview.row.id})).body.error_code,'PURCHASING_INDEPENDENT_REVIEWER_REQUIRED')
  assert.equal((await call(f.prefix+'/requests',f.viewer,'POST',{...input,requester_role_id:valid.row.id})).status,403)
  const q = await quote(f), path = f.prefix+'/requests/'+q.row.id+'/approval'
  const decision = {version:1,client_reference:crypto.randomUUID(),request_hash:q.row.request_hash,approve:true,expires_at:new Date(Date.parse(q.input.expires_at)-1000).toISOString()}
  assert.equal((await call(path,f.requester,'POST',decision)).status,403)
  assert.equal((await call(path,f.viewer,'POST',decision)).status,404)
  assert.equal((await call(path,f.reviewer,'POST',{...decision,request_hash:'0'.repeat(64)})).body.error_code,'PURCHASING_DECISION_MISMATCH')
  const saved = await call(path,f.reviewer,'POST',decision);assert.equal(saved.status,201)
  const changed = await call(path,f.reviewer,'POST',{...decision,client_reference:crypto.randomUUID()});assert.equal(changed.body.error_code,'PURCHASING_DECISION_CONFLICT')
  assert.equal((await call(f.prefix+'/roles',f.key,'GET',undefined,true)).status,401)
  assert.deepEqual(await counts(f),{orders:0,capacity:0})
})

test('approval cannot defeat deployment, buyer, department, provider, rail or verification ceilings', async () => {
  const f = await fixture(), a = await approved(f)
  const policies = [ ['BUYER_PER_EXECUTION_LIMIT', { max_per_execution: 104 }], ['BUYER_DAILY_LIMIT', { max_daily: 104 }],
    ['BUYER_MONTHLY_LIMIT', { max_monthly: 104 }], ['BUYER_PROVIDER_BLOCKED', { blocked_providers: [f.seller] }],
    ['BUYER_PAYMENT_RAIL_BLOCKED', { approved_payment_rails: ['credit'] }], ['BUYER_VERIFICATION_REQUIRED', { required_verification_methods: ['source_urls'] }],
    ['BUYER_CAPABILITY_BLOCKED', { blocked_capabilities: ['code-review'] }] ] as const
  for (const [code, policy] of policies) {
    await db.update(schema.buyer_spend_policies).set({ policy_json: JSON.stringify({ approval_required_above: 50, ...policy }) }).where(eq(schema.buyer_spend_policies.buyer_id, f.buyer))
    const response = await buy(f, a.checkout); assert.equal(response.body.error_code, code, JSON.stringify(response.body)); assert.deepEqual(await counts(f), { orders: 0, capacity: 0 })
  }
  await db.update(schema.buyer_spend_policies).set({ policy_json: '{"approval_required_above":50}' }).where(eq(schema.buyer_spend_policies.buyer_id, f.buyer))
  process.env.CLAWDMARKET_AGENT_MAX_TRADE_USD = '0.50'
  try { assert.equal((await buy(f, a.checkout)).body.error_code, 'AGENT_PER_TRADE_LIMIT') } finally { delete process.env.CLAWDMARKET_AGENT_MAX_TRADE_USD }
  const { updateTeamBudget } = await import('@/lib/organization-team-budgets')
  await updateTeamBudget(f.id, f.team, f.owner, { expected_version: 0, max_per_execution: 104, max_daily: null, max_monthly: null })
  assert.equal((await buy(f, a.checkout)).body.error_code, 'TEAM_PER_EXECUTION_LIMIT'); assert.deepEqual(await counts(f), { orders: 0, capacity: 0 })
})

test('revocation, member removal, owner transfer, assignment/quote drift, expiry and closed flags prevent fresh spending', async () => {
  const mutations: Array<(f: Fixture, a: Awaited<ReturnType<typeof approved>>) => Promise<void>> = [
    async (f,a) => { await domain.revokePurchasingRole(f.id, f.owner, a.requester.row.id) },
    async (f,a) => { await domain.revokePurchasingRole(f.id, f.owner, a.reviewer.row.id) },
    async (f,a) => { await domain.stopPurchase(f.id, a.row.id, f.reviewer, 'approval') },
    async (f,a) => { await domain.stopPurchase(f.id, a.row.id, f.requester, 'request') },
    async f => { await db.update(schema.organization_memberships).set({ status: 'revoked' }).where(eq(schema.organization_memberships.account_id, f.reviewer)) },
    async f => { await db.update(schema.organizations).set({ owner_account_id: f.viewer }).where(eq(schema.organizations.id, f.id)) },
    async f => { await db.update(schema.agent_owners).set({ userId: f.viewer }).where(eq(schema.agent_owners.agentId, f.agent)) },
    async f => { await db.update(schema.organization_agent_assignments).set({ team_id: f.otherTeam }).where(eq(schema.organization_agent_assignments.agent_id, f.agent)) },
    async f => { await db.update(schema.service_definitions).set({ price_minor: 99 }).where(eq(schema.service_definitions.id, f.service)) },
    async (f,a) => { await db.update(schema.organization_purchase_approvals).set({ expires_at: new Date(0) }).where(eq(schema.organization_purchase_approvals.id, a.approval.id)) },
  ]
  for (const mutation of mutations) { const f = await fixture(), a = await approved(f); await mutation(f,a); const response = await buy(f,a.checkout); assert.ok(response.status >= 400, JSON.stringify(response.body)); assert.deepEqual(await counts(f), { orders: 0, capacity: 0 }) }
  const f = await fixture(), a = await approved(f)
  process.env.CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED = 'false'
  try { assert.equal((await buy(f, a.checkout)).body.error_code, 'PURCHASING_DISABLED'); assert.equal((await call(a.path, f.owner)).status, 200) }
  finally { process.env.CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED = 'true' }
})

test('independent processes race exact approval and checkout and recover consumed original IDs after authority closes', async () => {
  const f = await fixture(), q = await quote(f), path = f.prefix + '/requests/' + q.row.id
  const decision = { version: 1, client_reference: crypto.randomUUID(), request_hash: q.row.request_hash, approve: true, expires_at: new Date(Date.parse(q.input.expires_at) - 1000).toISOString() }
  const run = promisify(execFile), code = `const [url, key, body] = process.argv.slice(1); const r = await fetch(url, {method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body}); console.log(JSON.stringify({status:r.status,body:await r.json()}));`
  const responsesSettled = await Promise.allSettled(Array.from({ length: 3 }, () => run(process.execPath, ['--input-type=module', '-e', code, baseUrl + path + '/approval', token(f.reviewer), JSON.stringify(decision)])))
  const responses = responsesSettled.map(r => { if (r.status !== 'fulfilled') throw r.reason; return r.value })
  const approvals = responses.map(r => JSON.parse(r.stdout)); assert.deepEqual(approvals.map(r => r.status).sort(), [200,200,201]); assert.equal(new Set(approvals.map(r => r.body.approval.id)).size, 1)
  const checkout = { ...q.input.order, purchasing_approval_id: approvals[0].body.approval.id }
  // Financial transactions execute in separate database clients/processes, not only parallel HTTP calls on the parent lock.
  const purchaseCode = `const {reserveServiceOrder}=await import('./lib/service-order-reservation.ts');const {serviceOrderInput}=await import('./lib/service-definitions.ts');const args=JSON.parse(process.argv[1]);args.request=serviceOrderInput.parse(args.request);try{const r=await reserveServiceOrder(args);console.log(JSON.stringify({order:r.order.id,trade:r.trade.id,idempotent:r.idempotent}));}finally{(await import('./lib/db.ts')).db.$client.close();}`
  const args = { serviceId: f.service, principal: { userId: f.buyer, agentId: f.agent, kind: 'registered-agent', usesCookieAuth: false }, request: checkout }
  const childrenSettled = await Promise.allSettled(Array.from({ length: 3 }, () => run(process.execPath, ['--conditions=react-server', '--import', 'tsx', '-e', `(async()=>{${purchaseCode}})().catch(e=>{console.error(e);process.exitCode=1})`, JSON.stringify(args)], { cwd: process.cwd(), env: process.env })))
  const children = childrenSettled.map(r => { if (r.status !== 'fulfilled') throw r.reason; return r.value })
  const orders = children.map(r => JSON.parse(r.stdout.trim())); assert.equal(new Set(orders.map(r => r.order)).size, 1); assert.equal(new Set(orders.map(r => r.trade)).size, 1)
  await domain.stopPurchase(f.id, q.row.id, f.owner, 'approval')
  process.env.CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED = 'false'
  try { const recovered = await buy(f, checkout); assert.equal(recovered.status,200); assert.equal(recovered.body.order.id,orders[0].order) }
  finally { process.env.CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED = 'true' }
  assert.deepEqual(await counts(f), { orders: 1, capacity: 1 })
})

test('SIGKILL before and after approval/order commits preserves atomic consumption and original references', async () => {
  for (const operation of ['approval', 'checkout'] as const) for (const boundary of ['before', 'after'] as const) {
    const f = await fixture(), q = await quote(f)
    const decision = { version: 1, client_reference: crypto.randomUUID(), request_hash: q.row.request_hash, approve: true,
      expires_at: new Date(Date.parse(q.input.expires_at) - 1000).toISOString() }
    let approvalId: string | undefined
    if (operation === 'checkout') approvalId = (await domain.approvePurchase(f.id, q.row.id, f.reviewer, domain.purchaseDecisionInput.parse(decision))).approval.id
    const marker = join(directory, `${operation}-${boundary}-${f.id}.marker`)
    const args = { f, requestId: q.row.id, decision, approvalId, order: { ...q.input.order, purchasing_approval_id: approvalId } }
    const code = `(async()=>{
      const {writeFile}=await import('node:fs/promises'); const args=JSON.parse(process.argv[1]);
      const stop=async()=>{await writeFile(process.argv[2],'boundary');await new Promise(()=>{});};
      ${boundary === 'before' ? "const {db}=await import('./lib/db.ts');const prototype=Object.getPrototypeOf(db.session); const original=prototype.transaction;prototype.transaction=function(fn,config){return original.call(this,async(tx)=>{const result=await fn(tx);await stop();return result;},config);};" : ''}
      const domain=await import('./lib/organization-purchasing.ts');
      ${operation === 'approval' ? "await domain.approvePurchase(args.f.id,args.requestId,args.f.reviewer,domain.purchaseDecisionInput.parse(args.decision));" : "const {reserveServiceOrder}=await import('./lib/service-order-reservation.ts');const {serviceOrderInput}=await import('./lib/service-definitions.ts');await reserveServiceOrder({serviceId:args.f.service,principal:{userId:args.f.buyer,agentId:args.f.agent,kind:'registered-agent',usesCookieAuth:false},request:serviceOrderInput.parse(args.order)});"}
      await stop();})().catch(e=>{console.error(e);process.exitCode=1})`
    const child = spawn(process.execPath, ['--conditions=react-server','--import','tsx','-e',code,JSON.stringify(args),marker], { cwd: process.cwd(), env: process.env, stdio: ['ignore','ignore','pipe'] })
    let errors = ''; child.stderr.on('data', chunk => { errors += chunk })
    const exited = new Promise<void>((done,reject) => { child.once('exit',()=>done()); child.once('error',reject) })
    try {
      let reached = false
      for (let wait = 0; wait < 150; wait++) {
        try { await readFile(marker); reached = true; break } catch {}
        if (child.exitCode !== null) throw Error(errors)
        await new Promise(done => setTimeout(done,100))
      }
      assert.equal(reached,true,errors)
      child.kill('SIGKILL'); await exited
      const approvals = await db.select().from(schema.organization_purchase_approvals).where(eq(schema.organization_purchase_approvals.request_id,q.row.id))
      if (operation === 'approval') assert.equal(approvals.length,boundary === 'before' ? 0 : 1)
      else assert.deepEqual(await counts(f), { orders: boundary === 'before' ? 0 : 1, capacity: boundary === 'before' ? 0 : 1 })
      const recovered = await domain.approvePurchase(f.id,q.row.id,f.reviewer,domain.purchaseDecisionInput.parse(decision))
      if (approvals.length) assert.equal(recovered.approval.id,approvals[0].id)
      const checkout = { ...q.input.order,purchasing_approval_id:recovered.approval.id }
      const purchased = await buy(f,checkout); assert.ok([200,201].includes(purchased.status),JSON.stringify(purchased.body))
      const history = await domain.inspectPurchase(f.id,q.row.id,f.owner)
      assert.equal(history.use?.trade_id,purchased.body.trade.id); assert.equal(history.use?.order_id,purchased.body.order.id)
      assert.deepEqual(await counts(f), { orders:1,capacity:1 })
    } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await exited }
  }
})

test('fresh funding rechecks consumed authority while original checkout remains recoverable', async () => {
  const f = await fixture(), a = await approved(f), created = await buy(f,a.checkout); assert.equal(created.status,201,JSON.stringify(created.body))
  const { serviceFundingEligibility } = await import('@/lib/service-funding-eligibility')
  const [trade] = await db.select().from(schema.trades).where(eq(schema.trades.id,created.body.trade.id))
  assert.equal(await serviceFundingEligibility(trade),null)
  await domain.stopPurchase(f.id,a.row.id,f.reviewer,'approval')
  assert.equal(await serviceFundingEligibility(trade),'PURCHASING_APPROVAL_INACTIVE')
  const replay = await buy(f,a.checkout); assert.equal(replay.status,200); assert.equal(replay.body.trade.id,trade.id)
})

test('real disposable chain deposit backs an approved buyer purchase, provider restart, explicit acceptance and exactly-once credit payout', { skip: !process.env.CLAWDMARKET_TEST_ANVIL_BINARY }, async () => {
  assert.ok(chain)
  const f = await fixture(), a = await approved(f, { order: { client_reference: crypto.randomUUID(), objective: 'Review the exact private code input', input: { private_code: 'const result = 42' }, payment_rail: 'credit', max_total: '1.05', expected_price: '1.00' } })
  const deposit = await call('/api/wallet/deposits', f.key, 'POST', { amount_minor: 105, payer: payer.address, client_reference: crypto.randomUUID() }, true)
  assert.equal(deposit.status,200,JSON.stringify(deposit.body))
  const wallet = createWalletClient({ chain: chain.client.chain, account: payer, transport: http(chain.url) })
  const txHash = await wallet.writeContract({ address: chain.token, abi: erc20Abi, functionName: 'transfer', args: [chain.treasury, 1_050_000n] })
  assert.equal((await chain.client.waitForTransactionReceipt({hash:txHash})).status,'success')
  const signature = await payer.signMessage({ message: creditDepositMessage(deposit.body.deposit,txHash) })
  const verified = await call('/api/wallet/deposits', f.key, 'PUT', { id: deposit.body.deposit.id,tx_hash:txHash,signature },true);   assert.equal(verified.status,200,JSON.stringify(verified.body))
  const created = await buy(f,a.checkout); assert.equal(created.status,201,JSON.stringify(created.body))
  const { creditBalance } = await import('@/lib/account-credit')
  assert.equal((await creditBalance(f.buyer)).available_minor,0); assert.equal((await creditBalance(f.buyer)).escrow_minor,100)
  const handlerFile = join(directory,`${created.body.trade.id}.handler.mjs`)
  await writeFile(handlerFile, `export default async()=>({summary:'The exact approved private input was reviewed.',artifact:{result:'Approved private review result'}})`)
  const run = promisify(execFile), command = ['scripts/provider-worker.mjs','--trade-id',created.body.trade.id,'--service-id',f.service,'--state-dir',join(directory,created.body.trade.id),'--handler',handlerFile]
  const options = { cwd: process.cwd(), env: { ...process.env, BASE_URL: baseUrl, CLAWDMARKET_PROVIDER_API_KEY: token(f.seller) } }
  const delivered = JSON.parse((await run(process.execPath,command,options)).stdout); assert.equal(delivered.state,'delivered')
  const resumed = JSON.parse((await run(process.execPath,command,options)).stdout); assert.equal(resumed.delivery_id,delivered.delivery_id); assert.equal(resumed.idempotent,true)
  const confirmed = await call(`/api/trades/${created.body.trade.id}/confirm`,f.key,'POST',{ content_hash: delivered.content_hash },true); assert.equal(confirmed.status,200,JSON.stringify(confirmed.body))
  assert.equal((await creditBalance(f.seller)).available_minor,100); assert.equal((await creditBalance(f.buyer)).escrow_minor,0)
  assert.equal((await chain.balance(chain.treasury)),101_050_000n)
  const history = await call(a.path,f.owner); assert.equal(history.body.use.order_id,created.body.order.id); assert.equal(history.body.use.trade_id,created.body.trade.id)
  assert.deepEqual(await counts(f), { orders:1,capacity:0 }); assert.equal((await buy(f,a.checkout)).status,200)
})

test('an already-sent real EVM payment survives approval revocation and closed flags through the original full-refund outbox', { skip: !process.env.CLAWDMARKET_TEST_ANVIL_BINARY }, async () => {
  assert.ok(chain)
  const f = await fixture(), a = await approved(f), created = await buy(f,a.checkout); assert.equal(created.status,201,JSON.stringify(created.body))
  const tradeId = created.body.trade.id, wallet = createWalletClient({ chain:chain.client.chain,account:payer,transport:http(chain.url) })
  const balanceBefore = await chain.balance(payer.address)
  const original = await call(`/api/trades/${tradeId}/fund/evm/intent`,f.key,'POST',{chain_id:8453,token_address:chain.token,payer_address:payer.address},true)
  assert.equal(original.status,201,JSON.stringify(original.body))
  const txHash = await wallet.writeContract({ address:chain.token,abi:erc20Abi,functionName:'transfer',args:[chain.treasury,BigInt(original.body.intent.token_amount)] })
  await chain.client.waitForTransactionReceipt({hash:txHash})
  const { evmPaymentProofMessage } = await import('@/lib/evm-payment-proof')
  const signature = await payer.signMessage({message:evmPaymentProofMessage(original.body.intent,txHash)})
  await domain.stopPurchase(f.id,a.row.id,f.reviewer,'approval')
  process.env.CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED = 'false'
  process.env.CLAWDMARKET_NEW_PAYMENTS_PAUSED = 'true'
  try {
    const body = {intent_id:original.body.intent.id,chain_id:8453,token_address:chain.token,payer_address:payer.address,tx_hash:txHash,payer_signature:signature}
    const recovered = await call(`/api/trades/${tradeId}/fund/evm`,f.key,'POST',body,true)
    assert.ok([200,202].includes(recovered.status),JSON.stringify(recovered.body))
    assert.equal(recovered.body.rejection_code,'PROVIDER_ELIGIBILITY_CHANGED')
    let terminal = recovered
    for (let retry = 0; retry < 8 && terminal.body.trade.payout_status !== 'refunded'; retry++) {
      await new Promise(done=>setTimeout(done,200));terminal=await call(`/api/trades/${tradeId}/fund/evm`,f.key,'POST',body,true)
      assert.ok([200,202].includes(terminal.status),JSON.stringify(terminal.body))
    }
    assert.equal(terminal.body.trade.payout_status,'refunded',JSON.stringify(terminal.body))
    assert.equal(await chain.balance(payer.address),balanceBefore)
    const receipts = await db.select().from(schema.payment_receipts).where(eq(schema.payment_receipts.external_id,tradeId))
    assert.equal(receipts.length,1);assert.equal(receipts[0].tx_hash,txHash)
    const outbox = await db.select().from(schema.settlement_transfers).where(eq(schema.settlement_transfers.trade_id,tradeId))
    assert.equal(outbox.length,1);assert.equal(outbox[0].kind,'buyer_refund');assert.equal(outbox[0].status,'confirmed')
    assert.deepEqual(await counts(f),{orders:1,capacity:0});assert.equal((await buy(f,a.checkout)).body.trade.id,tradeId)
  } finally { delete process.env.CLAWDMARKET_NEW_PAYMENTS_PAUSED;process.env.CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED='true' }
})
