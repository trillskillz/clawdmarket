import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { privateKeyToAccount } from 'viem/accounts'
import { createLocalTestSchema } from '../helpers/local-schema'
import { reviewedListingFixture } from '../helpers/reviewed-listing-fixture'
import { reviewedSharedTask } from '../helpers/reviewed-shared-task'
import { reviewedSharedService } from '../helpers/reviewed-shared-service'

let directory: string, db: typeof import('@/lib/db').db, schema: typeof import('@/lib/schema')
let listingDomain: typeof import('@/lib/organization-listing-authorizations') & typeof import('@/lib/organization-listing-checkout')
let jwt: typeof import('@/lib/auth').generateJWT
const treasuryKey = `0x${'99'.repeat(32)}` as const
const treasury = privateKeyToAccount(treasuryKey).address.toLowerCase()

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'clawdmarket-workspace-test-listing-shared-'))
  Object.assign(process.env, {
    TURSO_DATABASE_URL: `file:${join(directory, 'shared.db')}`, TURSO_AUTH_TOKEN: '',
    JWT_SECRET: 'listing-shared-fixture-only', TREASURY_ADDRESS: treasury, EVM_SETTLEMENT_PRIVATE_KEY: treasuryKey,
    MPP_RECIPIENT_ADDRESS: treasury, MPP_SECRET_KEY_CURRENT: 'listing-shared-mpp-fixture-only-secret',
    TEMPO_RPC_URL: 'https://rpc.example.invalid', CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED: 'true',
    CLAWDMARKET_ROUTE_PLANNING_ENABLED: 'true', CLAWDMARKET_ROUTE_EXECUTION_ENABLED: 'true',
    CLAWDMARKET_WORKFLOW_PLANNING_ENABLED: 'true', CLAWDMARKET_WORKFLOW_EXECUTION_ENABLED: 'true',
    CLAWDMARKET_REUSABLE_SERVICES_ENABLED: 'true', EVM_ACCEPTED_TOKENS: JSON.stringify([{
      chainId: 1, chainName: 'Shared exposure fixture', address: `0x${'44'.repeat(20)}`,
      symbol: 'TEST', decimals: 6, fixedUsdPrice: 1, confirmations: 1, rpcUrl: 'https://rpc.example.invalid',
    }]),
  })
  for (const name of ['VERCEL', 'VERCEL_ENV', 'CLAWDMARKET_NEW_PAYMENTS_PAUSED', 'DEV_WALLET_ADDRESS', 'DEV_FEE_WALLET_ADDRESS']) delete process.env[name]
  db = (await import('@/lib/db')).db
  schema = await import('@/lib/schema')
  await createLocalTestSchema(db.$client, schema)
  listingDomain = { ...await import('@/lib/organization-listing-authorizations'), ...await import('@/lib/organization-listing-checkout') }
  jwt = (await import('@/lib/auth')).generateJWT
})
after(async () => { db?.$client.close(); if (directory) await rm(directory, { recursive: true, force: true }) })

function request(path: string, actor: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, { method: 'POST', headers: {
    Authorization: `Bearer ${jwt({ userId: actor, email: `${actor}@test.invalid`, role: 'human' })}`,
    'Content-Type': 'application/json',
  }, body: JSON.stringify(body) })
}


