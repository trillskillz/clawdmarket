import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { createLocalTestSchema } from '../helpers/local-schema'

let directory: string
let db: typeof import('@/lib/db').db
let schema: typeof import('@/lib/schema')
let register: typeof import('@/app/api/agents/register/route').POST
let status: typeof import('@/app/api/agents/status/route').GET
let rotateCredential: typeof import('@/app/api/agents/credentials/rotate/route').POST
let revokePreviousCredential: typeof import('@/app/api/agents/credentials/previous/route').DELETE
let credentials: typeof import('@/app/api/agents/credentials/route')
let revokeNamedCredential: typeof import('@/app/api/agents/credentials/[id]/route').DELETE
let ownership: typeof import('@/app/api/agents/ownership/route')
let recoverCredentials: typeof import('@/app/api/agents/[id]/ownership/recover/route').POST
let createOwnershipTransfer: typeof import('@/app/api/agents/[id]/ownership/transfers/route').POST
let acceptOwnershipTransfer: typeof import('@/app/api/agents/ownership/transfers/accept/route').POST
let cancelOwnershipTransfer: typeof import('@/app/api/agents/[id]/ownership/transfers/[transferId]/route').DELETE
let heartbeat: typeof import('@/app/api/agents/[id]/heartbeat/route').POST
let claim: typeof import('@/app/api/claim/route')
let listing: typeof import('@/app/api/listings/route').POST
let listingDirectory: typeof import('@/app/api/listings/route').GET
let listingDetail: typeof import('@/app/api/listings/[id]/route').GET
let agentDirectory: typeof import('@/app/api/agents/list/route').GET
let agentSearch: typeof import('@/app/api/agents/search/route').GET
let agentDetail: typeof import('@/app/api/agents/[id]/route').GET
let archiveAgent: typeof import('@/app/api/agents/register/[id]/route').DELETE
let cleanupCanaries: typeof import('@/app/api/cron/agent-canaries/route').GET
let tradePreview: typeof import('@/app/api/trades/preview/route').POST
let selfTest: typeof import('@/app/api/agent/self-test/route').GET
let payout: typeof import('@/app/api/payments/payout-address/route').PUT
let usage: typeof import('@/app/api/agents/usage/route').GET
let inbox: typeof import('@/app/api/agents/inbox/route').GET
let tasks: typeof import('@/app/api/tasks/route')
let bid: typeof import('@/app/api/tasks/[id]/bid/route').POST
let accept: typeof import('@/app/api/tasks/[id]/accept/[bid_id]/route').POST
let bids: typeof import('@/app/api/agents/bids/route').GET
let work: typeof import('@/app/api/work/route').GET
let webhookDeliveries: typeof import('@/app/api/webhooks/deliveries/route').GET
let generateJWT: typeof import('@/lib/auth').generateJWT
let ipSequence = 10

before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'clawdmarket-workspace-test-'))
  process.env.TURSO_DATABASE_URL = `file:${join(directory, 'agent-onboarding.db')}`
  process.env.JWT_SECRET = 'isolated-agent-onboarding-tests-only'
  process.env.WEBHOOK_SECRET_KEY = 'isolated-agent-onboarding-tests-only'
  process.env.NEXT_PUBLIC_BASE_URL = 'https://clawdmkt.test'
  process.env.CRON_SECRET = 'isolated-canary-cleanup-secret'
  db = (await import('@/lib/db')).db
  schema = await import('@/lib/schema')
  await createLocalTestSchema(db.$client, schema)
  register = (await import('@/app/api/agents/register/route')).POST
  status = (await import('@/app/api/agents/status/route')).GET
  rotateCredential = (await import('@/app/api/agents/credentials/rotate/route')).POST
  revokePreviousCredential = (await import('@/app/api/agents/credentials/previous/route')).DELETE
  credentials = await import('@/app/api/agents/credentials/route')
  revokeNamedCredential = (await import('@/app/api/agents/credentials/[id]/route')).DELETE
  ownership = await import('@/app/api/agents/ownership/route')
  recoverCredentials = (await import('@/app/api/agents/[id]/ownership/recover/route')).POST
  createOwnershipTransfer = (await import('@/app/api/agents/[id]/ownership/transfers/route')).POST
  acceptOwnershipTransfer = (await import('@/app/api/agents/ownership/transfers/accept/route')).POST
  cancelOwnershipTransfer = (await import('@/app/api/agents/[id]/ownership/transfers/[transferId]/route')).DELETE
  heartbeat = (await import('@/app/api/agents/[id]/heartbeat/route')).POST
  claim = await import('@/app/api/claim/route')
  listing = (await import('@/app/api/listings/route')).POST
  listingDirectory = (await import('@/app/api/listings/route')).GET
  listingDetail = (await import('@/app/api/listings/[id]/route')).GET
  agentDirectory = (await import('@/app/api/agents/list/route')).GET
  agentSearch = (await import('@/app/api/agents/search/route')).GET
  agentDetail = (await import('@/app/api/agents/[id]/route')).GET
  archiveAgent = (await import('@/app/api/agents/register/[id]/route')).DELETE
  cleanupCanaries = (await import('@/app/api/cron/agent-canaries/route')).GET
  tradePreview = (await import('@/app/api/trades/preview/route')).POST
  selfTest = (await import('@/app/api/agent/self-test/route')).GET
  payout = (await import('@/app/api/payments/payout-address/route')).PUT
  usage = (await import('@/app/api/agents/usage/route')).GET
  inbox = (await import('@/app/api/agents/inbox/route')).GET
  tasks = await import('@/app/api/tasks/route')
  bid = (await import('@/app/api/tasks/[id]/bid/route')).POST
  accept = (await import('@/app/api/tasks/[id]/accept/[bid_id]/route')).POST
  bids = (await import('@/app/api/agents/bids/route')).GET
  work = (await import('@/app/api/work/route')).GET
  webhookDeliveries = (await import('@/app/api/webhooks/deliveries/route')).GET
  generateJWT = (await import('@/lib/auth')).generateJWT
})

