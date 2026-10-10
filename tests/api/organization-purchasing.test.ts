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
import { createWalletClient, encodeFunctionData, erc20Abi, http, keccak256, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { Account as TempoAccount } from 'viem/tempo'
import { Credential } from 'mppx'
import { createBuyerTempoAdapter } from '../../scripts/buyer-tempo-adapter.mjs'
import { startDisposableTempoChain } from '../helpers/disposable-tempo-chain'
import { createLocalTestSchema } from '../helpers/local-schema'
import { startDisposableWorkflowChain } from '../helpers/disposable-workflow-chain'
import { creditDepositMessage } from '@/lib/credit-proof'

let directory: string, baseUrl: string, db: typeof import('@/lib/db').db, schema: typeof import('@/lib/schema'), jwt: typeof import('@/lib/auth').generateJWT
let domain: typeof import('@/lib/organization-purchasing')
const server = createServer(),tempoProxy=createServer()
let tempoChain:Awaited<ReturnType<typeof startDisposableTempoChain>>|undefined,tempoRpcUrl:string,tempoBroadcasts=0
let spendingApiHook:((path:string)=>Promise<void>)|null=null
let tempoRpcHook:((method:string)=>Promise<void>)|null=null
const payer = privateKeyToAccount(`0x${'18'.repeat(32)}`), treasuryKey = `0x${'97'.repeat(32)}` as const
let chain: Awaited<ReturnType<typeof startDisposableWorkflowChain>> | undefined,enterpriseChain:Awaited<ReturnType<typeof startDisposableWorkflowChain>>|undefined
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'clawdmarket-workspace-test-purchasing-'))
  Object.assign(process.env, { TURSO_DATABASE_URL: `file:${join(directory, 'purchasing.db')}`, TURSO_AUTH_TOKEN: '', JWT_SECRET: 'purchasing-tests-only-secret',
    CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED: 'true', CLAWDMARKET_REUSABLE_SERVICES_ENABLED: 'true', CLAWDMARKET_ACCOUNT_CREDIT_ENABLED: 'true',
    EVM_SETTLEMENT_PRIVATE_KEY: treasuryKey, TREASURY_ADDRESS: privateKeyToAccount(treasuryKey).address })
  if (process.env.CLAWDMARKET_TEST_ANVIL_BINARY) chain = await startDisposableWorkflowChain(process.env.CLAWDMARKET_TEST_ANVIL_BINARY, payer.address, treasuryKey, 8453)
  if(process.env.CLAWDMARKET_TEST_ANVIL_BINARY)enterpriseChain=await startDisposableWorkflowChain(process.env.CLAWDMARKET_TEST_ANVIL_BINARY,payer.address,treasuryKey,1)
  if(enterpriseChain)process.env.EVM_RPC_URL_1=enterpriseChain.url
  if(process.env.CLAWDMARKET_TEST_TEMPO_BINARY){
    tempoChain=await startDisposableTempoChain(process.env.CLAWDMARKET_TEST_TEMPO_BINARY,payer.address,treasuryKey)
    tempoProxy.on('request',async(incoming,outgoing)=>{try{
      const chunks=[];for await(const chunk of incoming)chunks.push(chunk)
      const body=Buffer.concat(chunks).toString(),payload=JSON.parse(body),requests=Array.isArray(payload)?payload:[payload]
      for(const r of requests)if(/^eth_send/.test(r.method))tempoBroadcasts++
      const response=await fetch(tempoChain!.url,{method:'POST',headers:{'Content-Type':'application/json'},body}),result=await response.text()
      for(const r of requests)await tempoRpcHook?.(r.method)
      outgoing.writeHead(response.status,{'Content-Type':'application/json'});outgoing.end(result)
    }catch{outgoing.writeHead(500);outgoing.end('{}')}})
    await new Promise<void>(done=>tempoProxy.listen(0,'127.0.0.1',done));tempoRpcUrl=`http://127.0.0.1:${(tempoProxy.address() as {port:number}).port}`
    Object.assign(process.env,{TEMPO_RPC_URL:tempoRpcUrl,MPP_SECRET_KEY_CURRENT:'disposable-enterprise-tempo-tests-only-secret',MPP_RECIPIENT_ADDRESS:tempoChain.treasury})
  }
  process.env.EVM_ACCEPTED_TOKENS = JSON.stringify([{ chainId: 8453, chainName: 'Disposable purchasing chain',
    address: chain?.token || `0x${'44'.repeat(20)}`, symbol: 'USDC', decimals: 6, fixedUsdPrice: 1, confirmations: 1, rpcUrl: chain?.url || 'https://example.invalid' },{chainId:1,chainName:'Disposable enterprise L1',address:enterpriseChain?.token||`0x${'45'.repeat(20)}`,symbol:'USDC',decimals:6,fixedUsdPrice:1,confirmations:1}])
  db = (await import('@/lib/db')).db; schema = await import('@/lib/schema'); await createLocalTestSchema(db.$client, schema)
  jwt = (await import('@/lib/auth')).generateJWT; domain = await import('@/lib/organization-purchasing')
  const disputeApi = await import('@/app/api/trades/[id]/dispute/route')
  const resolveApi = await import('@/app/api/trades/[id]/resolve/route')
  const spendingApi = await import('@/app/api/organizations/[id]/spending-accounts/route')
  const spendingPaymentApi=await import('@/app/api/organizations/[id]/spending-accounts/orders/[tradeId]/fund/evm/[action]/route')
  const spendingTempoApi=await import('@/app/api/organizations/[id]/spending-accounts/orders/[tradeId]/fund/mpp/[action]/route')
  const mppApi=await import('@/app/api/trades/[id]/fund/mpp/route')
  const mppIntentApi=await import('@/app/api/trades/[id]/fund/mpp/intent/route')
  const mppClaimApi=await import('@/app/api/trades/[id]/fund/mpp/claim/route')
  const spendingOrdersApi = await import('@/app/api/organizations/[id]/spending-accounts/orders/route')
  const tradeApi = await import('@/app/api/trades/route')
  const previewApi = await import('@/app/api/trades/preview/route')
  const privateApi = await import('@/app/api/services/[id]/organization-access/route')
  const catalogApi = await import('@/app/api/organizations/[id]/providers/route')
  const acceptApi = await import('@/app/api/organizations/[id]/providers/[shareId]/accept/route')
  const profileApi = await import('@/app/api/agents/[id]/route')
  const activityApi = await import('@/app/api/activity/route')
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
  const claimApi=await import('@/app/api/trades/[id]/fund/evm/claim/route')
  const fundingApi = await import('@/app/api/trades/[id]/fund/evm/route')
  server.on('request', async (incoming, outgoing) => {
    try {
      const chunks = []; for await (const chunk of incoming) chunks.push(chunk)
      const body = Buffer.concat(chunks).toString(), path = incoming.url!.split('?')[0], parts = path.split('/')
      const request = new NextRequest(baseUrl + incoming.url!, { method: incoming.method, headers: incoming.headers as Record<string, string>, ...(body ? { body } : {}) })
      let response: Response
      if(path.includes('/spending-accounts/orders/')&&path.includes('/fund/evm/'))response=await spendingPaymentApi[incoming.method as 'GET'|'POST'](request,{params:Promise.resolve({id:parts[3],tradeId:parts[6],action:parts[9]})})
      else if(path.includes('/spending-accounts/orders/')&&path.includes('/fund/mpp/'))response=await spendingTempoApi[incoming.method as 'GET'|'POST'](request,{params:Promise.resolve({id:parts[3],tradeId:parts[6],action:parts[9]})})
      else if(path.endsWith('/spending-accounts/orders')) response = await spendingOrdersApi[incoming.method as 'GET'|'POST'](request,{params:Promise.resolve({id:parts[3]})})
      else if(path.endsWith('/spending-accounts')) response = await spendingApi[incoming.method as 'GET'|'POST'|'DELETE'](request,{params:Promise.resolve({id:parts[3]})})
      else if (path === '/api/trades') response = await tradeApi.POST(request)
      else if (path === '/api/trades/preview') response = await previewApi.POST(request)
      else if (path.endsWith('/organization-access')) response = await privateApi[incoming.method as 'GET'|'POST'|'DELETE'](request,{params:Promise.resolve({id:parts[3]})})
      else if (path.includes('/providers/')) response = await acceptApi.POST(request,{params:Promise.resolve({id:parts[3],shareId:parts[5]})})
      else if (path.endsWith('/providers')) response = await catalogApi[incoming.method as 'GET'|'DELETE'](request,{params:Promise.resolve({id:parts[3]})})
      else if (path.includes('/agents/')) response = await profileApi.GET(request,{params:Promise.resolve({id:parts[3]})})
      else if (path === '/api/activity') response = await activityApi.GET()
      else if (path.includes('/purchasing/')) {
        const params = { params: Promise.resolve({ id: parts[3], requestId: parts[6] }) }
        if (path.endsWith('/roles')) response = await roleApi[incoming.method as 'GET' | 'POST' | 'DELETE'](request, params)
        else if (path.endsWith('/approval')) response = await approvalApi[incoming.method as 'POST' | 'DELETE'](request, params)
        else if (parts[6]) response = await inspectApi[incoming.method as 'GET' | 'DELETE'](request, params)
        else response = await requestApi[incoming.method as 'GET' | 'POST'](request, params)
      } else if (path.includes('/services/')) response = await orderApi.POST(request, { params: Promise.resolve({ id: parts[3] }) })
      else if (path === '/api/wallet/deposits') response = await depositsApi[incoming.method as 'POST' | 'PUT'](request)
      else {
        const params = { params: Promise.resolve({ id: parts[3] }) }
        response = path.endsWith('/dispute') ? await disputeApi.POST(request,params) : path.endsWith('/resolve') ? await resolveApi.POST(request,params) : path.endsWith('/fund/mpp/intent') ? await mppIntentApi[incoming.method as 'GET'|'POST'](request,params) : path.endsWith('/fund/mpp/claim') ? await mppClaimApi.POST(request,params) : path.endsWith('/fund/mpp') ? await mppApi.POST(request,params) : path.endsWith('/fund/evm/claim') ? await claimApi.POST(request,params) : path.endsWith('/fund/evm/intent') ? await intentApi[incoming.method as 'GET'|'POST'](request, params) : path.endsWith('/fund/evm') ? await fundingApi.POST(request, params) : path.endsWith('/attempt') ? await attemptApi.POST(request, params) : path.endsWith('/delivery') ? await deliverApi.POST(request, params)
          : path.endsWith('/confirm') ? await confirmApi.POST(request, params) : await workApi.GET(request, params)
      }
      await spendingApiHook?.(path)
      outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(await response.text())
    } catch (error) { outgoing.writeHead(500); outgoing.end(JSON.stringify({ error: String(error) })) }
  })
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done)); baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  process.env.CLAWDMARKET_CANONICAL_ORIGIN=baseUrl
})
after(async () => { await new Promise<void>(done => server.close(() => done())); db?.$client.close(); await chain?.stop();await enterpriseChain?.stop();if(tempoChain){await new Promise<void>(done=>tempoProxy.close(()=>done()));await tempoChain.stop()} if (directory) await rm(directory, { recursive: true, force: true }) })
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

async function privateFixture() {
  const f=await fixture(),providerAgent=crypto.randomUUID(),providerOwner=`provider-owner-${providerAgent}`,seller=`user_agent_${providerAgent}`
  await db.insert(schema.users).values([providerOwner,seller].map(id=>({id,name:id,email:`${id}@test.invalid`,password_hash:'unused'})))
  const {hashAgentApiKey}=await import('@/lib/registered-agent-auth')
  await db.insert(schema.agents).values({id:providerAgent,name:'Confidential provider',description:'Private organization service',capabilities:'["code-review"]',endpoint:'https://example.invalid',owner_address:'',visibility:'private',api_key:hashAgentApiKey(`test-private-${providerAgent}`)})
  await db.insert(schema.agent_owners).values({agentId:providerAgent,userId:providerOwner,establishedBy:'test'})
  await db.insert(schema.payout_addresses).values({user_id:seller,address:privateKeyToAccount(`0x${'19'.repeat(32)}`).address})
  await db.update(schema.service_definitions).set({seller_id:seller,visibility:'organization',title:'Confidential organization analysis'}).where(eq(schema.service_definitions.id,f.service))
  const {createNamedAgentCredential}=await import('@/lib/agent-named-credentials')
  const credential=await createNamedAgentCredential({agentId:providerAgent,name:'Private provider worker',scopes:['agent:read','marketplace:write'],actorCredentialId:null})
  assert.equal(credential.kind,'created');if(credential.kind!=='created')throw Error('Provider credential fixture failed')
  return {...f,seller,providerAgent,providerOwner,providerKey:credential.api_key,privatePath:`/api/services/${f.service}/organization-access`,catalogPath:`/api/organizations/${f.id}/providers`}
}
type PrivateFixture=Awaited<ReturnType<typeof privateFixture>>
async function shared(f:PrivateFixture,mutation={}) {
  const input={version:1,client_reference:crypto.randomUUID(),organization_id:f.id,team_id:f.team,expires_at:new Date(Date.now()+3600_000).toISOString(),...mutation}
  const offer=await call(f.privatePath,f.providerOwner,'POST',input);assert.equal(offer.status,201,JSON.stringify(offer.body))
  const decision={version:1,client_reference:crypto.randomUUID(),request_hash:offer.body.share.request_hash}
  const accepted=await call(`${f.catalogPath}/${offer.body.share.id}/accept`,f.owner,'POST',decision);assert.equal(accepted.status,201,JSON.stringify(accepted.body))
  return {input,decision,share:accepted.body.share}
}
const privateOrder=(shareId:string,rail='evm')=>({client_reference:crypto.randomUUID(),objective:'Review confidential organization code',input:{private_code:'Confidential source input'},payment_rail:rail,max_total:'1.05',expected_price:'1.00',provider_share_id:shareId})

test('private provider requires both current owners and an exact bounded share; ordinary viewers and read accounts cannot inspect it',async()=>{
  const f=await privateFixture(),s=await shared(f)
  assert.equal((await call(f.privatePath,f.providerOwner,'POST',s.input)).body.share.id,s.share.id)
  assert.equal((await call(`${f.catalogPath}/${s.share.id}/accept`,f.owner,'POST',s.decision)).status,200)
  assert.equal((await call(`${f.catalogPath}/${s.share.id}/accept`,f.owner,'POST',{...s.decision,client_reference:crypto.randomUUID()})).status,409)
  assert.equal((await call(f.privatePath,f.owner,'GET')).status,404)
  assert.equal((await call(f.catalogPath,f.viewer)).status,404)
  assert.equal((await call(f.catalogPath,f.key,'GET',undefined,true)).body.providers[0].service.title,'Confidential organization analysis')
  const role=await grant(f,'requester')
  const allowed=await call(f.catalogPath+'?role_id='+role.row.id,f.requester);assert.equal(allowed.status,200);assert.equal(allowed.body.providers.length,1)
  const small=await grant(f,'requester',{max_purchase:'1.04'})
  assert.equal((await call(f.catalogPath+'?role_id='+small.row.id,f.requester)).body.providers.length,0)
  const wrong=await grant(f,'requester',{team_id:f.otherTeam})
  assert.equal((await call(f.catalogPath+'?role_id='+wrong.row.id,f.requester)).body.providers.length,0)
  const {createOrganizationServiceAccount}=await import('@/lib/organization-service-accounts')
  const read=await createOrganizationServiceAccount(f.id,f.owner,{client_reference:crypto.randomUUID(),name:'Catalog read isolation',lifetime_days:1})
  assert.equal(read.kind,'ok');if(read.kind!=='ok')throw Error('Read account fixture failed')
  assert.equal((await fetch(baseUrl+f.catalogPath,{headers:{Authorization:`Bearer ${read.api_key}`}})).status,401)
  assert.equal((await buy(f,privateOrder(crypto.randomUUID()))).status,404)
  const cookie=await fetch(baseUrl+f.privatePath,{method:'POST',headers:{Cookie:`auth-token=${token(f.providerOwner)}`,'Content-Type':'application/json'},body:JSON.stringify(s.input)})
  assert.equal(cookie.status,403)
  assert.equal((await call(f.privatePath,f.providerOwner,'POST',{...s.input,padding:'x'.repeat(17000)})).status,413)
  assert.equal((await call(`${f.catalogPath}/${s.share.id}/accept`,f.viewer,'POST',s.decision)).status,404)
  assert.deepEqual(await counts(f),{orders:0,capacity:0})
})