for (const tempo of [false, true]) for (const family of ['route', 'workflow', 'task'] as const)
  for (const ceiling of ['gross', 'fee'] as const) for (const first of ['listing', 'service'] as const)
    test(`${tempo ? 'Tempo' : 'L1'} ${family}/listing original ${ceiling} exposure survives ${first}-first reservation and cancellation`, async () => {
      const f = await reviewedListingFixture({ db, schema }, tempo)
      const perFee = tempo ? '5000' : '100000000000000'
      const gross = ceiling === 'gross' ? '1.05' : '10.00', fee = ceiling === 'fee' ? perFee : (BigInt(perFee) * 10n).toString()
      const a = (await listingDomain.proposeOrganizationListing(f.org, f.owner, listingDomain.organizationListingInput.parse({ ...f.body,
        max_daily: gross, max_monthly: gross, max_lifetime: gross, max_lifetime_chain_fee_units: fee }))).authorization
      await listingDomain.approveOrganizationListing(f.org, a.id, f.reviewer, {
        version: a.version, client_reference: crypto.randomUUID(), authority_hash: a.authority_hash, approve: true,
      })
      const service = family === 'task' ? await reviewedSharedTask({ db, schema }, f, gross, fee) : await reviewedSharedService({ db, schema }, request, f, family, gross, fee)
      const checkout = { version: a.version, client_reference: crypto.randomUUID(), authority_hash: a.authority_hash }
      const listing = () => listingDomain.checkoutOrganizationListing(f.org, a.id, f.buyer, checkout)
      let tradeId: string
      if (first === 'listing') {
        const made = await listing(); assert.ok(made.trade); tradeId = made.trade.id
        const denied = await service(); assert.equal(denied.status, 409, JSON.stringify(denied))
        assert.match(denied.code, ceiling === 'gross' ? /(?:GROSS_LIMIT|DAILY_EXPOSURE)/ : /(?:(?:GAS|FEE(?:_TOKEN)?)_LIMIT|FEE_EXPOSURE)/)
      } else {
        const made = await service(); assert.equal(made.status, 201, JSON.stringify(made)); tradeId = made.trade.id
        await assert.rejects(listing, error => (error as { code?: string }).code === (ceiling === 'gross'
          ? 'ORGANIZATION_LISTING_DAILY_EXPOSURE' : 'ORGANIZATION_LISTING_FEE_EXPOSURE'))
      }
      const cancel = await (await import('@/app/api/trades/[id]/cancel/route')).POST(
        request(`/api/trades/${tradeId}/cancel`, f.buyer, {}), { params: Promise.resolve({ id: tradeId }) })
      assert.equal(cancel.status, 200, JSON.stringify(await cancel.clone().json()))
      if (first === 'listing') {
        const denied = await service(); assert.equal(denied.status, 409, JSON.stringify(denied))
      } else await assert.rejects(listing)
      assert.equal((await db.select().from(schema.trades).where(eq(schema.trades.buyer_id, f.buyer))).length, 1)
      assert.equal((await db.select().from(schema.organization_listing_uses).where(eq(schema.organization_listing_uses.listing_id, f.listing.id))).length, first === 'listing' ? 1 : 0)
    })

const childCode = `(async()=>{
  const a=JSON.parse(process.argv[1]),fs=await import('node:fs/promises'),{db}=await import('./lib/db.ts');
  try {
    await fs.writeFile(a.ready,'ready');
    while(true){try{await fs.readFile(a.start);break}catch{}await new Promise(done=>setTimeout(done,10))}
    if(a.kind==='listing'){
      const domain={...await import('./lib/organization-listing-authorizations.ts'),...await import('./lib/organization-listing-checkout.ts')};
      const result=await domain.checkoutOrganizationListing(a.org,a.id,a.actor,domain.organizationListingCheckoutInput.parse(a.body));
      console.log(JSON.stringify({status:result.created?201:200,trade_id:result.trade.id}));
    }else if(a.kind==='task'){
      const d=await import('./lib/organization-task-authorizations.ts');
      const result=await d.checkoutOrganizationTask(a.org,a.id,a.actor,d.organizationTaskCheckoutInput.parse(a.body));
      console.log(JSON.stringify({status:result.created?201:200,trade_id:result.trade.id}));
    }else{
      const {NextRequest}=await import('next/server'),{generateJWT}=await import('./lib/auth.ts'),{POST}=await import('./app/api/routes/[id]/execute/route.ts');
      const response=await POST(new NextRequest('http://localhost/api/routes/'+a.id+'/execute',{method:'POST',headers:{Authorization:'Bearer '+generateJWT({userId:a.actor,email:a.actor+'@test.invalid',role:'human'}),'Content-Type':'application/json'},body:JSON.stringify(a.body)}),{params:Promise.resolve({id:a.id})});
      const result=await response.json();console.log(JSON.stringify({status:response.status,code:result.error_code,trade_id:result.trade?.id}));
    }
  }catch(error){console.log(JSON.stringify({status:error.status||500,code:error.code||'UNEXPECTED_WORKER_FAILURE'}))}
  finally{db.$client.close()}
})()`

type WorkerCommand = { kind: 'listing' | 'service' | 'task'; org: string; id: string; actor: string; body: unknown; ready: string; start: string }
async function financialWorker(command: WorkerCommand, recoveryAttempt = 0): Promise<{ status: number; code?: string; trade_id?: string }> {
  const environment = { ...process.env }; delete environment.NODE_TEST_CONTEXT
  const response = await promisify(execFile)(process.execPath, ['--conditions=react-server', '--import', 'tsx', '-e', childCode, JSON.stringify(command)],
    { cwd: process.cwd(), env: environment, timeout: 45_000 })
  const result = JSON.parse(response.stdout.trim().split('\n').at(-1)!)
  if (result.status === 503 && ['PURCHASING_STORAGE_BUSY', 'SERVICE_RESERVATION_BUSY'].includes(result.code) && recoveryAttempt < 4) {
    await new Promise(done => setTimeout(done, 50 * 2 ** recoveryAttempt))
    return financialWorker(command, recoveryAttempt + 1)
  }
  assert.ok(result.status < 500, JSON.stringify(result) + response.stderr)
  return result
}