after(() => {
  db?.$client.close()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

function request(path: string, method = 'GET', body?: unknown, key?: string, keyHeader = 'x-agent-api-key') {
  ipSequence += 1
  return new NextRequest(`https://clawdmkt.test${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': `198.51.100.${ipSequence}`,
      ...(key ? { [keyHeader]: key } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

function accountRequest(path: string, token: string, method = 'GET', body?: unknown, agentKey?: string) {
  ipSequence += 1
  return new NextRequest(`https://clawdmkt.test${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'x-forwarded-for': `198.51.100.${ipSequence}`,
      ...(agentKey ? { 'x-agent-api-key': agentKey } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

async function createAccount(email: string) {
  const id = `user_${randomUUID()}`
  await db.insert(schema.users).values({
    id,
    email,
    password_hash: 'isolated-owner-account-hash',
    name: email.split('@')[0],
    role: 'human',
  })
  return {
    id,
    email,
    token: generateJWT({ userId: id, email, role: 'human' }),
  }
}

async function registerAgent(name: string, activationMode?: 'autonomous' | 'owner_claim') {
  const response = await register(request('/api/agents/register', 'POST', {
    name,
    description: `${name} performs an isolated API lifecycle test.`,
    capabilities: ['web-research', 'data-analysis'],
    ...(activationMode ? { activation_mode: activationMode } : {}),
  }))
  assert.equal(response.status, 201)
  return response.json()
}

test('an autonomous agent can activate, authenticate with either key header, and use the core work APIs', async () => {
  const buyer = await registerAgent('Autonomous Buyer', 'autonomous')
  assert.equal(buyer.agent.status, 'active')
  assert.equal(buyer.agent.claim_url, null)
  assert.equal(buyer.agent.human_approval_required, false)

  const seller = await registerAgent('Autonomous Seller', 'autonomous')
  // Test fixture for the deliberately supported pre-HMAC storage format.
  // codeql[js/insufficient-password-hash]
  const legacyDigest = createHash('sha256').update(buyer.agent.api_key).digest('hex')
  await db.update(schema.agents).set({ api_key: legacyDigest }).where(eq(schema.agents.id, buyer.agent.id))
  const buyerStatus = await status(request('/api/agents/status', 'GET', undefined, buyer.agent.api_key))
  assert.equal(buyerStatus.status, 200)
  assert.equal((await buyerStatus.json()).activation_method, 'autonomous')
  const upgradedBuyer = await db.select().from(schema.agents).where(eq(schema.agents.id, buyer.agent.id)).get()
  assert.notEqual(upgradedBuyer?.api_key, legacyDigest, 'legacy API key digests should upgrade after successful auth')

  const sellerStatus = await status(request('/api/agents/status', 'GET', undefined, seller.agent.api_key, 'x-clawdmarket-agent-key'))
  assert.equal(sellerStatus.status, 200)
  assert.equal((await sellerStatus.json()).status, 'active')
  const bearerStatus = await status(new NextRequest('https://clawdmkt.test/api/agents/status', {
    headers: { authorization: `Bearer ${buyer.agent.api_key}` },
  }))
  assert.equal(bearerStatus.status, 200)

  assert.equal((await heartbeat(request(`/api/agents/${buyer.agent.id}/heartbeat`, 'POST', {}, buyer.agent.api_key), { params: Promise.resolve({ id: buyer.agent.id }) })).status, 200)
  const diagnostics = await selfTest(request('/api/agent/self-test', 'GET', undefined, buyer.agent.api_key))
  assert.notEqual((await diagnostics.json()).status, 'fail')
  assert.equal((await usage(request('/api/agents/usage', 'GET', undefined, buyer.agent.api_key))).status, 200)
  assert.equal((await inbox(request('/api/agents/inbox', 'GET', undefined, seller.agent.api_key))).status, 200)
  const deliveryHistory = await webhookDeliveries(request('/api/webhooks/deliveries', 'GET', undefined, seller.agent.api_key))
  assert.equal(deliveryHistory.status, 200)
  assert.deepEqual((await deliveryHistory.json()).deliveries, [])

  const emptyListings = await db.select().from(schema.listings).where(eq(schema.listings.seller_id, `user_agent_${seller.agent.id}`))
  assert.equal(emptyListings.length, 0, 'registration must not silently publish a generic service')
  const service = await listing(request('/api/listings', 'POST', {
    category: 'analysis', title: 'Isolated research report',
    description: 'A scoped research report with findings, citations, and a concise risk summary.', price_bankr: 2,
  }, seller.agent.api_key))
  assert.equal(service.status, 201)
  assert.equal((await payout(request('/api/payments/payout-address', 'PUT', { address: `0x${'12'.repeat(20)}` }, seller.agent.api_key))).status, 200)

  const taskResponse = await tasks.POST(request('/api/tasks', 'POST', {
    title: 'Research isolated onboarding',
    description: 'Verify the complete autonomous onboarding and task coordination path.',
    required_capabilities: ['web-research'], budget_usd: 2,
  }, buyer.agent.api_key))
  assert.equal(taskResponse.status, 200)
  const task = await taskResponse.json()
  const taskList = await tasks.GET(request('/api/tasks?status=open'))
  assert.equal((await taskList.json()).tasks.some((row: any) => row.id === task.task_id), true)

  const bidResponse = await bid(request(`/api/tasks/${task.task_id}/bid`, 'POST', {
    price_usd: 2, message: 'I can return a cited report.', eta_seconds: 600,
  }, seller.agent.api_key), { params: Promise.resolve({ id: task.task_id }) })
  assert.equal(bidResponse.status, 200)
  const placedBid = await bidResponse.json()
  assert.equal((await bids(request('/api/agents/bids', 'GET', undefined, seller.agent.api_key))).status, 200)

  const accepted = await accept(request(`/api/tasks/${task.task_id}/accept/${placedBid.bid_id}`, 'POST', {}, buyer.agent.api_key), {
    params: Promise.resolve({ id: task.task_id, bid_id: placedBid.bid_id }),
  })
  assert.equal(accepted.status, 200)
  assert.equal((await work(request('/api/work', 'GET', undefined, buyer.agent.api_key))).status, 200)
  assert.equal((await work(request('/api/work', 'GET', undefined, seller.agent.api_key))).status, 200)
})

test('owner-claim registration blocks marketplace actions until the private claim is completed', async () => {
  const owner = await createAccount('owner@example.test')
  const malformed = await claim.POST(new NextRequest('https://clawdmkt.test/api/claim', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${owner.token}`, 'x-forwarded-for': '198.51.100.240' },
    body: '{',
  }))
  assert.equal(malformed.status, 400)
  const assisted = await registerAgent('Owner Assisted Agent')
  assert.equal(assisted.agent.status, 'pending_claim')
  assert.equal(assisted.agent.human_approval_required, true)
  assert.match(assisted.agent.claim_url, /\/claim\/claim_/)

  const pending = await status(request('/api/agents/status', 'GET', undefined, assisted.agent.api_key))
  assert.equal((await pending.json()).status, 'pending_claim')
  assert.equal((await heartbeat(request(`/api/agents/${assisted.agent.id}/heartbeat`, 'POST', {}, assisted.agent.api_key), { params: Promise.resolve({ id: assisted.agent.id }) })).status, 401)
  assert.equal((await listing(request('/api/listings', 'POST', {
    category: 'analysis', title: 'Should not publish',
    description: 'This listing must remain blocked until owner activation is complete.', price_bankr: 1,
  }, assisted.agent.api_key))).status, 401)

  const code = new URL(assisted.agent.claim_url).pathname.split('/').pop()!
  assert.equal((await claim.GET(request(`/api/claim?code=${encodeURIComponent(code)}`))).status, 200)
  const claimed = await claim.POST(accountRequest('/api/claim', owner.token, 'POST', { code, email: owner.email }))
  assert.equal(claimed.status, 200)
  const claimedBody = await claimed.json()
  assert.equal(claimedBody.activation_method, 'owner_claim')
  assert.equal(claimedBody.owner_recovery_enabled, true)
  assert.equal(claimedBody.owner_user_id, owner.id)

  const active = await status(request('/api/agents/status', 'GET', undefined, assisted.agent.api_key))
  const activeBody = await active.json()
  assert.equal(activeBody.status, 'claimed')
  assert.equal(activeBody.human_approval_required, false)
  assert.equal((await heartbeat(request(`/api/agents/${assisted.agent.id}/heartbeat`, 'POST', {}, assisted.agent.api_key), { params: Promise.resolve({ id: assisted.agent.id }) })).status, 200)
  const generated = await db.select().from(schema.listings).where(eq(schema.listings.seller_id, `user_agent_${assisted.agent.id}`))
  assert.equal(generated.length, 0)
})

test('agent credential rotation is atomic, overlapping, and auditable', async () => {
  const agent = await registerAgent('Credential Rotation Agent', 'autonomous')
  const oldKey = agent.agent.api_key

  const attempts = await Promise.all([
    rotateCredential(request('/api/agents/credentials/rotate', 'POST', undefined, oldKey)),
    rotateCredential(request('/api/agents/credentials/rotate', 'POST', undefined, oldKey)),
  ])
  assert.equal(attempts.filter((response) => response.status === 200).length, 1)
  assert.equal(attempts.filter((response) => response.status !== 200).length, 1)
  assert.ok([403, 409].includes(attempts.find((response) => response.status !== 200)!.status))

  const rotatedResponse = attempts.find((response) => response.status === 200)!
  const rotated = await rotatedResponse.json()
  const newKey = rotated.credential.api_key
  assert.match(newKey, /^clawd_[a-f0-9]{48}$/)
  assert.equal(rotated.credential.prefix, newKey.slice(0, 12))
  assert.ok(rotated.credential.previous_key_valid_until)
  assert.equal(JSON.stringify(rotated).includes(oldKey), false)

  const oldStatus = await status(request('/api/agents/status', 'GET', undefined, oldKey))
  assert.equal(oldStatus.status, 200)
  assert.equal((await oldStatus.json()).credential.authenticated_with, 'previous')
  const newStatus = await status(request('/api/agents/status', 'GET', undefined, newKey))
  assert.equal(newStatus.status, 200)
  const newStatusBody = await newStatus.json()
  assert.equal(newStatusBody.credential.authenticated_with, 'current')
  assert.equal(newStatusBody.credential.prefix, newKey.slice(0, 12))
  assert.equal(newStatusBody.credential.previous_prefix, oldKey.slice(0, 12))

  const oldCannotRotate = await rotateCredential(request('/api/agents/credentials/rotate', 'POST', undefined, oldKey))
  assert.equal(oldCannotRotate.status, 403)
  assert.equal((await oldCannotRotate.json()).error, 'current_credential_required')
  const overlapBlocksAnotherRotation = await rotateCredential(request('/api/agents/credentials/rotate', 'POST', undefined, newKey))
  assert.equal(overlapBlocksAnotherRotation.status, 409)
  assert.equal((await overlapBlocksAnotherRotation.json()).error, 'rotation_overlap_active')

  const oldCannotRevoke = await revokePreviousCredential(request('/api/agents/credentials/previous', 'DELETE', undefined, oldKey))
  assert.equal(oldCannotRevoke.status, 403)
  const revoked = await revokePreviousCredential(request('/api/agents/credentials/previous', 'DELETE', undefined, newKey))
  assert.equal(revoked.status, 200)
  assert.equal((await revoked.json()).revoked, true)
  assert.equal((await status(request('/api/agents/status', 'GET', undefined, oldKey))).status, 401)
  assert.equal((await status(request('/api/agents/status', 'GET', undefined, newKey))).status, 200)

  const idempotent = await revokePreviousCredential(request('/api/agents/credentials/previous', 'DELETE', undefined, newKey))
  assert.equal(idempotent.status, 200)
  assert.equal((await idempotent.json()).revoked, false)

  const events = await db.select().from(schema.agent_lifecycle_events)
    .where(eq(schema.agent_lifecycle_events.agent_id, agent.agent.id))
  assert.deepEqual(
    events.map((event) => event.action).filter((action) => action.startsWith('credential_')).sort(),
    ['credential_previous_revoked', 'credential_rotated'],
  )
})

test('named credentials enforce scopes and can be independently revoked', async () => {
  const agent = await registerAgent('Scoped Credential Agent', 'autonomous')
  const primaryKey = agent.agent.api_key

  const readerResponse = await credentials.POST(request('/api/agents/credentials', 'POST', {
    name: 'read-only-monitor',
    scopes: ['agent:read'],
    expires_in_days: 30,
  }, primaryKey))
  assert.equal(readerResponse.status, 201)
  const reader = (await readerResponse.json()).credential
  assert.match(reader.api_key, /^clawd_[a-f0-9]{48}$/)
  assert.deepEqual(reader.scopes, ['agent:read'])
  assert.equal((await status(request('/api/agents/status', 'GET', undefined, reader.api_key))).status, 200)
  assert.equal((await inbox(request('/api/agents/inbox', 'GET', undefined, reader.api_key))).status, 200)
  assert.equal((await heartbeat(
    request(`/api/agents/${agent.agent.id}/heartbeat`, 'POST', {}, reader.api_key),
    { params: Promise.resolve({ id: agent.agent.id }) },
  )).status, 401)
  assert.equal((await listing(request('/api/listings', 'POST', {
    category: 'analysis',
    title: 'Scope bypass attempt',
    description: 'A read-only credential must never be able to publish this service.',
    price_bankr: 1,
  }, reader.api_key))).status, 401)
  assert.equal((await credentials.GET(request('/api/agents/credentials', 'GET', undefined, reader.api_key))).status, 403)

  const managerResponse = await credentials.POST(request('/api/agents/credentials', 'POST', {
    name: 'credential-manager',
    scopes: ['agent:read', 'credentials:write'],
  }, primaryKey))
  assert.equal(managerResponse.status, 201)
  const manager = (await managerResponse.json()).credential
  const escalated = await credentials.POST(request('/api/agents/credentials', 'POST', {
    name: 'escalated-payment-key',
    scopes: ['payments:write'],
  }, manager.api_key))
  assert.equal(escalated.status, 403)
  assert.equal((await escalated.json()).error, 'scope_escalation_forbidden')

  const delegatedResponse = await credentials.POST(request('/api/agents/credentials', 'POST', {
    name: 'delegated-reader',
    scopes: ['agent:read'],
  }, manager.api_key))
  assert.equal(delegatedResponse.status, 201)
  const delegated = (await delegatedResponse.json()).credential
  assert.equal((await status(request('/api/agents/status', 'GET', undefined, delegated.api_key))).status, 200)

  const listed = await credentials.GET(request('/api/agents/credentials', 'GET', undefined, manager.api_key))
  assert.equal(listed.status, 200)
  const listedBody = await listed.json()
  assert.equal(listedBody.credentials.primary.id, 'primary')
  assert.equal(listedBody.credentials.named.some((item: any) => item.id === reader.id), true)

  const revoked = await revokeNamedCredential(
    request(`/api/agents/credentials/${reader.id}`, 'DELETE', { reason: 'Monitor retired' }, manager.api_key),
    { params: Promise.resolve({ id: reader.id }) },
  )
  assert.equal(revoked.status, 200)
  assert.equal((await revoked.json()).revoked, true)
  assert.equal((await status(request('/api/agents/status', 'GET', undefined, reader.api_key))).status, 401)
  assert.equal((await status(request('/api/agents/status', 'GET', undefined, manager.api_key))).status, 200)

  const events = await db.select().from(schema.agent_lifecycle_events)
    .where(eq(schema.agent_lifecycle_events.agent_id, agent.agent.id))
  assert.deepEqual(
    events.map((event) => event.action).filter((action) => ['credential_created', 'credential_revoked'].includes(action)).sort(),
    ['credential_created', 'credential_created', 'credential_created', 'credential_revoked'],
  )
})

test('a linked owner can recover credentials and transfer ownership without residual access', async () => {
  const owner = await createAccount('first-owner@example.test')
  const nextOwner = await createAccount('next-owner@example.test')
  const stranger = await createAccount('stranger@example.test')
  const agent = await registerAgent('Owner Recovery Agent', 'autonomous')
  const originalKey = agent.agent.api_key

  const linked = await ownership.POST(accountRequest('/api/agents/ownership', owner.token, 'POST', undefined, originalKey))
  assert.equal(linked.status, 200)
  assert.equal((await linked.json()).recovery_enabled, true)
  const owned = await ownership.GET(accountRequest('/api/agents/ownership', owner.token))
  assert.equal((await owned.json()).owned_agents.some((item: any) => item.agent_id === agent.agent.id), true)

  const delegatedResponse = await credentials.POST(request('/api/agents/credentials', 'POST', {
    name: 'automation-worker',
    scopes: ['agent:read', 'marketplace:write'],
  }, originalKey))
  const delegatedKey = (await delegatedResponse.json()).credential.api_key

  const recoveredResponse = await recoverCredentials(
    accountRequest(`/api/agents/${agent.agent.id}/ownership/recover`, owner.token, 'POST'),
    { params: Promise.resolve({ id: agent.agent.id }) },
  )
  assert.equal(recoveredResponse.status, 200)
  const recoveredKey = (await recoveredResponse.json()).credential.api_key
  assert.equal((await status(request('/api/agents/status', 'GET', undefined, originalKey))).status, 401)
  assert.equal((await status(request('/api/agents/status', 'GET', undefined, delegatedKey))).status, 401)
  assert.equal((await status(request('/api/agents/status', 'GET', undefined, recoveredKey))).status, 200)

  const cancelledTransferResponse = await createOwnershipTransfer(
    accountRequest(`/api/agents/${agent.agent.id}/ownership/transfers`, owner.token, 'POST', {
      target_email: stranger.email,
    }),
    { params: Promise.resolve({ id: agent.agent.id }) },
  )
  assert.equal(cancelledTransferResponse.status, 201)
  const cancelledTransfer = (await cancelledTransferResponse.json()).transfer
  const cancelled = await cancelOwnershipTransfer(
    accountRequest(
      `/api/agents/${agent.agent.id}/ownership/transfers/${cancelledTransfer.id}`,
      owner.token,
      'DELETE',
    ),
    { params: Promise.resolve({ id: agent.agent.id, transferId: cancelledTransfer.id }) },
  )
  assert.equal(cancelled.status, 200)
  const rejectedCancelledTransfer = await acceptOwnershipTransfer(accountRequest(
    '/api/agents/ownership/transfers/accept',
    stranger.token,
    'POST',
    { token: cancelledTransfer.accept_token },
  ))
  assert.equal(rejectedCancelledTransfer.status, 409)

  const transferResponse = await createOwnershipTransfer(
    accountRequest(`/api/agents/${agent.agent.id}/ownership/transfers`, owner.token, 'POST', {
      target_email: nextOwner.email,
    }),
    { params: Promise.resolve({ id: agent.agent.id }) },
  )
  assert.equal(transferResponse.status, 201)
  const transfer = (await transferResponse.json()).transfer
  assert.match(transfer.accept_token, /^clawd_transfer_[a-f0-9]{64}$/)

  const wrongRecipient = await acceptOwnershipTransfer(accountRequest(
    '/api/agents/ownership/transfers/accept',
    stranger.token,
    'POST',
    { token: transfer.accept_token },
  ))
  assert.equal(wrongRecipient.status, 403)

  const acceptedResponse = await acceptOwnershipTransfer(accountRequest(
    '/api/agents/ownership/transfers/accept',
    nextOwner.token,
    'POST',
    { token: transfer.accept_token },
  ))
  assert.equal(acceptedResponse.status, 200)
  const transferredKey = (await acceptedResponse.json()).credential.api_key
  assert.equal((await status(request('/api/agents/status', 'GET', undefined, recoveredKey))).status, 401)
  assert.equal((await status(request('/api/agents/status', 'GET', undefined, transferredKey))).status, 200)

  const oldOwnerRecovery = await recoverCredentials(
    accountRequest(`/api/agents/${agent.agent.id}/ownership/recover`, owner.token, 'POST'),
    { params: Promise.resolve({ id: agent.agent.id }) },
  )
  assert.equal(oldOwnerRecovery.status, 403)
  const replay = await acceptOwnershipTransfer(accountRequest(
    '/api/agents/ownership/transfers/accept',
    nextOwner.token,
    'POST',
    { token: transfer.accept_token },
  ))
  assert.equal(replay.status, 409)

  const stored = await db.select().from(schema.agents).where(eq(schema.agents.id, agent.agent.id)).get()
  assert.equal(stored?.owner_email, nextOwner.email)
  const events = await db.select().from(schema.agent_lifecycle_events)
    .where(eq(schema.agent_lifecycle_events.agent_id, agent.agent.id))
  const actions = events.map((event) => event.action)
  assert.equal(actions.includes('ownership_linked'), true)
  assert.equal(actions.includes('credential_recovered'), true)
  assert.equal(actions.includes('ownership_transfer_requested'), true)
  assert.equal(actions.includes('ownership_transfer_cancelled'), true)
  assert.equal(actions.includes('ownership_transferred'), true)
})

test('a sponsored ephemeral canary stays private and archives without stranding work', async () => {
  const unsponsored = await register(request('/api/agents/register', 'POST', {
    name: 'Unsponsored Canary',
    activation_mode: 'autonomous',
    lifecycle_mode: 'ephemeral',
  }))
  assert.equal(unsponsored.status, 403)
  assert.equal((await unsponsored.json()).error, 'sponsor_required')

  const sponsor = await registerAgent('Canary Sponsor', 'autonomous')
  const created = await register(request('/api/agents/register', 'POST', {
    name: 'Release Canary Agent',
    description: 'Private production lifecycle verification agent.',
    capabilities: ['web-research'],
    activation_mode: 'autonomous',
    lifecycle_mode: 'ephemeral',
    profile_visibility: 'public',
  }, sponsor.agent.api_key))
  assert.equal(created.status, 201)
  const canary = await created.json()
  assert.equal(canary.agent.lifecycle_mode, 'ephemeral')
  assert.equal(canary.agent.profile_visibility, 'private')
  assert.equal(canary.agent.profile_url, null)
  assert.equal(canary.agent.sponsor_agent_id, sponsor.agent.id)

  const selfStatus = await status(request('/api/agents/status', 'GET', undefined, canary.agent.api_key))
  assert.equal(selfStatus.status, 200)
  const stored = await db.select().from(schema.agents).where(eq(schema.agents.id, canary.agent.id)).get()
  assert.equal(stored?.apiKeyPrefix, canary.agent.api_key.slice(0, 12))
  assert.ok(stored?.apiKeyLastUsedAt)

  const publicAgents = await agentDirectory(request('/api/agents/list?limit=100'))
  assert.equal((await publicAgents.json()).agents.some((row: any) => row.id === canary.agent.id), false)
  const search = await agentSearch(request('/api/agents/search?q=release+canary&limit=50'))
  assert.equal((await search.json()).agents.some((row: any) => row.id === canary.agent.id), false)
  assert.equal((await agentDetail(request(`/api/agents/${canary.agent.id}`), { params: Promise.resolve({ id: canary.agent.id }) })).status, 404)
  assert.equal((await agentDetail(request(`/api/agents/${canary.agent.id}`, 'GET', undefined, canary.agent.api_key), { params: Promise.resolve({ id: canary.agent.id }) })).status, 200)

  const serviceResponse = await listing(request('/api/listings', 'POST', {
    category: 'analysis',
    title: 'Private canary report',
    description: 'A private listing used to validate the production agent lifecycle.',
    price_bankr: 1,
  }, canary.agent.api_key))
  assert.equal(serviceResponse.status, 201)
  const service = (await serviceResponse.json()).listing
  const publicListings = await listingDirectory(request(`/api/listings?seller_id=user_agent_${canary.agent.id}&limit=50`))
  assert.equal((await publicListings.json()).listings.length, 0)
  assert.equal((await listingDetail(request(`/api/listings/${service.id}`), { params: Promise.resolve({ id: service.id }) })).status, 404)
  assert.equal((await listingDetail(request(`/api/listings/${service.id}`, 'GET', undefined, canary.agent.api_key), { params: Promise.resolve({ id: service.id }) })).status, 200)
  assert.equal((await tradePreview(request('/api/trades/preview', 'POST', { listing_id: service.id }))).status, 409)

  const taskResponse = await tasks.POST(request('/api/tasks', 'POST', {
    title: 'Canary active obligation',
    description: 'This open task must prevent the agent from being archived.',
    required_capabilities: ['web-research'],
    budget_usd: 1,
  }, canary.agent.api_key))
  assert.equal(taskResponse.status, 200)
  const task = await taskResponse.json()

  const blocked = await archiveAgent(request(`/api/agents/register/${canary.agent.id}`, 'DELETE', {
    reason: 'Post-deployment canary cleanup',
  }, canary.agent.api_key), { params: Promise.resolve({ id: canary.agent.id }) })
  assert.equal(blocked.status, 409)
  assert.equal((await blocked.json()).blockers.active_tasks, 1)
  assert.equal((await status(request('/api/agents/status', 'GET', undefined, canary.agent.api_key))).status, 200)
  assert.equal((await db.select().from(schema.listings).where(eq(schema.listings.id, service.id)).get())?.status, 'active')

  await db.update(schema.tasks).set({ status: 'cancelled' }).where(eq(schema.tasks.id, task.task_id))
  const archived = await archiveAgent(request(`/api/agents/register/${canary.agent.id}`, 'DELETE', {
    reason: 'Post-deployment canary cleanup',
  }, canary.agent.api_key), { params: Promise.resolve({ id: canary.agent.id }) })
  assert.equal(archived.status, 200)
  const archivedBody = await archived.json()
  assert.equal(archivedBody.status, 'archived')
  assert.equal(archivedBody.credential_revoked, true)
  assert.equal((await status(request('/api/agents/status', 'GET', undefined, canary.agent.api_key))).status, 401)

  const archivedAgent = await db.select().from(schema.agents).where(eq(schema.agents.id, canary.agent.id)).get()
  assert.ok(archivedAgent?.archivedAt)
  assert.ok(archivedAgent?.apiKeyRevokedAt)
  assert.equal(archivedAgent?.status, 'inactive')
  const archivedListing = await db.select().from(schema.listings).where(eq(schema.listings.id, service.id)).get()
  assert.equal(archivedListing?.status, 'expired')
  const events = await db.select().from(schema.agent_lifecycle_events).where(eq(schema.agent_lifecycle_events.agent_id, canary.agent.id))
  assert.deepEqual(events.map((event) => event.action).sort(), ['archived', 'registered'])
})

test('the authenticated cleanup worker retires abandoned ephemeral agents', async () => {
  const sponsor = await registerAgent('Cleanup Sponsor', 'autonomous')
  const created = await register(request('/api/agents/register', 'POST', {
    name: 'Abandoned Release Canary',
    activation_mode: 'autonomous',
    lifecycle_mode: 'ephemeral',
  }, sponsor.agent.api_key))
  assert.equal(created.status, 201)
  const canary = await created.json()
  await db.update(schema.agents)
    .set({ created_at: new Date(Date.now() - 3 * 60 * 60 * 1000) })
    .where(eq(schema.agents.id, canary.agent.id))

  assert.equal((await cleanupCanaries(request('/api/cron/agent-canaries'))).status, 401)
  const cleaned = await cleanupCanaries(new NextRequest('https://clawdmkt.test/api/cron/agent-canaries', {
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  }))
  assert.equal(cleaned.status, 200)
  const body = await cleaned.json()
  assert.equal(body.outcomes.some((outcome: any) => outcome.agent_id === canary.agent.id && outcome.result === 'archived'), true)
  assert.equal((await status(request('/api/agents/status', 'GET', undefined, canary.agent.api_key))).status, 401)
})

test('version publication cannot strand work and never silently republishes a service', async () => {
  const parent = await registerAgent('Versioned Agent', 'autonomous')
  const serviceResponse = await listing(request('/api/listings', 'POST', {
    category: 'code',
    title: 'Versioned code review',
    description: 'A concrete service that belongs to the current active version.',
    price_bankr: 3,
  }, parent.agent.api_key))
  const service = (await serviceResponse.json()).listing
  const taskResponse = await tasks.POST(request('/api/tasks', 'POST', {
    title: 'Version blocker task',
    description: 'Open work must prevent replacement of the authenticated version.',
    required_capabilities: ['code-review'],
    budget_usd: 3,
  }, parent.agent.api_key))
  const task = await taskResponse.json()

  const blocked = await register(request('/api/agents/register', 'POST', {
    name: 'Versioned Agent v2',
    parent_version_id: parent.agent.id,
    change_description: 'Improve retry handling.',
  }, parent.agent.api_key))
  assert.equal(blocked.status, 409)
  assert.equal((await blocked.json()).error, 'active_obligations')
  assert.equal((await db.select().from(schema.agents).where(eq(schema.agents.id, parent.agent.id)).get())?.status, 'active')
  assert.equal((await db.select().from(schema.listings).where(eq(schema.listings.id, service.id)).get())?.status, 'active')

  await db.update(schema.tasks).set({ status: 'cancelled' }).where(eq(schema.tasks.id, task.task_id))
  const published = await register(request('/api/agents/register', 'POST', {
    name: 'Versioned Agent v2',
    parent_version_id: parent.agent.id,
    change_description: 'Improve retry handling.',
  }, parent.agent.api_key))
  assert.equal(published.status, 200)
  const next = await published.json()
  assert.equal(next.version, 2)
  assert.equal(next.next_actions[0].action, 'publish_service')
  assert.equal((await db.select().from(schema.agents).where(eq(schema.agents.id, parent.agent.id)).get())?.status, 'inactive')
  assert.equal((await db.select().from(schema.listings).where(eq(schema.listings.id, service.id)).get())?.status, 'expired')
  const generated = await db.select().from(schema.listings).where(eq(schema.listings.seller_id, `user_agent_${next.agent.id}`))
  assert.equal(generated.length, 0)
  assert.equal((await status(request('/api/agents/status', 'GET', undefined, next.agent.api_key))).status, 200)
})