test('private provider checkout freezes privacy and enforces current share, assignment, ownership, expiry and department before fresh funding',async()=>{
  const f=await privateFixture(),s=await shared(f),a=await approved(f,{order:privateOrder(s.share.id)})
  assert.equal((await buy(f,{...a.checkout,provider_share_id:crypto.randomUUID()})).status,404)
  const created=await buy(f,a.checkout);assert.equal(created.status,201,JSON.stringify(created.body))
  const [order]=await db.select().from(schema.service_orders).where(eq(schema.service_orders.id,created.body.order.id))
  assert.equal(order.private_provider_share_id,s.share.id)
  const [trade]=await db.select().from(schema.trades).where(eq(schema.trades.id,order.trade_id))
  const {serviceFundingEligibility}=await import('@/lib/service-funding-eligibility')
  assert.equal(await serviceFundingEligibility(trade),null)
  await db.update(schema.organization_teams).set({status:'archived'}).where(eq(schema.organization_teams.id,f.team))
  assert.equal(await serviceFundingEligibility(trade),'PROVIDER_SHARE_DEPARTMENT_UNAVAILABLE')
  await db.update(schema.organization_teams).set({status:'active'}).where(eq(schema.organization_teams.id,f.team))
  await call(f.privatePath,f.providerOwner,'DELETE',{share_id:s.share.id})
  assert.equal(await serviceFundingEligibility(trade),'PROVIDER_SHARE_INACTIVE')
  process.env.CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED='false'
  try {const replay=await buy(f,a.checkout);assert.equal(replay.status,200);assert.equal(replay.body.trade.id,trade.id)}
  finally{process.env.CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED='true'}
  await db.update(schema.agents).set({visibility:'public'}).where(eq(schema.agents.id,f.providerAgent))
  const {publicTradeAvailable}=await import('@/lib/public-trade-visibility')
  assert.equal(await publicTradeAvailable(trade.id),false)
  const profile=await call(`/api/agents/${f.providerAgent}`,f.viewer)
  assert.equal(profile.status,200,JSON.stringify(profile.body));assert.ok(!JSON.stringify(profile.body).includes(trade.id));assert.ok(!JSON.stringify(profile.body).includes('Confidential organization analysis'))
  const activity=await call('/api/activity',f.viewer);assert.equal(activity.status,200);assert.ok(!JSON.stringify(activity.body).includes(trade.id))
  const {originalPrivateServiceListing}=await import('@/lib/listing-visibility');assert.equal(await originalPrivateServiceListing(order.listing_id),true)
  await db.update(schema.listings).set({status:'active'}).where(eq(schema.listings.id,order.listing_id))
  assert.equal((await call('/api/trades/preview',f.viewer,'POST',{listing_id:order.listing_id})).status,409)
  const bypass=await call('/api/trades',f.key,'POST',{listing_id:order.listing_id,amount:1,payment_rail:'evm',client_reference:crypto.randomUUID()},true)
  assert.equal(bypass.status,409,JSON.stringify(bypass.body));assert.equal(bypass.body.error_code,'LISTING_NOT_AVAILABLE')
  assert.deepEqual(await counts(f),{orders:1,capacity:1})
})

test('a real backed private order survives share revocation, provider restart and explicit acceptance without becoming public', {skip:!process.env.CLAWDMARKET_TEST_ANVIL_BINARY},async()=>{
  assert.ok(chain)
  const f=await privateFixture(),s=await shared(f),a=await approved(f,{order:privateOrder(s.share.id,'credit')})
  const {getMarketStats}=await import('@/lib/market-stats'),publishedBefore=await getMarketStats()
  const deposit=await call('/api/wallet/deposits',f.key,'POST',{amount_minor:105,payer:payer.address,client_reference:crypto.randomUUID()},true);assert.equal(deposit.status,200,JSON.stringify(deposit.body))
  const wallet=createWalletClient({chain:chain.client.chain,account:payer,transport:http(chain.url)})
  const txHash=await wallet.writeContract({address:chain.token,abi:erc20Abi,functionName:'transfer',args:[chain.treasury,1_050_000n]})
  await chain.client.waitForTransactionReceipt({hash:txHash})
  const signature=await payer.signMessage({message:creditDepositMessage(deposit.body.deposit,txHash)})
  assert.equal((await call('/api/wallet/deposits',f.key,'PUT',{id:deposit.body.deposit.id,tx_hash:txHash,signature},true)).status,200)
  const created=await buy(f,a.checkout);assert.equal(created.status,201,JSON.stringify(created.body))
  assert.equal((await call(f.privatePath,f.providerOwner,'DELETE',{share_id:s.share.id})).status,200)
  const handlerFile=join(directory,`${created.body.trade.id}.private-handler.mjs`)
  await writeFile(handlerFile,`export default async()=>({summary:'Completed the original confidential order.',artifact:{result:'Confidential approved result'}})`)
  const command=['scripts/provider-worker.mjs','--trade-id',created.body.trade.id,'--service-id',f.service,'--state-dir',join(directory,created.body.trade.id),'--handler',handlerFile]
  const options={cwd:process.cwd(),env:{...process.env,BASE_URL:baseUrl,CLAWDMARKET_PROVIDER_API_KEY:f.providerKey}},run=promisify(execFile)
  const delivered=JSON.parse((await run(process.execPath,command,options)).stdout);assert.equal(delivered.state,'delivered')
  const restarted=JSON.parse((await run(process.execPath,command,options)).stdout);assert.equal(restarted.delivery_id,delivered.delivery_id)
  assert.equal((await call(`/api/trades/${created.body.trade.id}/confirm`,f.key,'POST',{content_hash:delivered.content_hash},true)).status,200)
  const {creditBalance}=await import('@/lib/account-credit');assert.equal((await creditBalance(f.seller)).available_minor,100);assert.equal((await creditBalance(f.buyer)).escrow_minor,0)
  assert.deepEqual(await counts(f),{orders:1,capacity:0})
  await db.update(schema.agents).set({visibility:'public'}).where(eq(schema.agents.id,f.providerAgent))
  const {publicTradeAvailable}=await import('@/lib/public-trade-visibility');assert.equal(await publicTradeAvailable(created.body.trade.id),false)
  const profile=await call(`/api/agents/${f.providerAgent}`,f.viewer);assert.ok(!JSON.stringify(profile.body).includes(created.body.trade.id))
  const {loadAgentTrust}=await import('@/lib/agent-trust');assert.equal((await loadAgentTrust({id:f.providerAgent})).components.completedTrades,0)
  const {providerCapabilityEvidence}=await import('@/lib/provider-evidence');assert.equal((await providerCapabilityEvidence(f.seller,['code-review']))[0].accepted_completion_count,0)
  const activity=await call('/api/activity',f.viewer);assert.ok(!JSON.stringify(activity.body).includes(created.body.trade.id))
  const publishedAfter=await getMarketStats();assert.equal(publishedAfter.completed_trades,publishedBefore.completed_trades);assert.equal(publishedAfter.recorded_volume_usd,publishedBefore.recorded_volume_usd)
  assert.equal((await buy(f,a.checkout)).body.trade.id,created.body.trade.id)
})
test('an already-sent real private-service EVM payment survives share revocation through the original full refund', { skip: !process.env.CLAWDMARKET_TEST_ANVIL_BINARY }, async () => {
  assert.ok(chain)
  const f = await privateFixture(), share = await shared(f), a = await approved(f,{order:privateOrder(share.share.id)}), created = await buy(f,a.checkout); assert.equal(created.status,201,JSON.stringify(created.body))
  const tradeId = created.body.trade.id, wallet = createWalletClient({ chain:chain.client.chain,account:payer,transport:http(chain.url) })
  const balanceBefore = await chain.balance(payer.address)
  const original = await call(`/api/trades/${tradeId}/fund/evm/intent`,f.key,'POST',{chain_id:8453,token_address:chain.token,payer_address:payer.address},true)
  assert.equal(original.status,201,JSON.stringify(original.body))
  const txHash = await wallet.writeContract({ address:chain.token,abi:erc20Abi,functionName:'transfer',args:[chain.treasury,BigInt(original.body.intent.token_amount)] })
  await chain.client.waitForTransactionReceipt({hash:txHash})
  const { evmPaymentProofMessage } = await import('@/lib/evm-payment-proof')
  const signature = await payer.signMessage({message:evmPaymentProofMessage(original.body.intent,txHash)})
  assert.equal((await call(f.privatePath,f.providerOwner,'DELETE',{share_id:share.share.id})).status,200)
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

test('private checkout fails closed after either owner transfer, buyer reassignment, expiry or provider unavailability without funds or capacity',async()=>{
  for(const change of ['organization-owner','provider-owner','buyer-owner','assignment','expiry','provider','department','consent','flags'] as const){
    const f=await privateFixture(),s=await shared(f),a=await approved(f,{order:privateOrder(s.share.id)})
    if(change==='organization-owner')await db.update(schema.organizations).set({owner_account_id:f.viewer}).where(eq(schema.organizations.id,f.id))
    if(change==='provider-owner')await db.update(schema.agent_owners).set({userId:f.viewer}).where(eq(schema.agent_owners.agentId,f.providerAgent))
    if(change==='buyer-owner')await db.update(schema.agent_owners).set({userId:f.viewer}).where(eq(schema.agent_owners.agentId,f.agent))
    if(change==='assignment')await db.update(schema.organization_agent_assignments).set({team_id:f.otherTeam}).where(eq(schema.organization_agent_assignments.agent_id,f.agent))
    if(change==='expiry')await db.update(schema.organization_provider_shares).set({expires_at:new Date(Date.now()-1000)}).where(eq(schema.organization_provider_shares.id,s.share.id))
    if(change==='provider')await db.update(schema.agents).set({status:'inactive'}).where(eq(schema.agents.id,f.providerAgent))
    if(change==='department')await db.update(schema.organization_teams).set({status:'archived'}).where(eq(schema.organization_teams.id,f.team))
    if(change==='consent')await db.update(schema.organization_provider_shares).set({accept_hash:'0'.repeat(64)}).where(eq(schema.organization_provider_shares.id,s.share.id))
    if(change==='flags')process.env.CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED='false'
    try{assert.ok((await buy(f,a.checkout)).status>=400,change);assert.deepEqual(await counts(f),{orders:0,capacity:0})}
    finally{process.env.CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED='true'}
  }
})

test('independent private share, consent and checkout processes converge on original identities and one capacity claim',async()=>{
  const f=await privateFixture(),run=promisify(execFile)
  const input={version:1,client_reference:crypto.randomUUID(),organization_id:f.id,team_id:f.team,expires_at:new Date(Date.now()+3600_000).toISOString()}
  async function race(operation:string,args:unknown){
    const code=`(async()=>{const d=await import('./lib/organization-private-providers.ts'),p=JSON.parse(process.argv[1]);let r;
      ${operation==='offer'?"r=await d.offerPrivateProvider(p.service,p.actor,d.providerOfferInput.parse(p.input))":operation==='accept'?"r=await d.acceptPrivateProvider(p.org,p.share,p.actor,d.providerAcceptInput.parse(p.input))":"const {reserveServiceOrder}=await import('./lib/service-order-reservation.ts');const {serviceOrderInput}=await import('./lib/service-definitions.ts');p.request=serviceOrderInput.parse(p.request);r=await reserveServiceOrder(p)"};
      console.log(JSON.stringify(r));(await import('./lib/db.ts')).db.$client.close();})().catch(e=>{console.error(e);process.exitCode=1})`
    const results=await Promise.allSettled(Array.from({length:3},()=>run(process.execPath,['--conditions=react-server','--import','tsx','-e',code,JSON.stringify(args)],{cwd:process.cwd(),env:process.env})))
    return results.map(result=>{if(result.status!=='fulfilled')throw result.reason;return JSON.parse(result.value.stdout.trim())})
  }
  const offers=await race('offer',{service:f.service,actor:f.providerOwner,input});assert.equal(new Set(offers.map(r=>r.share.id)).size,1)
  const share=offers[0].share,decision={version:1,client_reference:crypto.randomUUID(),request_hash:share.request_hash}
  const decisions=await race('accept',{org:f.id,share:share.id,actor:f.owner,input:decision});assert.equal(new Set(decisions.map(r=>r.share.accept_hash)).size,1)
  const a=await approved(f,{order:privateOrder(share.id)}),orders=await race('checkout',{serviceId:f.service,principal:{userId:f.buyer,agentId:f.agent,kind:'registered-agent',usesCookieAuth:false},request:a.checkout})
  assert.equal(new Set(orders.map(r=>r.order.id)).size,1);assert.equal(new Set(orders.map(r=>r.trade.id)).size,1);assert.deepEqual(await counts(f),{orders:1,capacity:1})
  const events=await db.select().from(schema.organization_audit_events).where(eq(schema.organization_audit_events.organization_id,f.id))
  assert.equal(events.filter(e=>e.action==='provider_share_offered').length,1);assert.equal(events.filter(e=>e.action==='provider_share_accepted').length,1)
})

test('SIGKILL at private offer, consent and economic commit boundaries preserves original share and order recovery',async()=>{
  const privateDomain=await import('@/lib/organization-private-providers')
  for(const operation of ['offer','accept','checkout'] as const)for(const boundary of ['before','after'] as const){
    const f=await privateFixture(),input={version:1,client_reference:crypto.randomUUID(),organization_id:f.id,team_id:f.team,expires_at:new Date(Date.now()+3600_000).toISOString()}
    let shareId:string|undefined,decision:object|undefined,checkout:unknown
    if(operation!=='offer'){
      const offered=await privateDomain.offerPrivateProvider(f.service,f.providerOwner,privateDomain.providerOfferInput.parse(input));shareId=offered.share.id
      decision={version:1,client_reference:crypto.randomUUID(),request_hash:offered.share.request_hash}
      if(operation==='checkout'){
        await privateDomain.acceptPrivateProvider(f.id,shareId,f.owner,privateDomain.providerAcceptInput.parse(decision))
        checkout=(await approved(f,{order:privateOrder(shareId)})).checkout
      }
    }
    const args={f,input,shareId,decision,checkout},marker=join(directory,`private-${operation}-${boundary}-${f.id}.marker`)
    const code=`(async()=>{const {writeFile}=await import('node:fs/promises'),a=JSON.parse(process.argv[1]);const stop=async()=>{await writeFile(process.argv[2],'boundary');await new Promise(()=>{})};
      ${boundary==='before'?"const {db}=await import('./lib/db.ts');const proto=Object.getPrototypeOf(db.session),original=proto.transaction;proto.transaction=function(fn,c){return original.call(this,async tx=>{const r=await fn(tx);await stop();return r},c)};":''}
      const d=await import('./lib/organization-private-providers.ts');
      ${operation==='offer'?"await d.offerPrivateProvider(a.f.service,a.f.providerOwner,d.providerOfferInput.parse(a.input))":operation==='accept'?"await d.acceptPrivateProvider(a.f.id,a.shareId,a.f.owner,d.providerAcceptInput.parse(a.decision))":"const {reserveServiceOrder}=await import('./lib/service-order-reservation.ts');const {serviceOrderInput}=await import('./lib/service-definitions.ts');await reserveServiceOrder({serviceId:a.f.service,principal:{userId:a.f.buyer,agentId:a.f.agent,kind:'registered-agent',usesCookieAuth:false},request:serviceOrderInput.parse(a.checkout)})"};await stop()})().catch(e=>{console.error(e);process.exitCode=1})`
    const child=spawn(process.execPath,['--conditions=react-server','--import','tsx','-e',code,JSON.stringify(args),marker],{cwd:process.cwd(),env:process.env,stdio:['ignore','ignore','pipe']})
    let errors='';child.stderr.on('data',chunk=>{errors+=chunk});const exited=new Promise<void>((done,reject)=>{child.once('exit',()=>done());child.once('error',reject)})
    try{
      let reached=false
      for(let wait=0;wait<150;wait++){try{await readFile(marker);reached=true;break}catch{}if(child.exitCode!==null)throw Error(errors);await new Promise(done=>setTimeout(done,100))}
      assert.equal(reached,true,errors);child.kill('SIGKILL');await exited
      const shares=await db.select().from(schema.organization_provider_shares).where(eq(schema.organization_provider_shares.service_id,f.service))
      if(operation==='offer')assert.equal(shares.length,boundary==='before'?0:1)
      if(operation==='accept')assert.equal(shares[0].state,boundary==='before'?'pending':'active')
      if(operation==='checkout')assert.deepEqual(await counts(f),{orders:boundary==='before'?0:1,capacity:boundary==='before'?0:1})
      const recovered=await privateDomain.offerPrivateProvider(f.service,f.providerOwner,privateDomain.providerOfferInput.parse(input))
      if(shares.length)assert.equal(recovered.share.id,shares[0].id)
      const originalDecision=decision||{version:1,client_reference:crypto.randomUUID(),request_hash:recovered.share.request_hash}
      await privateDomain.acceptPrivateProvider(f.id,recovered.share.id,f.owner,privateDomain.providerAcceptInput.parse(originalDecision))
      const body=checkout||(await approved(f,{order:privateOrder(recovered.share.id)})).checkout
      const purchased=await buy(f,body);assert.ok([200,201].includes(purchased.status),JSON.stringify(purchased.body));assert.deepEqual(await counts(f),{orders:1,capacity:1})
    }finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await exited}
  }
})

async function spendingGrant(f:Fixture,mutation={}){
  const input={version:1,client_reference:crypto.randomUUID(),name:'Bounded service purchase automation',buyer_agent_id:f.agent,team_id:f.team,cost_center:'ENGINEERING',
    allowed_services:[{service_id:f.service,provider_share_id:null}],max_purchase:'1.05',max_daily:'1.05',max_monthly:'1.05',max_lifetime:'1.05',
    expires_at:new Date(Date.now()+3600_000).toISOString(),...mutation}
  const response=await call(`/api/organizations/${f.id}/spending-accounts`,f.owner,'POST',input)
  assert.equal(response.status,201,JSON.stringify(response.body));return {input,account:response.body.account,key:response.body.api_key,path:`/api/organizations/${f.id}/spending-accounts`}
}
async function spend(path:string,key:string,method='POST',body?:unknown){
  const response=await fetch(baseUrl+path,{method,headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})})
  return {status:response.status,body:await response.json(),headers:response.headers}
}
async function depositBacked(f:Fixture,amount=105){
  assert.ok(chain)
  const buyerTokens=await chain.balance(payer.address),treasuryTokens=await chain.balance(chain.treasury)
  const {creditBalance}=await import('@/lib/account-credit'),priorCredit=await creditBalance(f.buyer)
  const deposit=await call('/api/wallet/deposits',f.key,'POST',{amount_minor:amount,payer:payer.address,client_reference:crypto.randomUUID()},true)
  assert.equal(deposit.status,200,JSON.stringify(deposit.body))
  const wallet=createWalletClient({chain:chain.client.chain,account:payer,transport:http(chain.url)})
  const txHash=await wallet.writeContract({address:chain.token,abi:erc20Abi,functionName:'transfer',args:[chain.treasury,BigInt(amount)*10000n]})
  assert.equal((await chain.client.waitForTransactionReceipt({hash:txHash})).status,'success')
  const signature=await payer.signMessage({message:creditDepositMessage(deposit.body.deposit,txHash)})
  assert.equal((await call('/api/wallet/deposits',f.key,'PUT',{id:deposit.body.deposit.id,tx_hash:txHash,signature},true)).status,200)
  assert.equal(await chain.balance(payer.address),buyerTokens-BigInt(amount)*10000n)
  assert.equal(await chain.balance(chain.treasury),treasuryTokens+BigInt(amount)*10000n)
  assert.equal((await creditBalance(f.buyer)).available_minor,priorCredit.available_minor+amount)
}

