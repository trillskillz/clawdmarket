import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { createLocalTestSchema } from '../helpers/local-schema'
import { reviewedListingFixture } from '../helpers/reviewed-listing-fixture'

let directory:string, database:string, db:typeof import('@/lib/db').db, schema:typeof import('@/lib/schema'), accounts:typeof import('@/lib/organization-spending-accounts')
before(async()=>{
  directory=await mkdtemp(join(tmpdir(),'clawdmarket-workspace-test-spending-read-'));database=join(directory,'read.db')
  Object.assign(process.env,{TURSO_DATABASE_URL:`file:${database}`,TURSO_AUTH_TOKEN:'',JWT_SECRET:'spending-read-fixture-only',AGENT_API_KEY_PEPPER:'spending-read-fixture-only-pepper',CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED:'true'})
  delete process.env.VERCEL;delete process.env.VERCEL_ENV
  db=(await import('@/lib/db')).db;schema=await import('@/lib/schema');await createLocalTestSchema(db.$client,schema)
  accounts=await import('@/lib/organization-spending-accounts')
})
after(async()=>{db?.$client.close();if(directory)await rm(directory,{recursive:true,force:true})})
async function fixture(){
  const f=await reviewedListingFixture({db,schema}),service=crypto.randomUUID()
  await db.insert(schema.service_definitions).values({id:service,seller_id:f.seller,title:'Separate spending read fixture',description:'No payment is authorized by read recovery.',capabilities:'["code-review"]',price_minor:100,status:'active'})
  const grant=await accounts.createSpendingAccount(f.org,f.owner,accounts.spendingAccountInput.parse({version:1,client_reference:crypto.randomUUID(),name:'Original read-only inspection fixture',buyer_agent_id:f.buyerAgent,team_id:f.team,cost_center:'TASK',allowed_services:[{service_id:service,provider_share_id:null}],max_purchase:'1.05',max_daily:'1.05',max_monthly:'1.05',max_lifetime:'1.05',expires_at:new Date(Date.now()+600000).toISOString()}))
  assert.ok(grant.api_key)
  return {...f,grant,request:new NextRequest(`http://localhost/api/organizations/${f.org}/spending-accounts/orders`,{headers:{Authorization:`Bearer ${grant.api_key}`}})}
}
async function exclusiveWriter(accountId?:string){
  const code="import sqlite3,sys\nc=sqlite3.connect(sys.argv[1],timeout=0)\nc.execute('BEGIN EXCLUSIVE')\nif len(sys.argv)>2:c.execute(\"UPDATE organization_spending_accounts SET state='revoked' WHERE id=?\",(sys.argv[2],))\nprint('locked',flush=True)\nsys.stdin.readline()\nc.commit()\nc.close()\n"
  const child=spawn('python3',['-u','-c',code,database,...(accountId?[accountId]:[])],{stdio:['pipe','pipe','pipe']})
  let errors='';child.stderr.on('data',chunk=>{errors+=chunk})
  const exited=once(child,'exit')
  const ready=await Promise.race([once(child.stdout,'data'),exited.then(()=>{throw Error(errors||'Exclusive writer did not reach its lock')})])
  assert.match(String(ready[0]),/locked/)
  return async()=>{child.stdin.end('\n');const [status]=await exited;assert.equal(status,0,errors)}
}
async function noFinancialWrites(){
  assert.equal((await db.select().from(schema.trades)).length,0)
  assert.equal((await db.select().from(schema.service_orders)).length,0)
  assert.equal((await db.select().from(schema.organization_spending_uses)).length,0)
  assert.equal((await db.select().from(schema.credit_entries)).length,0)
}
test('spending credential recovers an actual exclusive SQLite read lock without retrying a financial operation',async()=>{
  const f=await fixture(),release=await exclusiveWriter()
  const reading=accounts.resolveSpendingAccount(f.request,f.org).then(value=>({value,error:null}),error=>({value:null,error}))
  await new Promise(done=>setTimeout(done,100));await release()
  const result=await reading;assert.equal(result.error,null,String(result.error));assert.equal(result.value?.accountId,f.grant.account.id)
  await noFinancialWrites()
})
test('spending credential exhaustion is retryable storage unavailability and recovers the same credential after release',async()=>{
  const f=await fixture(),release=await exclusiveWriter()
  try{await assert.rejects(()=>accounts.resolveSpendingAccount(f.request,f.org),(error:unknown)=>(error as {code?:string;status?:number}).code==='PURCHASING_STORAGE_BUSY'&&(error as {status?:number}).status===503)}finally{await release()}
  assert.equal((await accounts.resolveSpendingAccount(f.request,f.org))?.accountId,f.grant.account.id);await noFinancialWrites()
})
test('spending credential read recovery observes revocation committed by the writer and cannot mint stale authority',async()=>{
  const f=await fixture(),release=await exclusiveWriter(f.grant.account.id)
  const reading=accounts.resolveSpendingAccount(f.request,f.org).then(value=>({value,error:null}),error=>({value:null,error}))
  await new Promise(done=>setTimeout(done,100));await release()
  const result=await reading;assert.equal(result.value,null);assert.equal(result.error?.code,'SPENDING_ACCOUNT_INACTIVE');assert.equal(result.error?.status,401)
  await noFinancialWrites()
})
