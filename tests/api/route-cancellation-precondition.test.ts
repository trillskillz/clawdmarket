import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { privateKeyToAccount } from 'viem/accounts'
import { createLocalTestSchema } from '../helpers/local-schema'
let directory: string, db: typeof import('@/lib/db').db, schema: typeof import('@/lib/schema')
let generateJWT: typeof import('@/lib/auth').generateJWT
let planRoute: typeof import('@/app/api/routes/plan/route').POST
let executeRoute: typeof import('@/app/api/routes/[id]/execute/route').POST
let cancelRoute: typeof import('@/app/api/routes/[id]/route').DELETE
const treasury = privateKeyToAccount(`0x${'99'.repeat(32)}`)
before(async () => {
  directory = mkdtempSync(join(tmpdir(),'clawdmarket-workspace-test-bound-cancel-'))
  process.env.TURSO_DATABASE_URL = `file:${join(directory,'cancel.db')}`; process.env.TURSO_AUTH_TOKEN = ''
  process.env.JWT_SECRET = 'bound-cancel-test-only'; process.env.CHAT_ENCRYPTION_KEY = 'bound-cancel-test-only'
  process.env.TREASURY_ADDRESS = treasury.address; process.env.EVM_SETTLEMENT_PRIVATE_KEY = `0x${'99'.repeat(32)}`
  process.env.EVM_ACCEPTED_TOKENS = JSON.stringify([{chainId:8453,chainName:'Dummy Base',address:`0x${'44'.repeat(20)}`,symbol:'USDC',decimals:6,fixedUsdPrice:1,confirmations:3,rpcUrl:'https://rpc.example.invalid'}])
  process.env.CLAWDMARKET_REUSABLE_SERVICES_ENABLED = 'true'; process.env.CLAWDMARKET_ROUTE_PLANNING_ENABLED = 'true'; process.env.CLAWDMARKET_ROUTE_EXECUTION_ENABLED = 'true'
  delete process.env.VERCEL; delete process.env.VERCEL_ENV
  db = (await import('@/lib/db')).db; schema = await import('@/lib/schema'); await createLocalTestSchema(db.$client,schema)
  generateJWT = (await import('@/lib/auth')).generateJWT
  planRoute = (await import('@/app/api/routes/plan/route')).POST; executeRoute = (await import('@/app/api/routes/[id]/execute/route')).POST; cancelRoute = (await import('@/app/api/routes/[id]/route')).DELETE
  await db.insert(schema.users).values(['route-buyer','route-seller','other-buyer'].map(id=>({id,name:id,email:`${id}@test.invalid`,password_hash:'unused'})))
  await db.insert(schema.payout_addresses).values({user_id:'route-seller',address:treasury.address})
})
after(() => { db?.$client.close(); if(directory) rmSync(directory,{recursive:true,force:true}) })
function request(path: string,userId: string,method: string,body?: unknown) {
  return new NextRequest(`http://localhost${path}`,{method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${generateJWT({userId,email:`${userId}@test.invalid`,role:'human'})}`},...(body === undefined ? {} : {body:JSON.stringify(body)})})
}
async function service() {
  const id = crypto.randomUUID()
  await db.insert(schema.service_definitions).values({id,seller_id:'route-seller',title:'Original bounded cancellation',description:'Review the original private input.',capabilities:'["code-review"]',price_minor:95,estimated_latency_seconds:30,max_concurrency:2,status:'active',verification_policy:JSON.stringify({required:true,methods:['buyer_review'],acceptance:{version:1,mode:'explicit_buyer'}})})
  return {id}
}

test('conditional cancellation binds the inspected original order and preserves legacy empty-body replay', async () => {
  const offered = await service()
  const response = await planRoute(request('/api/routes/plan', 'route-buyer', 'POST', {
    client_reference: `bound-cancel-${crypto.randomUUID()}`, objective: 'Review the original bounded cancellation target',
    required_capabilities: ['code-review'], provider_requirements: { approved_providers: ['route-seller'] },
    max_budget: { amount: '1.00', currency: 'USD' }, payment_policy: { allowed_rails: ['evm'] },
  }))
  assert.equal(response.status, 201)
  const { route } = await response.json(), context = { params: Promise.resolve({ id: route.id }) }, path = `/api/routes/${route.id}`
  const checkout = await executeRoute(request(path + '/execute', 'route-buyer', 'POST'), context)
  assert.equal(checkout.status, 201)
  const { order, trade } = await checkout.json()
  for (const expected of [null, crypto.randomUUID()]) {
    const denied = await cancelRoute(request(path,'route-buyer','DELETE',{ expected_service_order_id: expected }),context)
    assert.equal(denied.status,409); assert.equal((await denied.json()).error_code,'ROUTE_CANCELLATION_TARGET_CHANGED')
  }
  assert.equal((await cancelRoute(request(path,'other-buyer','DELETE',{expected_service_order_id:order.id}),context)).status,404)
  assert.equal((await cancelRoute(request(path,'route-buyer','DELETE',{unexpected: true}),context)).status,400)
  const oversized = await cancelRoute(request(path,'route-buyer','DELETE',{expected_service_order_id:'x'.repeat(2000)}),context)
  assert.equal(oversized.status,413)
  const [unchanged] = await db.select().from(schema.trades).where(eq(schema.trades.id,trade.id))
  assert.equal(unchanged.status,'pending')
  const cancelled = await cancelRoute(request(path,'route-buyer','DELETE',{expected_service_order_id:order.id}),context)
  assert.equal(cancelled.status,200); assert.equal((await cancelled.json()).payment_exposure.late_payment_possible,true)
  const replay = await cancelRoute(request(path,'route-buyer','DELETE'),context)
  assert.equal(replay.status,200); assert.equal((await replay.json()).idempotent,true)
  // The selected original service's capacity is released, without a replacement order.
  const [original] = await db.select().from(schema.service_orders).where(eq(schema.service_orders.id,order.id))
  assert.ok(original.capacity_released_at)
  assert.equal(original.service_id,offered.id)
  const [released] = await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id,offered.id))
  assert.equal(released.active_orders,0)
})