test('spending credentials are issued once by the current owner and never promote viewers, read keys or general buyer authentication',async()=>{
  const f=await fixture(),g=await spendingGrant(f)
  assert.match(g.key,/^cmos_[a-f0-9]{64}$/)
  const replay=await call(g.path,f.owner,'POST',g.input);assert.equal(replay.status,200);assert.equal(replay.body.api_key,null);assert.equal(replay.body.account.id,g.account.id)
  assert.equal((await call(g.path,f.viewer,'POST',g.input)).status,404)
  assert.equal((await call(g.path,f.owner,'POST',{...g.input,max_lifetime:'2.10'})).status,409)
  const history=await call(g.path,f.owner);assert.equal(history.status,200);assert.ok(!JSON.stringify(history.body).includes(g.key));assert.ok(!JSON.stringify(history.body).includes('credential_hash'))
  const {createOrganizationServiceAccount}=await import('@/lib/organization-service-accounts')
  const read=await createOrganizationServiceAccount(f.id,f.owner,{client_reference:crypto.randomUUID(),name:'Existing read authority',lifetime_days:1})
  assert.equal(read.kind,'ok');if(read.kind!=='ok')throw Error('Read fixture failed')
  assert.equal((await spend(g.path+'/orders',read.api_key!, 'POST',{})).status,401)
  assert.equal((await spend(g.path+'/orders',f.key,'POST',{})).status,401)
  assert.equal((await spend(`/api/services/${f.service}/orders`,g.key,'POST',{client_reference:crypto.randomUUID(),objective:'Do not impersonate the delegated buyer',payment_rail:'credit'})).status,401)
  const noApproval=await spend(g.path+'/orders',g.key,'POST',{service_id:f.service,order:{client_reference:crypto.randomUUID(),objective:'An exact approval is required for this purchase',payment_rail:'credit'}})
  assert.ok(noApproval.status>=400)
  assert.equal((await call(g.path,f.owner,'POST',{...g.input,client_reference:crypto.randomUUID(),expires_at:new Date(Date.now()+31*86400_000).toISOString()})).status,400)
  assert.equal((await call(g.path,f.owner,'POST',{...g.input,padding:'x'.repeat(17000)})).status,413)
  const cookie=await fetch(baseUrl+g.path,{method:'POST',headers:{Cookie:`auth-token=${token(f.owner)}`,'Content-Type':'application/json'},body:JSON.stringify(g.input)})
  assert.equal(cookie.status,403)
  assert.deepEqual(await counts(f),{orders:0,capacity:0})
})

test('spending account authority rejects changed owner, buyer, assignment, department, expiry, ban and forged evidence before any financial write',async()=>{
  for(const change of ['owner','buyer-owner','assignment','department','expiry','revocation','ban','flags','hash'] as const){
    const f=await fixture(),g=await spendingGrant(f),a=await approved(f,{order:{client_reference:crypto.randomUUID(),objective:'Execute the exactly approved bounded purchase',input:{},payment_rail:'credit',max_total:'1.05'}})
    if(change==='owner')await db.update(schema.organizations).set({owner_account_id:f.viewer}).where(eq(schema.organizations.id,f.id))
    if(change==='buyer-owner')await db.update(schema.agent_owners).set({userId:f.viewer}).where(eq(schema.agent_owners.agentId,f.agent))
    if(change==='assignment')await db.update(schema.organization_agent_assignments).set({cost_center:'CHANGED'}).where(eq(schema.organization_agent_assignments.agent_id,f.agent))
    if(change==='department')await db.update(schema.organization_teams).set({status:'archived'}).where(eq(schema.organization_teams.id,f.team))
    if(change==='expiry')await db.update(schema.organization_spending_accounts).set({expires_at:new Date(Date.now()-1000)}).where(eq(schema.organization_spending_accounts.id,g.account.id))
    if(change==='revocation')await call(g.path,f.owner,'DELETE',{account_id:g.account.id})
    if(change==='ban')await db.insert(schema.banned_users).values({user_id:f.owner,reason:'Disposable authorization boundary',created_at:Date.now()})
    if(change==='flags')process.env.CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED='false'
    if(change==='hash')await db.update(schema.organization_spending_accounts).set({max_lifetime_minor:100000}).where(eq(schema.organization_spending_accounts.id,g.account.id))
    try{assert.ok((await spend(g.path+'/orders',g.key,'POST',{service_id:f.service,order:a.checkout})).status>=400,change);assert.deepEqual(await counts(f),{orders:0,capacity:0})}
    finally{process.env.CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED='true'}
  }
  const f=await fixture(),g=await spendingGrant(f),a=await approved(f,{order:{client_reference:crypto.randomUUID(),objective:'Execute the exactly approved bounded purchase',input:{},payment_rail:'credit',max_total:'1.05'}})
  const {reserveServiceOrder}=await import('@/lib/service-order-reservation'),{serviceOrderInput}=await import('@/lib/service-definitions')
  await assert.rejects(()=>reserveServiceOrder({serviceId:f.service,principal:{userId:f.buyer,agentId:f.agent,kind:'registered-agent',usesCookieAuth:false},request:serviceOrderInput.parse(a.checkout),organizationSpendingEvidence:{accountId:g.account.id,organizationId:f.id,buyerId:f.buyer,agentId:f.agent,credentialHash:'caller-json'}}),/Validated spending credential required/)
  const wrongRail=await approved(f)
  const failed=await spend(g.path+'/orders',g.key,'POST',{service_id:f.service,order:wrongRail.checkout});assert.equal(failed.body.error_code,'SPENDING_EXACT_CREDIT_APPROVAL_REQUIRED')
  assert.deepEqual(await counts(f),{orders:0,capacity:0})
})

test('real verified credit backs a private spending-key purchase, provider restart and original buyer acceptance with immutable account/share/approval attribution',{skip:!process.env.CLAWDMARKET_TEST_ANVIL_BINARY},async()=>{
  const f=await privateFixture(),s=await shared(f),g=await spendingGrant(f,{allowed_services:[{service_id:f.service,provider_share_id:s.share.id}]}),a=await approved(f,{order:privateOrder(s.share.id,'credit')})
  await depositBacked(f)
  const created=await spend(g.path+'/orders',g.key,'POST',{service_id:f.service,order:a.checkout});assert.equal(created.status,201,JSON.stringify(created.body))
  assert.equal(created.body.order.organization_spending_account_id,g.account.id);assert.equal(created.body.order.private_provider_share_id,s.share.id);assert.equal(created.body.order.purchasing_approval_id,a.approval.id)
  const use=await spend(g.path+'/orders?order_id='+created.body.order.id,g.key,'GET');assert.equal(use.status,200);assert.equal(use.body.use.amount_minor,105)
  const otherAccount=await spendingGrant(f,{allowed_services:[{service_id:f.service,provider_share_id:s.share.id}]})
  assert.equal((await spend(g.path+'/orders?order_id='+created.body.order.id,otherAccount.key,'GET')).status,404)
  assert.equal((await spend(g.path+'/orders',otherAccount.key,'POST',{service_id:f.service,order:a.checkout})).status,409)
  process.env.CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED='false';process.env.CLAWDMARKET_REUSABLE_SERVICES_ENABLED='false'
  try{const closedReplay=await spend(g.path+'/orders',g.key,'POST',{service_id:f.service,order:a.checkout});assert.equal(closedReplay.status,200);assert.equal(closedReplay.body.order.id,created.body.order.id)}
  finally{process.env.CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED='true';process.env.CLAWDMARKET_REUSABLE_SERVICES_ENABLED='true'}
  await call(f.privatePath,f.providerOwner,'DELETE',{share_id:s.share.id})
  const handlerFile=join(directory,`${created.body.trade.id}.spending-handler.mjs`);await writeFile(handlerFile,`export default async()=>({summary:'Completed the delegated exact private purchase.',artifact:{result:'Original approved private result'}})`)
  const command=['scripts/provider-worker.mjs','--trade-id',created.body.trade.id,'--service-id',f.service,'--state-dir',join(directory,created.body.trade.id),'--handler',handlerFile]
  const run=promisify(execFile),options={cwd:process.cwd(),env:{...process.env,BASE_URL:baseUrl,CLAWDMARKET_PROVIDER_API_KEY:f.providerKey}}
  const delivered=JSON.parse((await run(process.execPath,command,options)).stdout);assert.equal(delivered.state,'delivered');assert.equal(JSON.parse((await run(process.execPath,command,options)).stdout).delivery_id,delivered.delivery_id)
  assert.equal((await spend(`/api/trades/${created.body.trade.id}/confirm`,g.key,'POST',{content_hash:delivered.content_hash})).status,401)
  assert.equal((await call(g.path,f.owner,'DELETE',{account_id:g.account.id})).status,200)
  assert.equal((await call(`/api/trades/${created.body.trade.id}/confirm`,f.key,'POST',{content_hash:delivered.content_hash},true)).status,200)
  const {creditBalance}=await import('@/lib/account-credit');assert.equal((await creditBalance(f.seller)).available_minor,100);assert.equal((await creditBalance(f.buyer)).escrow_minor,0)
  assert.equal((await spend(g.path+'/orders',g.key,'POST',{service_id:f.service,order:a.checkout})).status,401)
  assert.equal((await spend(g.path+'/orders?order_id='+created.body.order.id,g.key,'GET')).status,401)
  const recovered=await buy(f,a.checkout);assert.equal(recovered.body.order.id,created.body.order.id)
  const history=await call(g.path,f.owner),originalAccount=history.body.spending_accounts.find((entry:{account:{id:string}})=>entry.account.id===g.account.id)
  assert.equal(originalAccount.uses.length,1);assert.equal(originalAccount.uses[0].amount_minor,105)
  const {publicTradeAvailable}=await import('@/lib/public-trade-visibility');assert.equal(await publicTradeAvailable(created.body.trade.id),false)
  assert.deepEqual(await counts(f),{orders:1,capacity:0})
})

test('real credit refunds do not recycle fee-inclusive spending-account purchase/day/month/lifetime ceilings',{skip:!process.env.CLAWDMARKET_TEST_ANVIL_BINARY},async()=>{
  for(const [field,code] of [['max_purchase','SPENDING_PURCHASE_LIMIT'],['max_daily','SPENDING_DAILY_LIMIT'],['max_monthly','SPENDING_MONTHLY_LIMIT'],['max_lifetime','SPENDING_LIFETIME_LIMIT']] as const){
    const f=await fixture(),g=await spendingGrant(f,{max_purchase:'4.20',max_daily:'4.20',max_monthly:'4.20',max_lifetime:'4.20',[field]:field==='max_purchase'?'1.04':'1.05'})
    const order=()=>({client_reference:crypto.randomUUID(),objective:'Buy exactly approved work within delegated ceilings',input:{},payment_rail:'credit',max_total:'1.05'})
    const a=await approved(f,{order:order()}),b=await approved(f,{order:order()})
    await depositBacked(f,210)
    const original=await spend(g.path+'/orders',g.key,'POST',{service_id:f.service,order:a.checkout})
    if(field==='max_purchase'){assert.equal(original.body.error_code,code);assert.deepEqual(await counts(f),{orders:0,capacity:0});continue}
    assert.equal(original.status,201,JSON.stringify(original.body))
    const blocked=await spend(g.path+'/orders',g.key,'POST',{service_id:f.service,order:b.checkout});assert.equal(blocked.body.error_code,code,JSON.stringify(blocked.body))
    assert.equal((await call(`/api/trades/${original.body.trade.id}/dispute`,`clawdmarket-test-${f.agent}`,'POST',{reason:'Controlled original funded service failure'},true)).status,200)
    const previousAdmin=process.env.ADMIN_USER_IDS;process.env.ADMIN_USER_IDS=f.owner
    try{const resolved=await call(`/api/trades/${original.body.trade.id}/resolve`,f.owner,'POST',{resolution:'buyer'});assert.equal(resolved.status,200,JSON.stringify(resolved.body))}
    finally{if(previousAdmin===undefined)delete process.env.ADMIN_USER_IDS;else process.env.ADMIN_USER_IDS=previousAdmin}
    const {creditBalance}=await import('@/lib/account-credit');assert.equal((await creditBalance(f.buyer)).available_minor,205);assert.equal((await creditBalance(f.buyer)).escrow_minor,0)
    const repeated=await spend(g.path+'/orders',g.key,'POST',{service_id:f.service,order:b.checkout});assert.equal(repeated.body.error_code,code)
    const originalReplay=await spend(g.path+'/orders',g.key,'POST',{service_id:f.service,order:a.checkout});assert.equal(originalReplay.body.order.id,original.body.order.id)
    const history=await call(g.path,f.owner);assert.equal(history.body.spending_accounts[0].uses.length,1);assert.equal(history.body.spending_accounts[0].uses[0].amount_minor,105)
    assert.deepEqual(await counts(f),{orders:1,capacity:0})
  }
})