for (const tempo of [false, true]) for (const family of ['route', 'workflow', 'task'] as const)
  for (const ceiling of ['gross', 'fee'] as const)
    test(`separate ${tempo ? 'Tempo' : 'L1'} listing/${family} processes cannot race beyond shared ${ceiling} exposure`, async () => {
      const f = await reviewedListingFixture({ db, schema }, tempo), perFee = tempo ? '5000' : '100000000000000'
      const gross = ceiling === 'gross' ? '1.05' : '10.00', fee = ceiling === 'fee' ? perFee : (BigInt(perFee) * 10n).toString()
      const a = (await listingDomain.proposeOrganizationListing(f.org, f.owner, listingDomain.organizationListingInput.parse({ ...f.body,
        max_daily: gross, max_monthly: gross, max_lifetime: gross, max_lifetime_chain_fee_units: fee }))).authorization
      await listingDomain.approveOrganizationListing(f.org, a.id, f.reviewer, {
        version: a.version, client_reference: crypto.randomUUID(), authority_hash: a.authority_hash, approve: true,
      })
      const service = family === 'task' ? await reviewedSharedTask({ db, schema }, f, gross, fee) : await reviewedSharedService({ db, schema }, request, f, family, gross, fee), marker = join(directory, crypto.randomUUID()), start = marker + '.start'
      const commands: WorkerCommand[] = [{ kind: 'listing', org: f.org, id: a.id, actor: f.buyer,
        body: { version: a.version, client_reference: crypto.randomUUID(), authority_hash: a.authority_hash }, ready: marker + '.task', start },
      { kind: family === 'task' ? 'task' : 'service', org: f.org, id: 'authorizationId' in service ? service.authorizationId : service.routeId, actor: f.buyer,
        body: 'body' in service ? service.body : { mandate_id: service.mandateId }, ready: marker + '.service', start }]
      const workers = commands.map(command => financialWorker(command).then(value => ({ value, error: null })).catch(error => ({ value: null, error })))
      try {
        let ready = false
        for (let attempt = 0; attempt < 200; attempt++) {
          if ((await Promise.all(commands.map(command => readFile(command.ready).then(() => true).catch(() => false)))).every(Boolean)) { ready = true; break }
          await new Promise(done => setTimeout(done, 100))
        }
        assert.equal(ready, true, 'Both independent financial processes must reach the reservation barrier')
      } finally { await writeFile(start, 'go') }
      const results = await Promise.all(workers)
      for (const result of results) assert.equal(result.error, null, String(result.error))
      const responses = results.map(result => result.value!)
      assert.deepEqual(responses.map(result => result.status).sort(), [201, 409], JSON.stringify(responses))
      const loser = responses.findIndex(result => result.status === 409), recovered = await financialWorker(commands[loser])
      assert.equal(recovered.status, 409, JSON.stringify(recovered))
      assert.match(recovered.code!, ceiling === 'gross' ? /(?:GROSS_LIMIT|DAILY_EXPOSURE)/ : /(?:(?:GAS|FEE(?:_TOKEN)?)_LIMIT|FEE_EXPOSURE)/)
      const buyerTrades = await db.select().from(schema.trades).where(eq(schema.trades.buyer_id, f.buyer))
      assert.equal(buyerTrades.length, 1); assert.equal(buyerTrades[0].id, responses.find(result => result.status === 201)!.trade_id)
      const listingUses = await db.select().from(schema.organization_listing_uses).where(eq(schema.organization_listing_uses.listing_id, f.listing.id))
      const serviceOrders = await db.select().from(schema.service_orders).where(eq(schema.service_orders.buyer_id, f.buyer))
      const taskUses = await db.select({ id: schema.organization_task_uses.authorization_id }).from(schema.organization_task_uses).innerJoin(schema.trades, eq(schema.trades.id, schema.organization_task_uses.trade_id)).where(eq(schema.trades.buyer_id, f.buyer))
      assert.equal(listingUses.length + serviceOrders.length + taskUses.length, 1)
      const cancel = await (await import('@/app/api/trades/[id]/cancel/route')).POST(
        request(`/api/trades/${buyerTrades[0].id}/cancel`, f.buyer, {}), { params: Promise.resolve({ id: buyerTrades[0].id }) })
      assert.equal(cancel.status, 200)
      assert.equal((await financialWorker(commands[loser])).status, 409, 'Cancellation cannot recycle original shared exposure')
      assert.equal((await db.select().from(schema.trades).where(eq(schema.trades.buyer_id, f.buyer))).length, 1)
    })