test('a valid spending credential cannot bypass service allowlists or remaining buyer and department policies',{skip:!process.env.CLAWDMARKET_TEST_ANVIL_BINARY},async()=>{
  const f=await fixture(),other=await fixture(),g=await spendingGrant(f,{allowed_services:[{service_id:other.service,provider_share_id:null}]})
  const a=await approved(f,{order:{client_reference:crypto.randomUUID(),objective:'Only the exact approved allowed service can be bought',input:{},payment_rail:'credit',max_total:'1.05'}})
  assert.equal((await spend(g.path+'/orders',g.key,'POST',{service_id:f.service,order:a.checkout})).body.error_code,'SPENDING_SERVICE_SCOPE_MISMATCH')
  const valid=await spendingGrant(f)
  await depositBacked(f)
  await db.update(schema.buyer_spend_policies).set({policy_json:'{"approval_required_above":50,"max_per_execution":104}'}).where(eq(schema.buyer_spend_policies.buyer_id,f.buyer))
  assert.equal((await spend(valid.path+'/orders',valid.key,'POST',{service_id:f.service,order:a.checkout})).body.error_code,'BUYER_PER_EXECUTION_LIMIT')
  await db.update(schema.buyer_spend_policies).set({policy_json:'{"approval_required_above":50}'}).where(eq(schema.buyer_spend_policies.buyer_id,f.buyer))
  const now=new Date();await db.insert(schema.organization_team_budgets).values({team_id:f.team,organization_id:f.id,max_per_execution_minor:104,version:1,created_at:now,updated_at:now})
  const failed=await spend(valid.path+'/orders',valid.key,'POST',{service_id:f.service,order:a.checkout});assert.equal(failed.body.error_code,'TEAM_PER_EXECUTION_LIMIT',JSON.stringify(failed.body))
  assert.deepEqual(await counts(f),{orders:0,capacity:0});assert.equal((await db.select().from(schema.organization_spending_uses).where(eq(schema.organization_spending_uses.account_id,valid.account.id))).length,0)
})

test('independent spending-key processes reserve one original order and cannot race two approvals past the same gross grant',{skip:!process.env.CLAWDMARKET_TEST_ANVIL_BINARY},async()=>{
  for(const same of [true,false]){
    const f=await fixture(),g=await spendingGrant(f),makeOrder=()=>({client_reference:crypto.randomUUID(),objective:'Spend only the approved single grant allowance',input:{},payment_rail:'credit',max_total:'1.05'})
    const a=await approved(f,{order:makeOrder()}),b=same?a:await approved(f,{order:makeOrder()});await depositBacked(f,210)
    const code=`(async()=>{const {NextRequest}=await import('next/server'),{resolveSpendingAccount}=await import('./lib/organization-spending-accounts.ts'),{reserveServiceOrder}=await import('./lib/service-order-reservation.ts'),{serviceOrderInput}=await import('./lib/service-definitions.ts');const a=JSON.parse(process.argv[1]);try{const evidence=await resolveSpendingAccount(new NextRequest('http://127.0.0.1/api/organizations/'+a.org+'/spending-accounts/orders',{headers:{Authorization:'Bearer '+a.key}}),a.org);const r=await reserveServiceOrder({serviceId:a.service,principal:{userId:a.buyer,agentId:a.agent,kind:'registered-agent',usesCookieAuth:false},request:serviceOrderInput.parse(a.order),organizationSpendingEvidence:evidence});console.log(JSON.stringify({order:r.order.id,trade:r.trade.id}))}catch(e){console.log(JSON.stringify({error:e.code||e.message}))}finally{(await import('./lib/db.ts')).db.$client.close()}})().catch(e=>{console.error(e);process.exitCode=1})`
    const run=promisify(execFile),results=await Promise.allSettled([a,a,b].map(purchase=>run(process.execPath,['--conditions=react-server','--import','tsx','-e',code,JSON.stringify({org:f.id,key:g.key,service:f.service,buyer:f.buyer,agent:f.agent,order:purchase.checkout})],{cwd:process.cwd(),env:process.env})))
    const responses=results.map(result=>{if(result.status!=='fulfilled')throw result.reason;return JSON.parse(result.value.stdout)})
    const successful=responses.filter(row=>row.order);assert.ok(successful.length>0,JSON.stringify(responses));assert.equal(new Set(successful.map(row=>row.order)).size,1)
    if(same)assert.equal(successful.length,3);else assert.ok(responses.some(row=>row.error==='SPENDING_DAILY_LIMIT'),JSON.stringify(responses))
    const uses=await db.select().from(schema.organization_spending_uses).where(eq(schema.organization_spending_uses.account_id,g.account.id));assert.equal(uses.length,1);assert.equal(uses[0].amount_minor,105)
    const {creditBalance}=await import('@/lib/account-credit');assert.equal((await creditBalance(f.buyer)).available_minor,105);assert.equal((await creditBalance(f.buyer)).escrow_minor,100)
    assert.deepEqual(await counts(f),{orders:1,capacity:1})
    // Original use reconciliation must fail closed if an immutable ledger row is missing or contradicts its original order.
    const winning=successful[0]
    const fresh=await approved(f,{order:makeOrder()})
    await db.delete(schema.organization_spending_uses).where(eq(schema.organization_spending_uses.order_id,winning.order))
    const missing=await spend(g.path+'/orders',g.key,'POST',{service_id:f.service,order:fresh.checkout});assert.equal(missing.body.error_code,'SPENDING_USAGE_INVALID')
    await db.insert(schema.organization_spending_uses).values(uses[0])
    await db.update(schema.organization_spending_uses).set({amount_minor:1}).where(eq(schema.organization_spending_uses.order_id,winning.order))
    const corrupt=await spend(g.path+'/orders',g.key,'POST',{service_id:f.service,order:fresh.checkout});assert.equal(corrupt.body.error_code,'SPENDING_USAGE_INVALID')
    assert.deepEqual(await counts(f),{orders:1,capacity:1});assert.equal((await creditBalance(f.buyer)).available_minor,105)
  }
})

test('SIGKILL before and after spending grant and funded checkout commits preserves once-issued credentials and original gross use',{skip:!process.env.CLAWDMARKET_TEST_ANVIL_BINARY},async()=>{
  for(const operation of ['grant','checkout'] as const)for(const boundary of ['before','after'] as const){
    const f=await fixture(),input={version:1,client_reference:crypto.randomUUID(),name:'Crash-bounded purchasing',buyer_agent_id:f.agent,team_id:f.team,cost_center:'ENGINEERING',
      allowed_services:[{service_id:f.service,provider_share_id:null}],max_purchase:'1.05',max_daily:'1.05',max_monthly:'1.05',max_lifetime:'1.05',expires_at:new Date(Date.now()+3600_000).toISOString()}
    let key:string|undefined,accountId:string|undefined,checkout:unknown
    if(operation==='checkout'){
      const g=await spendingGrant(f);key=g.key;accountId=g.account.id;checkout=(await approved(f,{order:{client_reference:crypto.randomUUID(),objective:'Recover the exactly approved spending order',input:{},payment_rail:'credit',max_total:'1.05'}})).checkout
      await depositBacked(f)
    }
    const marker=join(directory,`spending-${operation}-${boundary}-${f.id}.marker`),args={f,input,key,accountId,checkout}
    const code=`(async()=>{const {writeFile}=await import('node:fs/promises'),a=JSON.parse(process.argv[1]);const stop=async()=>{await writeFile(process.argv[2],'boundary');await new Promise(()=>{})};
      ${boundary==='before'?"const {db}=await import('./lib/db.ts'),proto=Object.getPrototypeOf(db.session),original=proto.transaction;proto.transaction=function(fn,c){return original.call(this,async tx=>{const r=await fn(tx);await stop();return r},c)};":''}
      const d=await import('./lib/organization-spending-accounts.ts');
      ${operation==='grant'?"await d.createSpendingAccount(a.f.id,a.f.owner,d.spendingAccountInput.parse(a.input))":"const {NextRequest}=await import('next/server'),{reserveServiceOrder}=await import('./lib/service-order-reservation.ts'),{serviceOrderInput}=await import('./lib/service-definitions.ts');const evidence=await d.resolveSpendingAccount(new NextRequest('http://127.0.0.1/api/organizations/'+a.f.id+'/spending-accounts/orders',{headers:{Authorization:'Bearer '+a.key}}),a.f.id);await reserveServiceOrder({serviceId:a.f.service,principal:{userId:a.f.buyer,agentId:a.f.agent,kind:'registered-agent',usesCookieAuth:false},request:serviceOrderInput.parse(a.checkout),organizationSpendingEvidence:evidence})"};await stop()})().catch(e=>{console.error(e);process.exitCode=1})`
    const child=spawn(process.execPath,['--conditions=react-server','--import','tsx','-e',code,JSON.stringify(args),marker],{cwd:process.cwd(),env:process.env,stdio:['ignore','ignore','pipe']})
    let errors='';child.stderr.on('data',chunk=>{errors+=chunk});const exited=new Promise<void>((done,reject)=>{child.once('exit',()=>done());child.once('error',reject)})
    try{
      let reached=false;for(let wait=0;wait<150;wait++){try{await readFile(marker);reached=true;break}catch{}if(child.exitCode!==null)throw Error(errors);await new Promise(done=>setTimeout(done,100))}
      assert.equal(reached,true,errors);child.kill('SIGKILL');await exited
      if(operation==='grant'){
        const rows=await db.select().from(schema.organization_spending_accounts).where(eq(schema.organization_spending_accounts.organization_id,f.id));assert.equal(rows.length,boundary==='before'?0:1)
        const recovered=await call(`/api/organizations/${f.id}/spending-accounts`,f.owner,'POST',input)
        assert.equal(recovered.status,boundary==='before'?201:200)
        if(boundary==='after'){assert.equal(recovered.body.api_key,null);assert.equal(recovered.body.account.id,rows[0].id)
          // A committed but lost once-only key cannot be reissued: explicitly revoke it and create new authority.
          await call(`/api/organizations/${f.id}/spending-accounts`,f.owner,'DELETE',{account_id:rows[0].id})
          assert.equal((await call(`/api/organizations/${f.id}/spending-accounts`,f.owner,'POST',{...input,client_reference:crypto.randomUUID()})).status,201)}
      }else{
        const {creditBalance}=await import('@/lib/account-credit');assert.equal((await creditBalance(f.buyer)).available_minor,boundary==='before'?105:0)
        const prior=await db.select().from(schema.organization_spending_uses).where(eq(schema.organization_spending_uses.account_id,accountId!));assert.equal(prior.length,boundary==='before'?0:1)
        const recovered=await spend(`/api/organizations/${f.id}/spending-accounts/orders`,key!,'POST',{service_id:f.service,order:checkout});assert.ok([200,201].includes(recovered.status),JSON.stringify(recovered.body))
        if(prior.length)assert.equal(recovered.body.order.id,prior[0].order_id)
        const final=await db.select().from(schema.organization_spending_uses).where(eq(schema.organization_spending_uses.account_id,accountId!));assert.equal(final.length,1);assert.equal(final[0].amount_minor,105)
        assert.equal((await creditBalance(f.buyer)).available_minor,0);assert.equal((await creditBalance(f.buyer)).escrow_minor,100);assert.deepEqual(await counts(f),{orders:1,capacity:1})
      }
    }finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await exited}
  }
})

test('UTC month and day changes renew only their respective spending windows while original lifetime uses remain charged',{skip:!process.env.CLAWDMARKET_TEST_ANVIL_BINARY},async context=>{
  const f=await fixture();await depositBacked(f,315)
  const now=new Date(),monthEnd=Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,0,23,59,50)
  context.mock.timers.enable({apis:['Date'],now:monthEnd})
  try{
    const g=await spendingGrant(f,{max_lifetime:'3.15',expires_at:new Date(monthEnd+3*86400_000).toISOString()}),order=()=>({client_reference:crypto.randomUUID(),objective:'Book approved service credit in its original UTC window',input:{},payment_rail:'credit',max_total:'1.05'})
    const a=await approved(f,{order:order()}),first=await spend(g.path+'/orders',g.key,'POST',{service_id:f.service,order:a.checkout});assert.equal(first.status,201,JSON.stringify(first.body))
    context.mock.timers.setTime(monthEnd+120000)
    const b=await approved(f,{order:order()}),second=await spend(g.path+'/orders',g.key,'POST',{service_id:f.service,order:b.checkout});assert.equal(second.status,201,JSON.stringify(second.body))
    const c=await approved(f,{order:order()}),sameDay=await spend(g.path+'/orders',g.key,'POST',{service_id:f.service,order:c.checkout});assert.equal(sameDay.body.error_code,'SPENDING_DAILY_LIMIT')
    context.mock.timers.setTime(monthEnd+86400_000+120000)
    const d=await approved(f,{order:order()}),nextDay=await spend(g.path+'/orders',g.key,'POST',{service_id:f.service,order:d.checkout});assert.equal(nextDay.body.error_code,'SPENDING_MONTHLY_LIMIT')
    const history=await call(g.path,f.owner);assert.equal(history.body.spending_accounts[0].uses.length,2);assert.equal(history.body.spending_accounts[0].uses.reduce((total:number,use:{amount_minor:number})=>total+use.amount_minor,0),210)
    assert.deepEqual(await counts(f),{orders:2,capacity:2})
  }finally{context.mock.timers.reset()}
})

test('current owner history retains original attribution and consumed IDs after reassignment and revocation, omitting private payloads', async () => {
  const f = await fixture(), a = await approved(f), spending = await spendingGrant(f), original = await buy(f, a.checkout)
  assert.equal(original.status, 201)
  const before = await counts(f)
  await db.update(schema.organization_agent_assignments).set({ team_id: f.otherTeam, cost_center: 'RESEARCH' })
    .where(eq(schema.organization_agent_assignments.agent_id, f.agent))
  assert.equal((await call(f.prefix + '/roles', f.owner, 'DELETE', { role_id: a.reviewer.row.id })).status, 200)
  assert.equal((await call(a.path + '/approval', f.owner, 'DELETE')).status, 200)
  process.env.CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED = 'false'
  try {
    const result = await call(f.prefix + '/requests', f.owner)
    assert.equal(result.status, 200); assert.equal(result.headers.get('cache-control'), 'private, no-store')
    assert.equal(result.body.next_cursor, null); assert.equal(result.body.purchases.length, 1)
    const item = result.body.purchases[0]
    assert.equal(item.request.team_id, f.team); assert.equal(item.request.cost_center, 'ENGINEERING')
    assert.equal(item.approval.state, 'revoked'); assert.equal(item.use.order_id, original.body.order.id)
    assert.equal(item.use.trade_id, original.body.trade.id); assert.equal(item.request.amount_minor, 105)
    const payload = JSON.stringify(result.body)
    for (const secret of ['private_code', 'const result = 42', 'order_json', 'request_hash', 'owner_account_id', 'requester_account_id', f.key]) assert.equal(payload.includes(secret), false, secret)
    assert.deepEqual(await counts(f), before)
    for (const account of [f.viewer, f.requester, f.reviewer]) assert.equal((await call(f.prefix + '/requests', account)).status, 404)
    assert.equal((await call(f.prefix + '/requests', f.key, 'GET', undefined, true)).status, 401)
    assert.equal((await spend(f.prefix + '/requests', spending.key, 'GET')).status, 401)
    assert.equal((await fetch(baseUrl + f.prefix + '/requests')).status, 401)
    const { createOrganizationServiceAccount } = await import('@/lib/organization-service-accounts')
    process.env.CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED = 'true'
    const key = await createOrganizationServiceAccount(f.id, f.owner, { client_reference: crypto.randomUUID(), name: 'History read isolation', lifetime_days: 1 })
    assert.equal(key.kind, 'ok'); if (key.kind !== 'ok') throw Error('Read key fixture failed')
    assert.equal((await fetch(baseUrl + f.prefix + '/requests', { headers: { Authorization: `Bearer ${key.api_key}` } })).status, 401)
  } finally { process.env.CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED = 'true' }
  await db.update(schema.organization_purchase_uses).set({ amount_minor: 104 }).where(eq(schema.organization_purchase_uses.approval_id, a.approval.id))
  assert.equal((await call(f.prefix + '/requests', f.owner)).body.error_code, 'PURCHASE_HISTORY_INTEGRITY')
  await db.update(schema.organization_purchase_uses).set({ amount_minor: 105 }).where(eq(schema.organization_purchase_uses.approval_id, a.approval.id))
  await db.update(schema.organizations).set({ owner_account_id: f.viewer }).where(eq(schema.organizations.id, f.id))
  assert.equal((await call(f.prefix + '/requests', f.owner)).status, 404)
  assert.equal((await call(f.prefix + '/requests', f.viewer)).body.purchases[0].use.trade_id, original.body.trade.id)
})

test('owner history pagination is bounded, tied by original ID, rejects foreign cursors and fails closed on contradictory original references', async () => {
  const f = await fixture(), a = await approved(f), q = await quote(f), other = await fixture(), foreign = await quote(other)
  const same = new Date(1700000000000)
  await db.update(schema.organization_purchase_requests).set({ created_at: same }).where(eq(schema.organization_purchase_requests.organization_id, f.id))
  const sorted = [a.row.id, q.row.id].sort().reverse()
  const first = await call(f.prefix + '/requests?limit=1', f.owner)
  assert.equal(first.body.purchases[0].request.id, sorted[0]); assert.equal(first.body.next_cursor, sorted[0])
  const second = await call(f.prefix + `/requests?limit=1&cursor=${first.body.next_cursor}`, f.owner)
  assert.equal(second.body.purchases[0].request.id, sorted[1]); assert.equal(second.body.next_cursor, null)
  for (const query of ['limit=0', 'limit=51', 'limit=1.5', 'limit=no', 'cursor=no', `cursor=${foreign.row.id}`, `cursor=${crypto.randomUUID()}`, 'unknown=yes'])
    assert.equal((await call(f.prefix + '/requests?' + query, f.owner)).status, 400, query)
  await db.update(schema.organization_purchase_approvals).set({ request_hash: 'f'.repeat(64) }).where(eq(schema.organization_purchase_approvals.id, a.approval.id))
  const broken = await call(f.prefix + '/requests', f.owner)
  assert.equal(broken.status, 503); assert.equal(broken.body.error_code, 'PURCHASE_HISTORY_INTEGRITY')
  assert.equal(broken.body.purchases, undefined); assert.deepEqual(await counts(f), { orders: 0, capacity: 0 })
})

function enterpriseWallet(){assert.ok(enterpriseChain);return createWalletClient({chain:enterpriseChain.client.chain,account:payer,transport:http(enterpriseChain.url)})}
function externalTerms(mutation={}){
  const chain=enterpriseChain
  assert.ok(chain)
  return {rail:'evm',chain_id:1,token_address:chain.token,payer_address:payer.address,treasury_address:chain.treasury,
    minimum_token_reserve_units:'1000000',minimum_native_reserve_wei:'1000000000000000',max_gas_cost_wei:'1000000000000000',max_lifetime_gas_cost_wei:'1000000000000000',...mutation}
}
async function externalGrant(f:Fixture,mutation={}){return spendingGrant(f,{version:2,payment:externalTerms(),...mutation})}
async function externalCheckout(f:Fixture,g:Awaited<ReturnType<typeof externalGrant>>,order=privateOrder(g.input.allowed_services[0].provider_share_id!)){
  const a=await approved(f,{order:{...order,provider_share_id:g.input.allowed_services[0].provider_share_id??undefined}})
  const result=await spend(g.path+'/orders',g.key,'POST',{service_id:f.service,order:a.checkout});assert.equal(result.status,201,JSON.stringify(result.body))
  return {...a,...result.body,paymentPath:g.path+'/orders/'+result.body.trade.id+'/fund/evm'}
}
async function signedPurchase(f:Fixture,c:Awaited<ReturnType<typeof externalCheckout>>,key:string){
  const chain=enterpriseChain
  assert.ok(chain)
  const operation=crypto.randomUUID(),body={chain_id:1,token_address:chain.token,payer_address:payer.address,buyer_operation_id:operation}
  const created=await spend(c.paymentPath+'/intent',key,'POST',body);assert.equal(created.status,201,JSON.stringify(created.body))
  const intent=created.body.intent,wallet=createWalletClient({chain:chain.client.chain,account:payer,transport:http(chain.url)})
  const prepared=await wallet.prepareTransactionRequest({to:chain.token,data:encodeFunctionData({abi:erc20Abi,functionName:'transfer',args:[chain.treasury,BigInt(intent.token_amount)]}),gas:70_000n})
  const raw:Hex=await wallet.signTransaction(prepared)
  const hash=keccak256(raw),{evmPaymentProofMessage}=await import('@/lib/evm-payment-proof')
  const signature=await payer.signMessage({message:evmPaymentProofMessage(intent,hash)})
  const claim={intent_id:intent.id,mandate_id:c.order.organization_spending_account_id,buyer_operation_id:operation,serialized_transaction:raw,payer_signature:signature}
  return {body,intent,raw,hash,claim,wallet,proof:{intent_id:intent.id,chain_id:1,token_address:chain.token,payer_address:payer.address,tx_hash:hash,payer_signature:signature}}
}

test('delegated EVM terms require a new reviewed grant; legacy credit and read credentials retain their scope',{skip:!process.env.CLAWDMARKET_TEST_ANVIL_BINARY},async()=>{
  const f=await fixture(),credit=await spendingGrant(f),g=await externalGrant(f)
  assert.equal(g.account.version,2);assert.equal(g.account.authority,'approved_direct_service_evm');assert.equal(g.account.payment.payer_address,payer.address.toLowerCase())
  const replay=await call(g.path,f.owner,'POST',g.input);assert.equal(replay.status,200);assert.equal(replay.body.api_key,null)
  assert.equal((await call(g.path,f.owner,'POST',{...g.input,payment:externalTerms({max_gas_cost_wei:'1'})})).body.error_code,'SPENDING_REFERENCE_CONFLICT')
  assert.equal((await call(g.path,f.owner,'POST',{...credit.input,payment:externalTerms()})).status,400)
  const a=await approved(f)
  assert.equal((await spend(credit.path+'/orders',credit.key,'POST',{service_id:f.service,order:a.checkout})).body.error_code,'SPENDING_EXACT_CREDIT_APPROVAL_REQUIRED')
  const creditApproval=await approved(f,{order:{...a.input.order,client_reference:crypto.randomUUID(),payment_rail:'credit'}})
  assert.equal((await spend(g.path+'/orders',g.key,'POST',{service_id:f.service,order:creditApproval.checkout})).body.error_code,'SPENDING_EXACT_EXTERNAL_APPROVAL_REQUIRED')
  for(const changed of [{chain_id:8453},{treasury_address:payer.address},{max_gas_cost_wei:'0'},{rail:'mpp'}])assert.ok((await call(g.path,f.owner,'POST',{...g.input,client_reference:crypto.randomUUID(),payment:externalTerms(changed)})).status>=400)
  assert.deepEqual(await counts(f),{orders:0,capacity:0})
})

test('delegated EVM checkout enforces fixed wallet terms, reserves, exact bytes, current ceilings and original claims',{skip:!process.env.CLAWDMARKET_TEST_ANVIL_BINARY},async()=>{
  const chain=enterpriseChain
  const f=await fixture(),g=await externalGrant(f),c=await externalCheckout(f,g),signed=await signedPurchase(f,c,g.key)
  assert.equal(c.trade.status,'pending');assert.equal(c.order.state,'awaiting_funding')
  const foreign=await fixture(),other=await externalGrant(foreign)
  assert.equal((await spend(c.paymentPath+'/intent',other.key,'GET')).status,401)
  assert.equal((await spend(`/api/trades/${c.trade.id}/fund/evm/intent`,g.key,'GET')).status,401)
  const [use]=await db.select().from(schema.organization_spending_uses).where(eq(schema.organization_spending_uses.account_id,g.account.id));assert.equal(use.amount_minor,105)
  const wrongWallet=privateKeyToAccount(`0x${'19'.repeat(32)}`).address
  const f2=await fixture(),g2=await externalGrant(f2),c2=await externalCheckout(f2,g2)
  assert.equal((await spend(c2.paymentPath+'/intent',g2.key,'POST',{...signed.body,payer_address:wrongWallet,buyer_operation_id:crypto.randomUUID()})).status,409)
  assert.equal((await spend(c2.paymentPath+'/intent',g2.key,'POST',{chain_id:1,token_address:chain!.token,payer_address:payer.address})).body.error_code,'INVALID_SPENDING_PAYMENT')
  const wallet=signed.wallet
  const invalid=await wallet.signTransaction(await wallet.prepareTransactionRequest({to:chain!.token,data:encodeFunctionData({abi:erc20Abi,functionName:'transfer',args:[payer.address,1_050_000n]}),gas:70_000n}))
  assert.equal((await spend(c.paymentPath+'/claim',g.key,'POST',{...signed.claim,serialized_transaction:invalid})).body.error_code,'BUYER_TRANSACTION_SCOPE_MISMATCH')
  await db.update(schema.organization_team_budgets).set({max_per_execution_minor:104}).where(eq(schema.organization_team_budgets.team_id,f.team))
  // A new department ceiling is enforced on an already reserved purchase.
  const now=new Date();await db.insert(schema.organization_team_budgets).values({team_id:f.team,organization_id:f.id,max_per_execution_minor:104,version:1,created_at:now,updated_at:now}).onConflictDoUpdate({target:schema.organization_team_budgets.team_id,set:{max_per_execution_minor:104}})
  const restricted=await spend(c.paymentPath+'/claim',g.key,'POST',signed.claim);assert.equal(restricted.body.error_code,'TEAM_PER_EXECUTION_LIMIT',JSON.stringify(restricted.body))
  await db.update(schema.organization_team_budgets).set({max_per_execution_minor:200}).where(eq(schema.organization_team_budgets.team_id,f.team))
  const balance=await chain!.balance(payer.address)
  const {spendingAccountInput,createSpendingAccount}=await import('@/lib/organization-spending-accounts')
  const f3=await fixture(),reserve=await createSpendingAccount(f3.id,f3.owner,spendingAccountInput.parse({...g.input,client_reference:crypto.randomUUID(),buyer_agent_id:f3.agent,team_id:f3.team,allowed_services:[{service_id:f3.service,provider_share_id:null}],payment:externalTerms({minimum_token_reserve_units:balance.toString()})}))
  const reserveGrant={...g,key:reserve.api_key!,account:reserve.account,path:`/api/organizations/${f3.id}/spending-accounts`,input:{...g.input,allowed_services:[{service_id:f3.service,provider_share_id:null}]}}
  const c3=await externalCheckout(f3,reserveGrant),s3=await signedPurchase(f3,c3,reserveGrant.key)
  assert.equal((await spend(c3.paymentPath+'/claim',reserveGrant.key,'POST',s3.claim)).body.error_code,'BUYER_TOKEN_RESERVE_REQUIRED')
  const claimed=await spend(c.paymentPath+'/claim',g.key,'POST',signed.claim);assert.equal(claimed.status,200,JSON.stringify(claimed.body));assert.equal(claimed.body.send_allowed,true)
  assert.equal((await spend(c.paymentPath+'/claim',g.key,'POST',signed.claim)).body.idempotent,true)
  assert.equal((await spend(c.paymentPath+'/intent',g.key,'GET')).body.claim.tx_hash,signed.hash)
  const second=await signedPurchase(f2,c2,g2.key)
  assert.equal((await spend(c2.paymentPath+'/claim',g2.key,'POST',second.claim)).body.error_code,'BUYER_WALLET_PAYMENT_UNRECONCILED')
  await call(g.path,f.owner,'DELETE',{account_id:g.account.id})
  assert.equal((await spend(c.paymentPath+'/claim',g.key,'POST',signed.claim)).status,401)
  const original=await call(`/api/trades/${c.trade.id}/fund/evm/claim`,f.key,'POST',signed.claim,true);assert.equal(original.status,200);assert.equal(original.body.send_allowed,false);assert.equal(original.body.claim.tx_hash,signed.hash)
  // Reconcile the original broadcast even when the delegation is revoked.
  await wallet.sendRawTransaction({serializedTransaction:signed.raw});await chain!.client.waitForTransactionReceipt({hash:signed.hash})
  const recovered=await call(`/api/trades/${c.trade.id}/fund/evm`,f.key,'POST',signed.proof,true);assert.ok([200,202].includes(recovered.status),JSON.stringify(recovered.body))
  assert.equal(recovered.body.trade.payout_status,'refunded');assert.equal(await chain!.balance(payer.address),balance)
  const [claim]=await db.select().from(schema.organization_spending_payment_claims).where(eq(schema.organization_spending_payment_claims.trade_id,c.trade.id));assert.equal(claim.state,'confirmed')
  assert.deepEqual(await counts(f),{orders:1,capacity:0})
})

test('real delegated EVM private purchase completes provider restart, explicit buyer review and exactly one seller payout',{skip:!process.env.CLAWDMARKET_TEST_ANVIL_BINARY},async()=>{
  const chain=enterpriseChain
  assert.ok(chain)
  const f=await privateFixture(),share=await shared(f),g=await externalGrant(f,{allowed_services:[{service_id:f.service,provider_share_id:share.share.id}]})
  const c=await externalCheckout(f,g),signed=await signedPurchase(f,c,g.key)
  const buyerBefore=await chain.balance(payer.address),sellerAddress=privateKeyToAccount(`0x${'19'.repeat(32)}`).address,sellerBefore=await chain.balance(sellerAddress)
  const claimed=await spend(c.paymentPath+'/claim',g.key,'POST',signed.claim);assert.equal(claimed.body.send_allowed,true,JSON.stringify(claimed.body))
  await signed.wallet.sendRawTransaction({serializedTransaction:signed.raw});await chain.client.waitForTransactionReceipt({hash:signed.hash})
  const funded=await spend(c.paymentPath+'/proof',g.key,'POST',signed.proof);assert.equal(funded.status,200,JSON.stringify(funded.body));assert.equal(funded.body.trade.status,'escrow_held')
  assert.equal((await spend(c.paymentPath+'/proof',g.key,'POST',signed.proof)).body.idempotent,true)
  await call(f.privatePath,f.providerOwner,'DELETE',{share_id:share.share.id})
  await call(g.path,f.owner,'DELETE',{account_id:g.account.id})
  const handler=join(directory,`${c.trade.id}.external-handler.mjs`);await writeFile(handler,`export default async()=>({summary:'Reviewed the original delegated private input.',artifact:{result:'Approved delegated review result'}})`)
  const command=['scripts/provider-worker.mjs','--trade-id',c.trade.id,'--service-id',f.service,'--state-dir',join(directory,c.trade.id),'--handler',handler]
  const options={cwd:process.cwd(),env:{...process.env,BASE_URL:baseUrl,CLAWDMARKET_PROVIDER_API_KEY:f.providerKey}},run=promisify(execFile)
  const first=JSON.parse((await run(process.execPath,command,options)).stdout),restarted=JSON.parse((await run(process.execPath,command,options)).stdout)
  assert.equal(first.state,'delivered');assert.equal(restarted.delivery_id,first.delivery_id)
  assert.equal((await spend(`/api/trades/${c.trade.id}/confirm`,g.key,'POST',{content_hash:first.content_hash})).status,401)
  const confirmed=await call(`/api/trades/${c.trade.id}/confirm`,f.key,'POST',{content_hash:first.content_hash},true);assert.equal(confirmed.status,200,JSON.stringify(confirmed.body))
  assert.equal(await chain.balance(payer.address),buyerBefore-1_050_000n);assert.equal(await chain.balance(sellerAddress),sellerBefore+1_000_000n)
  const transfers=await db.select().from(schema.settlement_transfers).where(eq(schema.settlement_transfers.trade_id,c.trade.id));assert.equal(transfers.length,1);assert.equal(transfers[0].status,'confirmed')
  const history=await call(g.path,f.owner);assert.equal(history.body.spending_accounts[0].uses[0].trade_id,c.trade.id)
  const {publicTradeAvailable}=await import('@/lib/public-trade-visibility');assert.equal(await publicTradeAvailable(c.trade.id),false)
  assert.deepEqual(await counts(f),{orders:1,capacity:0})
})

test('delegated EVM SIGKILL at intent, claim, broadcast and verified receipt boundaries preserves one original payment and refund',{skip:!process.env.CLAWDMARKET_TEST_ANVIL_BINARY},async()=>{
  const chain=enterpriseChain;assert.ok(chain)
  for(const operation of ['intent','claim','broadcast','proof'] as const)for(const boundary of operation==='broadcast'?['after'] as const:['before','after'] as const){
    const f=await fixture(),g=await externalGrant(f),c=await externalCheckout(f,g),buyerBefore=await chain.balance(payer.address)
    const body:{chain_id:number;token_address:Hex;payer_address:Hex;buyer_operation_id:string}={chain_id:1,token_address:chain.token,payer_address:payer.address,buyer_operation_id:crypto.randomUUID()}
    let signed:Awaited<ReturnType<typeof signedPurchase>>|undefined
    if(operation!=='intent')signed=await signedPurchase(f,c,g.key)
    if(operation==='broadcast'||operation==='proof')assert.equal((await spend(c.paymentPath+'/claim',g.key,'POST',signed!.claim)).body.send_allowed,true)
    if(operation==='proof'){await signed!.wallet.sendRawTransaction({serializedTransaction:signed!.raw});await chain.client.waitForTransactionReceipt({hash:signed!.hash})}
    const marker=join(directory,`external-${operation}-${boundary}-${f.id}.marker`),args={f,g,c,body,signed:signed?{raw:signed.raw,hash:signed.hash,claim:signed.claim,proof:signed.proof}:null,rpc:chain.url}
    const code=`(async()=>{const {writeFile}=await import('node:fs/promises'),a=JSON.parse(process.argv[1]);const stop=async()=>{await writeFile(process.argv[2],'boundary');await new Promise(()=>{})};
      ${boundary==='before'?"const {db}=await import('./lib/db.ts'),proto=Object.getPrototypeOf(db.session),original=proto.transaction;proto.transaction=function(fn,c){return original.call(this,async tx=>{const r=await fn(tx);await stop();return r},c)};":''}
      ${operation==='broadcast'?"const response=await fetch(a.rpc,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_sendRawTransaction',params:[a.signed.raw]})});const r=await response.json();if(r.result!==a.signed.hash)throw Error('Original broadcast failed');":"const {NextRequest}=await import('next/server'),api=await import('./app/api/organizations/[id]/spending-accounts/orders/[tradeId]/fund/evm/[action]/route.ts'),action='"+operation+"',input=action==='intent'?a.body:action==='claim'?a.signed.claim:a.signed.proof;const response=await api.POST(new NextRequest('http://127.0.0.1'+a.c.paymentPath+'/'+action,{method:'POST',headers:{Authorization:'Bearer '+a.g.key,'Content-Type':'application/json',Host:new URL(a.origin||'http://127.0.0.1').host},body:JSON.stringify(input)}),{params:Promise.resolve({id:a.f.id,tradeId:a.c.trade.id,action})});if(response.status>=400)throw Error(await response.text());"}
      await stop()})().catch(e=>{console.error(e);process.exitCode=1})`
    const child=spawn(process.execPath,['--conditions=react-server','--import','tsx','-e',code,JSON.stringify(args),marker],{cwd:process.cwd(),env:process.env,stdio:['ignore','ignore','pipe']})
    let errors='';child.stderr.on('data',chunk=>{errors+=chunk});const exited=new Promise<void>((done,reject)=>{child.once('exit',()=>done());child.once('error',reject)})
    try{
      let reached=false;for(let wait=0;wait<150;wait++){try{await readFile(marker);reached=true;break}catch{}if(child.exitCode!==null)throw Error(errors);await new Promise(done=>setTimeout(done,100))}
      assert.equal(reached,true,errors);child.kill('SIGKILL');await exited
      const saved=await spend(c.paymentPath+'/intent',g.key,'GET');assert.equal(saved.status,200)
      if(operation==='intent'){
        assert.equal(Boolean(saved.body.intent),boundary==='after')
        const repeated=await spend(c.paymentPath+'/intent',g.key,'POST',body);assert.equal(repeated.status,boundary==='before'?201:200);if(saved.body.intent)assert.equal(repeated.body.intent.id,saved.body.intent.id)
        // Prepare bytes for the original durable operation, never replace its intent.
        const intent=repeated.body.intent
        const wallet=enterpriseWallet()
        const raw:Hex=await wallet.signTransaction(await wallet.prepareTransactionRequest({to:chain.token,data:encodeFunctionData({abi:erc20Abi,functionName:'transfer',args:[chain.treasury,BigInt(intent.token_amount)]}),gas:70_000n})),hash=keccak256(raw)
        const signature=await payer.signMessage({message:(await import('@/lib/evm-payment-proof')).evmPaymentProofMessage(intent,hash)})
        signed={body,intent,wallet,raw,hash,claim:{intent_id:intent.id,mandate_id:g.account.id,buyer_operation_id:body.buyer_operation_id,serialized_transaction:raw,payer_signature:signature},proof:{intent_id:intent.id,chain_id:1,token_address:chain.token,payer_address:payer.address,tx_hash:hash,payer_signature:signature}}
      }
      assert.ok(signed)
      if(operation==='claim')assert.equal(Boolean(saved.body.claim),boundary==='after')
      if(operation==='intent'||operation==='claim')assert.equal((await spend(c.paymentPath+'/claim',g.key,'POST',signed.claim)).body.send_allowed,true)
      if(operation!=='proof'&&operation!=='broadcast'){await signed.wallet.sendRawTransaction({serializedTransaction:signed.raw});await chain.client.waitForTransactionReceipt({hash:signed.hash})}
      if(operation==='proof'&&boundary==='after'){
        assert.equal(saved.body.claim.state,'confirmed')
        // Already funded obligations retain buyer recovery and go through the existing dispute/refund path.
        assert.equal((await call(`/api/trades/${c.trade.id}/dispute`,`clawdmarket-test-${f.agent}`,'POST',{reason:'Reject the controlled crash acceptance fixture'},true)).status,200)
        process.env.ADMIN_USER_IDS=f.owner
        try{const resolved=await call(`/api/trades/${c.trade.id}/resolve`,f.owner,'POST',{resolution:'buyer'});assert.equal(resolved.status,200,JSON.stringify(resolved.body))}finally{delete process.env.ADMIN_USER_IDS}
      }else{
        await call(g.path,f.owner,'DELETE',{account_id:g.account.id})
        const recovered=await call(`/api/trades/${c.trade.id}/fund/evm`,f.key,'POST',signed.proof,true);assert.ok([200,202].includes(recovered.status),JSON.stringify(recovered.body));assert.equal(recovered.body.trade.payout_status,'refunded')
      }
      assert.equal(await chain.balance(payer.address),buyerBefore-(operation==='proof'&&boundary==='after'?50_000n:0n))
      if(operation==='proof'&&boundary==='after'){const next=await approved(f);assert.equal((await spend(g.path+'/orders',g.key,'POST',{service_id:f.service,order:next.checkout})).body.error_code,'SPENDING_DAILY_LIMIT')}
      const uses=await db.select().from(schema.organization_spending_uses).where(eq(schema.organization_spending_uses.account_id,g.account.id)),receipts=await db.select().from(schema.payment_receipts).where(eq(schema.payment_receipts.trade_id,c.trade.id)),claims=await db.select().from(schema.organization_spending_payment_claims).where(eq(schema.organization_spending_payment_claims.trade_id,c.trade.id)),refunds=await db.select().from(schema.settlement_transfers).where(eq(schema.settlement_transfers.trade_id,c.trade.id))
      assert.equal(uses.length,1);assert.equal(uses[0].amount_minor,105);assert.equal(receipts.length,1);assert.equal(receipts[0].tx_hash,signed.hash);assert.equal(claims.length,1);assert.equal(claims[0].state,'confirmed');assert.equal(refunds.length,1);assert.equal(refunds[0].status,'confirmed')
      assert.deepEqual(await counts(f),{orders:1,capacity:0})
    }finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await exited}
  }
})

test('delegated EVM original gross and worst-case gas exposure cannot be recycled or raced across approvals',{skip:!process.env.CLAWDMARKET_TEST_ANVIL_BINARY},async()=>{
  for(const gasBound of [false,true]){
    const f=await fixture(),g=await externalGrant(f,{max_daily:'2.10',max_monthly:'2.10',max_lifetime:gasBound?'2.10':'1.05',payment:externalTerms({max_lifetime_gas_cost_wei:gasBound?'1000000000000000':'2000000000000000'})})
    const a=await approved(f),b=await approved(f),run=promisify(execFile)
    const code=`(async()=>{const {NextRequest}=await import('next/server'),{resolveSpendingAccount}=await import('./lib/organization-spending-accounts.ts'),{reserveServiceOrder}=await import('./lib/service-order-reservation.ts'),{serviceOrderInput}=await import('./lib/service-definitions.ts'),a=JSON.parse(process.argv[1]);try{const e=await resolveSpendingAccount(new NextRequest('http://127.0.0.1',{headers:{Authorization:'Bearer '+a.key}}),a.org),r=await reserveServiceOrder({serviceId:a.service,principal:{userId:e.buyerId,agentId:e.agentId,kind:'registered-agent',usesCookieAuth:false},request:serviceOrderInput.parse(a.order),organizationSpendingEvidence:e});console.log(JSON.stringify({status:r.idempotent?200:201,body:{order:r.order,trade:r.trade}}))}catch(e){console.log(JSON.stringify({status:e.status||409,body:{error_code:e.code||e.message}}))}finally{(await import('./lib/db.ts')).db.$client.close()}})().catch(e=>{console.error(e);process.exitCode=1})`
    const results=await Promise.allSettled([a,a,b].map(purchase=>run(process.execPath,['--conditions=react-server','--import','tsx','-e',code,JSON.stringify({org:f.id,key:g.key,service:f.service,order:purchase.checkout})],{cwd:process.cwd(),env:process.env})))
    const responses=results.map(r=>{if(r.status!=='fulfilled')throw r.reason;const response=JSON.parse(r.value.stdout);if(response.status>=500)console.error(r.value.stderr);return response})
    assert.equal(responses.filter(r=>r.status===201).length,1,JSON.stringify(responses));assert.ok(responses.some(r=>r.body.error_code===(gasBound?'SPENDING_GAS_LIFETIME_LIMIT':'SPENDING_LIFETIME_LIMIT')),JSON.stringify(responses))
    const winning=responses.find(r=>r.status===201)!
    // Unpaid cancellation holds original delegation exposure.
    const {expireTradePayment}=await import('@/lib/trade-funding');await expireTradePayment(winning.body.trade)
    assert.equal((await spend(g.path+'/orders',g.key,'POST',{service_id:f.service,order:(winning.body.trade.client_reference===a.input.order.client_reference?b:a).checkout})).body.error_code,gasBound?'SPENDING_GAS_LIFETIME_LIMIT':'SPENDING_LIFETIME_LIMIT')
    assert.deepEqual(await counts(f),{orders:1,capacity:0})
  }
})

function tempoTerms(mutation={}){
  assert.ok(tempoChain)
  return {rail:'mpp',chain_id:4217,token_address:tempoChain.token,payer_address:payer.address,treasury_address:tempoChain.treasury,
    fee_token_address:tempoChain.token,minimum_token_reserve_units:'1000000',minimum_fee_token_reserve_units:'1000000',
    max_fee_token_cost_units:'10000',max_lifetime_fee_token_cost_units:'10000',...mutation}
}
async function tempoGrant(f:Fixture,mutation={}){return spendingGrant(f,{version:3,payment:tempoTerms(),...mutation})}
async function tempoCheckout(f:Fixture,g:Awaited<ReturnType<typeof tempoGrant>>){
  const a=await approved(f,{order:{...privateOrder(g.input.allowed_services[0].provider_share_id!),provider_share_id:g.input.allowed_services[0].provider_share_id??undefined,payment_rail:'mpp'}})
  const result=await spend(g.path+'/orders',g.key,'POST',{service_id:f.service,order:a.checkout});assert.equal(result.status,201,JSON.stringify(result.body))
  return {...a,...result.body,paymentPath:g.path+'/orders/'+result.body.trade.id+'/fund/mpp'}
}
async function signedTempoPurchase(c:Awaited<ReturnType<typeof tempoCheckout>>,g:Awaited<ReturnType<typeof tempoGrant>>,saved?:any){
  const operation=saved?.buyer_operation_id??crypto.randomUUID(),created=saved?{status:200,body:{intent:saved}}:await spend(c.paymentPath+'/intent',g.key,'POST',{buyer_operation_id:operation})
  assert.ok([200,201].includes(created.status),JSON.stringify(created.body))
  const intent=created.body.intent,adapter=createBuyerTempoAdapter({chainId:4217,rpcUrl:tempoRpcUrl,account:TempoAccount.fromSecp256k1(`0x${'18'.repeat(32)}`)})
  const raw=await adapter.prepare(intent),hash=keccak256(raw)
  return {intent,raw,hash,claim:{intent_id:intent.id,mandate_id:g.account.id,buyer_operation_id:operation,serialized_transaction:raw},
    credential:Credential.serialize({challenge:intent.challenge,payload:{type:'transaction',signature:raw},source:`did:pkh:eip155:4217:${payer.address.toLowerCase()}`}),proof:{tx_hash:hash,payer_address:payer.address}}
}
async function tempoPull(c:Awaited<ReturnType<typeof tempoCheckout>>,g:Awaited<ReturnType<typeof tempoGrant>>,s:Awaited<ReturnType<typeof signedTempoPurchase>>){
  const response=await fetch(baseUrl+c.paymentPath+'/proof',{method:'POST',headers:{Authorization:'Bearer '+g.key,'Payment-Authorization':s.credential}})
  return {status:response.status,body:await response.json()}
}
async function settleTempo(tradeId:string){
  const rows=await db.select().from(schema.settlement_transfers).where(eq(schema.settlement_transfers.trade_id,tradeId));assert.equal(rows.length,1)
  await (await import('@/lib/external-settlement')).processSettlementTransfer(rows[0].id,{waitMs:5000})
  const [saved]=await db.select().from(schema.settlement_transfers).where(eq(schema.settlement_transfers.id,rows[0].id));assert.equal(saved.status,'confirmed',saved.last_error??'')
  return saved
}
async function actualTempoFee(hash:Hex){
  assert.ok(tempoChain);const receipt=await tempoChain.client.waitForTransactionReceipt({hash,timeout:5000});assert.equal(receipt.status,'success')
  return (receipt.gasUsed*receipt.effectiveGasPrice+999_999_999_999n)/1_000_000_000_000n
}

test('delegated Tempo requires explicit version-3 authority, fixed fee token and lifetime exposure',{skip:!process.env.CLAWDMARKET_TEST_TEMPO_BINARY},async()=>{
  const f=await fixture(),g=await tempoGrant(f),credit=await spendingGrant(f)
  assert.equal(g.account.version,3);assert.equal(g.account.authority,'approved_direct_service_mpp')
  assert.equal(g.account.payment.fee_token_address,tempoChain!.token);assert.equal((await call(g.path,f.owner,'POST',g.input)).body.api_key,null)
  for(const payment of [tempoTerms({chain_id:42431}),tempoTerms({fee_token_address:`0x${'45'.repeat(20)}`}),tempoTerms({max_lifetime_fee_token_cost_units:'0'})])assert.ok((await call(g.path,f.owner,'POST',{...g.input,client_reference:crypto.randomUUID(),payment})).status>=400)
  assert.equal((await call(g.path,f.owner,'POST',{...credit.input,payment:tempoTerms()})).status,400)
  const a=await approved(f);assert.equal((await spend(g.path+'/orders',g.key,'POST',{service_id:f.service,order:a.checkout})).body.error_code,'SPENDING_EXACT_EXTERNAL_APPROVAL_REQUIRED')
  assert.equal((await spend(`/api/trades/${crypto.randomUUID()}/fund/mpp`,g.key,'POST')).status,401)
  const bound=await tempoGrant(f,{max_daily:'2.10',max_monthly:'2.10',max_lifetime:'2.10'}),c=await tempoCheckout(f,bound)
  await (await import('@/lib/trade-funding')).expireTradePayment(c.trade)
  const second=await approved(f,{order:{...a.input.order,client_reference:crypto.randomUUID(),payment_rail:'mpp'}})
  assert.equal((await spend(bound.path+'/orders',bound.key,'POST',{service_id:f.service,order:second.checkout})).body.error_code,'SPENDING_FEE_LIFETIME_LIMIT')
  assert.deepEqual(await counts(f),{orders:1,capacity:0})
})

test('real Tempo delegated private purchase uses original SDK claim, provider restart and explicit buyer payout',{skip:!process.env.CLAWDMARKET_TEST_TEMPO_BINARY},async()=>{
  assert.ok(tempoChain)
  const f=await privateFixture(),share=await shared(f),g=await tempoGrant(f,{allowed_services:[{service_id:f.service,provider_share_id:share.share.id}]}),c=await tempoCheckout(f,g),s=await signedTempoPurchase(c,g)
  const seller=privateKeyToAccount(`0x${'19'.repeat(32)}`).address,buyerBefore=await tempoChain.balance(payer.address),sellerBefore=await tempoChain.balance(seller),treasuryBefore=await tempoChain.balance(tempoChain.treasury),broadcastBefore=tempoBroadcasts
  const claimed=await spend(c.paymentPath+'/claim',g.key,'POST',s.claim);assert.equal(claimed.body.send_allowed,true,JSON.stringify(claimed.body))
  assert.equal((await spend(c.paymentPath+'/claim',g.key,'POST',s.claim)).body.idempotent,true)
  const funded=await tempoPull(c,g,s);assert.equal(funded.status,200,JSON.stringify(funded.body));assert.equal(funded.body.trade.status,'escrow_held')
  assert.equal(tempoBroadcasts,broadcastBefore+1);assert.equal((await tempoPull(c,g,s)).body.idempotent,true)
  const [originalClaim]=await db.select().from(schema.organization_spending_mpp_claims).where(eq(schema.organization_spending_mpp_claims.trade_id,c.trade.id))
  assert.equal(originalClaim.state,'confirmed');assert.ok(originalClaim.first_submission_at);assert.equal(originalClaim.tx_hash,s.hash)
  await call(f.privatePath,f.providerOwner,'DELETE',{share_id:share.share.id});await call(g.path,f.owner,'DELETE',{account_id:g.account.id})
  const handler=join(directory,`${c.trade.id}.tempo-handler.mjs`);await writeFile(handler,"export default async()=>({summary:'Reviewed the original private Tempo purchase.',artifact:{result:'Approved Tempo review result'}})")
  const command=['scripts/provider-worker.mjs','--trade-id',c.trade.id,'--service-id',f.service,'--state-dir',join(directory,c.trade.id),'--handler',handler],options={cwd:process.cwd(),env:{...process.env,BASE_URL:baseUrl,CLAWDMARKET_PROVIDER_API_KEY:f.providerKey}},run=promisify(execFile)
  const first=JSON.parse((await run(process.execPath,command,options)).stdout),restart=JSON.parse((await run(process.execPath,command,options)).stdout);assert.equal(first.state,'delivered');assert.equal(first.delivery_id,restart.delivery_id)
  assert.equal((await spend(`/api/trades/${c.trade.id}/confirm`,g.key,'POST',{content_hash:first.content_hash})).status,401)
  const confirmed=await call(`/api/trades/${c.trade.id}/confirm`,f.key,'POST',{content_hash:first.content_hash},true);assert.ok([200,202].includes(confirmed.status),JSON.stringify(confirmed.body))
  const payout=await settleTempo(c.trade.id),buyerFee=await actualTempoFee(s.hash),treasuryFee=await actualTempoFee(payout.tx_hash as Hex)
  assert.equal(await tempoChain.balance(payer.address),buyerBefore-1_050_000n-buyerFee);assert.equal(await tempoChain.balance(seller),sellerBefore+1_000_000n)
  assert.equal(await tempoChain.balance(tempoChain.treasury),treasuryBefore+50_000n-treasuryFee);assert.equal(tempoBroadcasts,broadcastBefore+2)
  const {publicTradeAvailable}=await import('@/lib/public-trade-visibility');assert.equal(await publicTradeAvailable(c.trade.id),false);assert.deepEqual(await counts(f),{orders:1,capacity:0})
})

test('Tempo SDK rechecks department authority after simulation before broadcast; revoked original payment remains refundable',{skip:!process.env.CLAWDMARKET_TEST_TEMPO_BINARY},async()=>{
  assert.ok(tempoChain)
  const f=await fixture(),g=await tempoGrant(f),c=await tempoCheckout(f,g),s=await signedTempoPurchase(c,g),before=tempoBroadcasts,buyerBefore=await tempoChain.balance(payer.address)
  assert.equal((await spend(c.paymentPath+'/claim',g.key,'POST',s.claim)).body.send_allowed,true)
  let closed=false
  tempoRpcHook=async method=>{if(!closed&&method==='eth_call'){closed=true;const now=new Date();await db.insert(schema.organization_team_budgets).values({team_id:f.team,organization_id:f.id,max_per_execution_minor:104,version:1,created_at:now,updated_at:now})}}
  let denied;try{denied=await tempoPull(c,g,s)}finally{tempoRpcHook=null}
  assert.equal(closed,true);assert.ok(denied.status>=400,JSON.stringify(denied.body));assert.equal(tempoBroadcasts,before)
  const replay=await spend(c.paymentPath+'/claim',g.key,'POST',s.claim);assert.equal(replay.body.send_allowed,false);assert.equal(replay.body.claim.tx_hash,s.hash)
  await call(g.path,f.owner,'DELETE',{account_id:g.account.id});assert.equal((await spend(c.paymentPath+'/intent',g.key,'GET')).status,401)
  const original=await call(`/api/trades/${c.trade.id}/fund/mpp/claim`,f.key,'POST',s.claim,true);assert.equal(original.body.send_allowed,false)
  // The buyer host may already have sent original bytes despite a lost response; the server cannot erase this obligation.
  await tempoChain.client.sendRawTransaction({serializedTransaction:s.raw});await tempoChain.client.waitForTransactionReceipt({hash:s.hash,timeout:5000})
  const recovered=await call(`/api/trades/${c.trade.id}/fund/mpp`,f.key,'POST',s.proof,true);assert.equal(recovered.status,202,JSON.stringify(recovered.body));assert.equal(recovered.body.status,'late_payment_refund_processing')
  const refund=await settleTempo(c.trade.id);assert.equal(refund.kind,'buyer_refund');assert.equal(refund.token_amount,'1050000')
  assert.equal(await tempoChain.balance(payer.address),buyerBefore-await actualTempoFee(s.hash));assert.equal(tempoBroadcasts,before+1)
  const [claim]=await db.select().from(schema.organization_spending_mpp_claims).where(eq(schema.organization_spending_mpp_claims.trade_id,c.trade.id));assert.equal(claim.state,'confirmed')
  assert.deepEqual(await counts(f),{orders:1,capacity:0})
})

test('delegated Tempo claims reject altered bytes, fee/reserve violations and competing wallet claims',{skip:!process.env.CLAWDMARKET_TEST_TEMPO_BINARY},async()=>{
  assert.ok(tempoChain)
  const f=await fixture(),g=await tempoGrant(f),c=await tempoCheckout(f,g),s=await signedTempoPurchase(c,g)
  const {Transaction}=await import('viem/tempo'),transaction=Transaction.deserialize(s.raw),account=TempoAccount.fromSecp256k1(`0x${'18'.repeat(32)}`)
  assert.ok('calls' in transaction)
  for(const mutation of [{feeToken:`0x${'45'.repeat(20)}`},{calls:[{...transaction.calls![0],value:1n}]},{chainId:42431}]){
    const raw:Hex=await account.signTransaction({...transaction,signature:undefined,...mutation} as any)
    assert.equal((await spend(c.paymentPath+'/claim',g.key,'POST',{...s.claim,serialized_transaction:raw})).body.error_code,'BUYER_TEMPO_TRANSACTION_SCOPE_MISMATCH')
  }
  const pricey=await account.signTransaction({...transaction,signature:undefined,maxFeePerGas:10n**18n} as any)
  assert.equal((await spend(c.paymentPath+'/claim',g.key,'POST',{...s.claim,serialized_transaction:pricey})).body.error_code,'BUYER_TEMPO_TRANSACTION_FEE_LIMIT')
  const balance=await tempoChain.balance(payer.address),reserveFixture=await fixture(),reserve=await tempoGrant(reserveFixture,{payment:tempoTerms({minimum_fee_token_reserve_units:balance.toString()})}),reserveOrder=await tempoCheckout(reserveFixture,reserve),reserveSigned=await signedTempoPurchase(reserveOrder,reserve)
  assert.equal((await spend(reserveOrder.paymentPath+'/claim',reserve.key,'POST',reserveSigned.claim)).body.error_code,'BUYER_TEMPO_TOKEN_RESERVE_REQUIRED')
  assert.equal((await spend(c.paymentPath+'/claim',g.key,'POST',s.claim)).body.send_allowed,true)
  const otherFixture=await fixture(),otherGrant=await tempoGrant(otherFixture),otherOrder=await tempoCheckout(otherFixture,otherGrant),other=await signedTempoPurchase(otherOrder,otherGrant)
  assert.equal((await spend(otherOrder.paymentPath+'/claim',otherGrant.key,'POST',other.claim)).body.error_code,'BUYER_WALLET_PAYMENT_UNRECONCILED')
  assert.equal((await spend(otherOrder.paymentPath+'/claim',g.key,'POST',s.claim)).status,401)
  // Close/reconcile the one original claim so later cases share a clean wallet without deleting history.
  await call(g.path,f.owner,'DELETE',{account_id:g.account.id});await tempoChain.client.sendRawTransaction({serializedTransaction:s.raw});await tempoChain.client.waitForTransactionReceipt({hash:s.hash,timeout:5000})
  const recovered=await call(`/api/trades/${c.trade.id}/fund/mpp`,f.key,'POST',s.proof,true);assert.equal(recovered.status,202,JSON.stringify(recovered.body));await settleTempo(c.trade.id)
})

test('delegated Tempo SIGKILL at intent, claim, broadcast and verified receipt commits recovers exact original payment',{skip:!process.env.CLAWDMARKET_TEST_TEMPO_BINARY},async()=>{
  assert.ok(tempoChain)
  for(const operation of ['intent','claim','broadcast','proof'] as const)for(const boundary of operation==='broadcast'?['after'] as const:['before','after'] as const){
    const f=await fixture(),g=await tempoGrant(f),c=await tempoCheckout(f,g),buyerBefore=await tempoChain.balance(payer.address),body={buyer_operation_id:crypto.randomUUID()}
    let signed:Awaited<ReturnType<typeof signedTempoPurchase>>|undefined
    if(operation!=='intent')signed=await signedTempoPurchase(c,g)
    if(operation==='broadcast'||operation==='proof')assert.equal((await spend(c.paymentPath+'/claim',g.key,'POST',signed!.claim)).body.send_allowed,true)
    if(operation==='proof'){await tempoChain.client.sendRawTransaction({serializedTransaction:signed!.raw});await tempoChain.client.waitForTransactionReceipt({hash:signed!.hash,timeout:5000})}
    const marker=join(directory,`tempo-${operation}-${boundary}-${f.id}.marker`),args={f,g,c,body,signed:signed?{raw:signed.raw,hash:signed.hash,claim:signed.claim,proof:signed.proof}:null,rpc:tempoChain.url,origin:baseUrl}
    const code=`(async()=>{const {writeFile}=await import('node:fs/promises'),a=JSON.parse(process.argv[1]);const stop=async()=>{await writeFile(process.argv[2],'boundary');await new Promise(()=>{})};
      ${boundary==='before'?"const {db}=await import('./lib/db.ts'),proto=Object.getPrototypeOf(db.session),original=proto.transaction;proto.transaction=function(fn,c){return original.call(this,async tx=>{const r=await fn(tx);await stop();return r},c)};":''}
      ${operation==='broadcast'?"const response=await fetch(a.rpc,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_sendRawTransaction',params:[a.signed.raw]})});const r=await response.json();if(r.result!==a.signed.hash)throw Error('Original Tempo broadcast failed');":"const {NextRequest}=await import('next/server'),api=await import('./app/api/organizations/[id]/spending-accounts/orders/[tradeId]/fund/mpp/[action]/route.ts'),action='"+operation+"',input=action==='intent'?a.body:action==='claim'?a.signed.claim:a.signed.proof;const response=await api.POST(new NextRequest(a.origin+a.c.paymentPath+'/'+action,{method:'POST',headers:{Authorization:'Bearer '+a.g.key,'Content-Type':'application/json',Host:new URL(a.origin||'http://127.0.0.1').host},body:JSON.stringify(input)}),{params:Promise.resolve({id:a.f.id,tradeId:a.c.trade.id,action})});if(response.status>=400)throw Error(await response.text());"}
      await stop()})().catch(e=>{console.error(e);process.exitCode=1})`
    const child=spawn(process.execPath,['--conditions=react-server','--import','tsx','-e',code,JSON.stringify(args),marker],{cwd:process.cwd(),env:process.env,stdio:['ignore','ignore','pipe']})
    let errors='';child.stderr.on('data',chunk=>{errors+=chunk});const exited=new Promise<void>((done,reject)=>{child.once('exit',()=>done());child.once('error',reject)})
    try{
      let reached=false;for(let wait=0;wait<150;wait++){try{await readFile(marker);reached=true;break}catch{}if(child.exitCode!==null)throw Error(errors);await new Promise(done=>setTimeout(done,100))}
      assert.equal(reached,true,errors);child.kill('SIGKILL');await exited
      const saved=await spend(c.paymentPath+'/intent',g.key,'GET');assert.equal(saved.status,200)
      if(operation==='intent'){
        assert.equal(Boolean(saved.body.intent),boundary==='after');const repeated=await spend(c.paymentPath+'/intent',g.key,'POST',body);assert.equal(repeated.status,boundary==='before'?201:200,JSON.stringify({operation,boundary,result:repeated.body,origin:saved.body.intent?.origin,baseUrl}))
        if(saved.body.intent)assert.equal(repeated.body.intent.id,saved.body.intent.id)
        signed=await signedTempoPurchase(c,g,repeated.body.intent)
      }
      assert.ok(signed)
      if(operation==='claim')assert.equal(Boolean(saved.body.claim),boundary==='after')
      if(operation==='intent'||operation==='claim')assert.equal((await spend(c.paymentPath+'/claim',g.key,'POST',signed.claim)).body.send_allowed,true)
      if(operation!=='broadcast'&&operation!=='proof'){await tempoChain.client.sendRawTransaction({serializedTransaction:signed.raw});await tempoChain.client.waitForTransactionReceipt({hash:signed.hash,timeout:5000})}
      if(operation==='proof'&&boundary==='after'){
        assert.equal(saved.body.claim.state,'confirmed')
        assert.equal((await call(`/api/trades/${c.trade.id}/dispute`,`clawdmarket-test-${f.agent}`,'POST',{reason:'Reject the controlled Tempo crash acceptance fixture'},true)).status,200)
        process.env.ADMIN_USER_IDS=f.owner
        try{const resolved=await call(`/api/trades/${c.trade.id}/resolve`,f.owner,'POST',{resolution:'buyer'});assert.ok([200,202].includes(resolved.status),JSON.stringify(resolved.body))}finally{delete process.env.ADMIN_USER_IDS}
      }else{
        await call(g.path,f.owner,'DELETE',{account_id:g.account.id})
        let recovered=await call(`/api/trades/${c.trade.id}/fund/mpp`,f.key,'POST',signed.proof,true)
        for(let attempt=0;recovered.status===409&&recovered.body.code==='PAYMENT_CONFIRMING'&&attempt<20;attempt++){
          assert.equal(recovered.body.retryable,true);await new Promise(done=>setTimeout(done,200))
          recovered=await call(`/api/trades/${c.trade.id}/fund/mpp`,f.key,'POST',signed.proof,true)
        }
        assert.equal(recovered.status,202,JSON.stringify({operation,boundary,result:recovered.body}))
      }
      const refund=await settleTempo(c.trade.id),principal=operation==='proof'&&boundary==='after'?1_000_000n:1_050_000n
      assert.equal(refund.token_amount,principal.toString());assert.equal(await tempoChain.balance(payer.address),buyerBefore-1_050_000n+principal-await actualTempoFee(signed.hash))
      const [claim]=await db.select().from(schema.organization_spending_mpp_claims).where(eq(schema.organization_spending_mpp_claims.trade_id,c.trade.id));assert.equal(claim.state,'confirmed');assert.equal(claim.tx_hash,signed.hash)
      assert.deepEqual(await counts(f),{orders:1,capacity:0})
    }finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await exited}
  }
})

async function spendingClientApproval(f:Fixture,g:Awaited<ReturnType<typeof spendingGrant>>,c:any){
  const [use]=await db.select().from(schema.organization_spending_uses).where(eq(schema.organization_spending_uses.order_id,c.order.id))
  return {version:1,origin:baseUrl,organization_id:f.id,account_id:g.account.id,authority_hash:use.authority_hash,grant_version:g.account.version,buyer_id:f.buyer,
    order_id:c.order.id,trade_id:c.trade.id,service_id:f.service,purchasing_approval_id:c.approval.id,payment:g.account.payment,token_decimals:6,token_usd_price:1,total_cost:'1.05',max_purchase:'1.05',rpc_url:g.account.version===3?tempoRpcUrl:enterpriseChain!.url}
}
async function spendingClientProcess(approval:any,g:Awaited<ReturnType<typeof spendingGrant>>,f:Fixture,stateDirectory:string,mode?:string){
  const file=join(directory,`${crypto.randomUUID()}.spending-client.json`)
  await writeFile(file,JSON.stringify(approval),{mode:0o600})
  const args=['scripts/buyer-spending-worker.mjs',file,stateDirectory,...(mode?[mode]:[])]
  const output=await promisify(execFile)(process.execPath,args,{cwd:process.cwd(),env:{...process.env,CLAWDMARKET_SPENDING_API_KEY:g.key,CLAWDMARKET_BUYER_API_KEY:f.key,CLAWDMARKET_BUYER_PRIVATE_KEY:`0x${'18'.repeat(32)}`}})
  assert.equal(output.stdout.includes(g.key),false);assert.equal(output.stdout.includes(f.key),false);assert.equal(output.stdout.includes('18'.repeat(32)),false)
  return JSON.parse(output.stdout)
}

test('buyer enterprise client prepares privately and funds original L1/Tempo orders across separate process restarts',{skip:!process.env.CLAWDMARKET_TEST_ANVIL_BINARY||!process.env.CLAWDMARKET_TEST_TEMPO_BINARY},async()=>{
  for(const rail of ['evm','mpp'] as const){
    const f=await fixture(),g=rail==='evm'?await externalGrant(f):await tempoGrant(f),c=rail==='evm'?await externalCheckout(f,g):await tempoCheckout(f,g),approval=await spendingClientApproval(f,g,c),state=join(directory,`${c.trade.id}.spending-client`)
    const prepared=await spendingClientProcess(approval,g,f,state,'--prepare-only');assert.equal(prepared.state,'prepared')
    const {readdir}=await import('node:fs/promises'),journals=await Promise.all((await readdir(state)).filter(name=>name.endsWith('.json')).map(name=>readFile(join(state,name),'utf8')))
    assert.ok(journals.some(text=>text.includes(prepared.tx_hash)));for(const text of journals){assert.equal(text.includes(g.key),false);assert.equal(text.includes(f.key),false);assert.equal(text.includes('18'.repeat(32)),false)}
    const before=tempoBroadcasts
    const funded=await spendingClientProcess(approval,g,f,state);assert.equal(funded.state,'funded',JSON.stringify(funded));assert.equal(funded.tx_hash,prepared.tx_hash)
    const repeated=await spendingClientProcess(approval,g,f,state);assert.equal(repeated.state,'funded');assert.equal(repeated.tx_hash,prepared.tx_hash)
    if(rail==='mpp')assert.equal(tempoBroadcasts,before+1)
    const receipts=await db.select().from(schema.payment_receipts).where(eq(schema.payment_receipts.trade_id,c.trade.id));assert.equal(receipts.length,1);assert.equal(receipts[0].tx_hash,prepared.tx_hash)
  }
})

test('enterprise client recovers lost claim and SDK responses with original bytes and no replacement signer call',{skip:!process.env.CLAWDMARKET_TEST_ANVIL_BINARY||!process.env.CLAWDMARKET_TEST_TEMPO_BINARY},async()=>{
  const {runBuyerSpendingFunding}=await import('../../scripts/buyer-spending-worker.mjs'),{createBuyerEvmAdapter}=await import('../../scripts/buyer-evm-adapter.mjs')
  for(const rail of ['evm','mpp'] as const)for(const lost of ['intent','claim','broadcast'] as const){
    const f=await fixture(),g=rail==='evm'?await externalGrant(f):await tempoGrant(f),c=rail==='evm'?await externalCheckout(f,g):await tempoCheckout(f,g),approval=await spendingClientApproval(f,g,c),stateDirectory=join(directory,`${c.trade.id}.lost-response-client`)
    const account=rail==='mpp'?TempoAccount.fromSecp256k1(`0x${'18'.repeat(32)}`):payer,adapter=(rail==='mpp'?createBuyerTempoAdapter:createBuyerEvmAdapter)({chainId:approval.payment.chain_id,rpcUrl:approval.rpc_url,account})
    const originalPrepare=adapter.prepare;let signs=0;adapter.prepare=async(...args:any[])=>{signs++;return originalPrepare(...args as [any])}
    let dropped=false
    const fetcher:typeof fetch=async(url,init)=>{const response=await fetch(url,init);if(!dropped&&(lost==='intent'?String(url).endsWith('/intent')&&init?.method==='POST':lost==='claim'?String(url).endsWith('/claim'):rail==='mpp'&&String(url).endsWith('/proof')&&new Headers(init?.headers).has('Payment-Authorization'))){dropped=true;await response.arrayBuffer();throw Error('Controlled lost response')}return response}
    if(lost==='broadcast'&&rail==='evm'){assert.ok('broadcast' in adapter);const broadcast=adapter.broadcast;adapter.broadcast=async(...args:any[])=>{await broadcast(...args as [any]);dropped=true;throw Error('Controlled lost broadcast response')}}
    const options={approval,apiKey:g.key,recoveryApiKey:f.key,stateDirectory,account,adapter,fetcher}
    await assert.rejects(()=>runBuyerSpendingFunding(options),lost==='broadcast'&&rail==='evm'?/BUYER_BROADCAST_UNCERTAIN_RESUME_SAME_PAYMENT/:/BUYER_REQUEST_UNCERTAIN_RESUME_SAME_PAYMENT/)
    assert.equal(dropped,true);assert.equal(signs,lost==='intent'?0:1)
    const recovery=await spendingClientProcess(approval,g,f,stateDirectory);assert.equal(recovery.state,'funded',JSON.stringify(recovery));assert.equal(signs,lost==='intent'?0:1)
    const receipt=await db.select().from(schema.payment_receipts).where(eq(schema.payment_receipts.trade_id,c.trade.id));assert.equal(receipt.length,1)
  }
})

test('enterprise client rejects changed approval or copied original order before signing and recovers revoked L1 payment by buyer key',{skip:!process.env.CLAWDMARKET_TEST_ANVIL_BINARY},async()=>{
  const {runBuyerSpendingFunding}=await import('../../scripts/buyer-spending-worker.mjs'),{createBuyerEvmAdapter}=await import('../../scripts/buyer-evm-adapter.mjs')
  const f=await fixture(),g=await externalGrant(f),c=await externalCheckout(f,g),approval=await spendingClientApproval(f,g,c),stateDirectory=join(directory,`${c.trade.id}.revoked-client`),adapter=createBuyerEvmAdapter({chainId:1,rpcUrl:enterpriseChain!.url,account:payer})
  let signs=0;const prepare=adapter.prepare;adapter.prepare=async(...args:any[])=>{signs++;return prepare(...args as [any])}
  const options={approval,apiKey:g.key,recoveryApiKey:f.key,stateDirectory,account:payer,adapter}
  await assert.rejects(()=>runBuyerSpendingFunding({...options,approval:{...approval,authority_hash:'a'.repeat(64)}}),/BUYER_CHECKOUT_SCOPE_MISMATCH/);assert.equal(signs,0)
  // An invalid read-only review creates no durable wallet obligation; use the same directory.
  const broadcast=adapter.broadcast;adapter.broadcast=async(...args:any[])=>{const hash=await broadcast(...args as [any]);await call(g.path,f.owner,'DELETE',{account_id:g.account.id});throw Error('Controlled revoked lost response '+hash)}
  const before=await enterpriseChain!.balance(payer.address)
  await assert.rejects(()=>runBuyerSpendingFunding(options),/BUYER_BROADCAST_UNCERTAIN_RESUME_SAME_PAYMENT/);assert.equal(signs,1)
  const recovered=await spendingClientProcess(approval,g,f,options.stateDirectory);assert.equal(recovered.state,'refunded',JSON.stringify(recovered));assert.equal(await enterpriseChain!.balance(payer.address),before)
  assert.deepEqual(await counts(f),{orders:1,capacity:0})
})

test('enterprise buyer SIGKILL after claim commit releases the shared lock and resumes original bytes in a fresh process',{skip:!process.env.CLAWDMARKET_TEST_ANVIL_BINARY||!process.env.CLAWDMARKET_TEST_TEMPO_BINARY},async()=>{
  for(const rail of ['evm','mpp'] as const){
    const f=await fixture(),g=rail==='evm'?await externalGrant(f):await tempoGrant(f),c=rail==='evm'?await externalCheckout(f,g):await tempoCheckout(f,g),approval=await spendingClientApproval(f,g,c),stateDirectory=join(directory,`${c.trade.id}.killed-client`),file=join(directory,`${c.trade.id}.kill-approval.json`)
    await writeFile(file,JSON.stringify(approval),{mode:0o600})
    let release!:()=>void,reached!:()=>void;const arrived=new Promise<void>(done=>reached=done),blocked=new Promise<void>(done=>release=done)
    spendingApiHook=async path=>{if(path===c.paymentPath+'/claim'){reached();await blocked}}
    const child=spawn(process.execPath,['scripts/buyer-spending-worker.mjs',file,stateDirectory],{cwd:process.cwd(),detached:true,env:{...process.env,CLAWDMARKET_SPENDING_API_KEY:g.key,CLAWDMARKET_BUYER_API_KEY:f.key,CLAWDMARKET_BUYER_PRIVATE_KEY:`0x${'18'.repeat(32)}`},stdio:['ignore','ignore','pipe']})
    let errors='';child.stderr.on('data',chunk=>errors+=chunk);const exited=new Promise<void>(done=>child.once('exit',()=>done())),timeout=setTimeout(()=>{if(child.pid)process.kill(-child.pid,'SIGKILL');release()},15000)
    try{
      await Promise.race([arrived,exited.then(()=>{throw Error(errors||'Buyer exited before claim commit')})]);assert.ok(child.pid);process.kill(-child.pid,'SIGKILL');await exited;spendingApiHook=null;release()
      const original=await spend(c.paymentPath+'/intent',g.key,'GET');assert.equal(original.body.claim.state,'claimed');const hash=original.body.claim.tx_hash
      const resumed=await spendingClientProcess(approval,g,f,stateDirectory);assert.equal(resumed.state,'funded',JSON.stringify(resumed));assert.equal(resumed.tx_hash,hash)
      const repeated=await spendingClientProcess(approval,g,f,stateDirectory);assert.equal(repeated.tx_hash,hash);assert.equal(repeated.state,'funded')
      assert.deepEqual(await counts(f),{orders:1,capacity:1})
    }finally{clearTimeout(timeout);spendingApiHook=null;release();if(child.exitCode===null&&child.signalCode===null&&child.pid)process.kill(-child.pid,'SIGKILL');await exited}
  }
})

test('enterprise client preserves a revoked Tempo refund hold until original treasury confirmation',{skip:!process.env.CLAWDMARKET_TEST_TEMPO_BINARY},async()=>{
  assert.ok(tempoChain)
  const f=await fixture(),g=await tempoGrant(f),c=await tempoCheckout(f,g),approval=await spendingClientApproval(f,g,c),state=join(directory,`${c.trade.id}.refund-client`)
  const prepared=await spendingClientProcess(approval,g,f,state,'--prepare-only')
  const {readdir}=await import('node:fs/promises')
  const saved=await Promise.all((await readdir(state)).filter(name=>name.endsWith('.json')).map(async name=>JSON.parse(await readFile(join(state,name),'utf8'))))
  const journal=saved.find(value=>value.trade_id===c.trade.id);assert.ok(journal)
  const claimed=await spend(c.paymentPath+'/claim',g.key,'POST',{intent_id:journal.intent.id,mandate_id:g.account.id,buyer_operation_id:journal.operation_id,serialized_transaction:journal.serialized_transaction})
  assert.equal(claimed.status,200);assert.equal(claimed.body.send_allowed,true)
  assert.equal((await call(g.path,f.owner,'DELETE',{account_id:g.account.id})).status,200)
  const before=await tempoChain.balance(payer.address),broadcasts=tempoBroadcasts
  const hash=await tempoChain.client.sendRawTransaction({serializedTransaction:journal.serialized_transaction})
  assert.equal(hash,prepared.tx_hash)
  await tempoChain.client.waitForTransactionReceipt({hash,confirmations:1,timeout:10000,pollingInterval:50})
  const recovered=await spendingClientProcess(approval,g,f,state);assert.equal(recovered.state,'refund_pending',JSON.stringify(recovered));assert.equal(recovered.tx_hash,hash);assert.equal(tempoBroadcasts,broadcasts)
  const another=await fixture(),grant2=await tempoGrant(another),order2=await tempoCheckout(another,grant2),approval2=await spendingClientApproval(another,grant2,order2)
  await assert.rejects(()=>spendingClientProcess(approval2,grant2,another,state),/BUYER_WALLET_PAYMENT_UNRECONCILED/)
  const confirmed=await settleTempo(c.trade.id);assert.equal(confirmed.status,'confirmed')
  const final=await spendingClientProcess(approval,g,f,state);assert.equal(final.state,'refunded');assert.equal(final.tx_hash,hash)
  assert.equal(tempoBroadcasts,broadcasts+1) // Only the original treasury refund sends through the proxy.
  assert.equal(await tempoChain.balance(payer.address),before-await actualTempoFee(hash))
  assert.deepEqual(await counts(f),{orders:1,capacity:0})
})
