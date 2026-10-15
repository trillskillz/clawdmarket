import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { privateKeyToAccount } from 'viem/accounts'
import { createLocalTestSchema } from '../helpers/local-schema'
import { reviewedListingFixture } from '../helpers/reviewed-listing-fixture'

let directory:string,db:typeof import('@/lib/db').db,schema:typeof import('@/lib/schema'),domain:typeof import('@/lib/organization-listing-authorizations') & typeof import('@/lib/organization-listing-checkout') & typeof import('@/lib/organization-listing-uses')
const treasuryKey=`0x${'99'.repeat(32)}` as const,treasury=privateKeyToAccount(treasuryKey).address.toLowerCase(),token=`0x${'44'.repeat(20)}`
before(async()=>{
  directory=await mkdtemp(join(tmpdir(),'clawdmarket-workspace-test-listing-races-'))
  Object.assign(process.env,{TURSO_DATABASE_URL:`file:${join(directory,'races.db')}`,TURSO_AUTH_TOKEN:'',JWT_SECRET:'listing-races-fixture-only',TREASURY_ADDRESS:treasury,EVM_SETTLEMENT_PRIVATE_KEY:treasuryKey,
    MPP_RECIPIENT_ADDRESS:treasury,MPP_SECRET_KEY_CURRENT:'listing-races-mpp-fixture-only-secret',TEMPO_RPC_URL:'https://rpc.example.invalid',CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED:'true',CLAWDMARKET_ROUTE_EXECUTION_ENABLED:'true',CLAWDMARKET_REUSABLE_SERVICES_ENABLED:'true',
    EVM_ACCEPTED_TOKENS:JSON.stringify([{chainId:1,chainName:'Listing race fixture',address:token,symbol:'TEST',decimals:6,fixedUsdPrice:1,confirmations:1,rpcUrl:'https://rpc.example.invalid'}])})
  for(const name of ['VERCEL','VERCEL_ENV','CLAWDMARKET_NEW_PAYMENTS_PAUSED','DEV_WALLET_ADDRESS','DEV_FEE_WALLET_ADDRESS','CLAWDMARKET_AGENT_MAX_TRADE_USD'])delete process.env[name]
  db=(await import('@/lib/db')).db;schema=await import('@/lib/schema');await createLocalTestSchema(db.$client,schema);domain={...await import('@/lib/organization-listing-authorizations'),...await import('@/lib/organization-listing-checkout'),...await import('@/lib/organization-listing-uses')}
})
after(async()=>{db?.$client.close();if(directory)await rm(directory,{recursive:true,force:true})})
const fixture=(tempo=false)=>reviewedListingFixture({db,schema},tempo)
type Fixture=Awaited<ReturnType<typeof fixture>>
type Authorization=Awaited<ReturnType<typeof domain.proposeOrganizationListing>>['authorization']
const propose=(f:Fixture)=>domain.proposeOrganizationListing(f.org,f.owner,domain.organizationListingInput.parse(f.body))
const decision=(f:Fixture,a:Authorization)=>({version:a.version,client_reference:crypto.randomUUID(),authority_hash:a.authority_hash,approve:true as const})
const checkoutBody=(a:Authorization)=>({version:a.version,client_reference:crypto.randomUUID(),authority_hash:a.authority_hash})
async function approve(f:Fixture,a:Authorization){return domain.approveOrganizationListing(f.org,a.id,f.reviewer,decision(f,a))}
async function secondListing(f:Fixture){
  const id=crypto.randomUUID()
  const [listing]=await db.insert(schema.listings).values({...f.listing,id}).returning()
  return {...f,listing,body:{...f.body,client_reference:crypto.randomUUID(),listing_id:id}}
}
const childCode=`(async()=>{
  const a=JSON.parse(process.argv[1]),fs=await import('node:fs/promises'),{db}=await import('./lib/db.ts');
  try{
    const d={...await import('./lib/organization-listing-authorizations.ts'),...await import('./lib/organization-listing-checkout.ts')};
    const barrier=async()=>{if(a.ready){await fs.writeFile(a.ready,'ready');while(true){try{await fs.readFile(a.start);break}catch{}await new Promise(done=>setTimeout(done,10))}}};
    if(a.operation==='generic'&&a.ready){
      // Let the real fail-closed admission counter commit before racing inventory.
      // Otherwise its separate local SQLite write can itself return 429, which
      // establishes safe admission failure but does not exercise inventory CAS.
      const execute=db.$client.execute.bind(db.$client);
      db.$client.execute=async(query,...rest)=>{const result=await execute(query,...rest);if(typeof query==='object'&&query.sql?.includes('INSERT INTO rate_limits'))await barrier();return result};
    }else await barrier();
    let result;
    if(a.operation==='propose')result=await d.proposeOrganizationListing(a.org,a.actor,d.organizationListingInput.parse(a.body));
    else if(a.operation==='approve')result=await d.approveOrganizationListing(a.org,a.id,a.actor,d.organizationListingDecision.parse(a.body));
    else if(a.operation==='checkout')result=await d.checkoutOrganizationListing(a.org,a.id,a.actor,d.organizationListingCheckoutInput.parse(a.body));
    else {const {POST}=await import('./app/api/trades/route.ts'),{NextRequest}=await import('next/server'),{generateJWT}=await import('./lib/auth.ts');const jwt=generateJWT({userId:a.actor,email:a.actor+'@test.invalid',role:'human'});const response=await POST(new NextRequest('http://localhost/api/trades',{method:'POST',headers:{Authorization:'Bearer '+jwt,'Content-Type':'application/json'},body:JSON.stringify(a.body)}));console.log(JSON.stringify({status:response.status,body:await response.json()}));return}
    console.log(JSON.stringify({status:result.created||result.idempotent===false?201:200,body:result}));
  }catch(error){console.log(JSON.stringify({status:error.status||409,body:{error_code:error.code||error.message}}))}finally{db.$client.close()}
})()`
type Command={operation:'propose'|'approve'|'checkout'|'generic';org:string;actor:string;body:unknown;id?:string;listingId?:string}
type Result={status:number;body:{error_code?:string;created?:boolean;authorization?:Authorization;trade?:{id:string}}}
const childEnv=()=>{const env={...process.env};delete env.NODE_TEST_CONTEXT;return env}
async function worker(command:Command&{ready?:string;start?:string}, recoveryAttempt=0):Promise<Result>{
  const result=await promisify(execFile)(process.execPath,['--conditions=react-server','--import','tsx','-e',childCode,JSON.stringify(command)],{cwd:process.cwd(),env:childEnv(),timeout:20000})
  const response = JSON.parse(result.stdout.trim().split('\n').at(-1)!) as Result
  if(response.status===503&&response.body.error_code==='PURCHASING_STORAGE_BUSY'&&recoveryAttempt<4){
    // Recovery is a new process with the exact saved request, never a new authority or trade reference.
    await new Promise(done=>setTimeout(done,50*2**recoveryAttempt))
    return worker(command,recoveryAttempt+1)
  }
  if(response.status>=500)throw Error(`Worker ${command.operation} failed: ${result.stderr}`)
  return response
}
async function race(commands:Command[]){
  const marker=join(directory,crypto.randomUUID()),ready=commands.map((_,index)=>`${marker}-${index}.ready`),start=marker+'.start'
  const running=commands.map((command,index)=>worker({...command,ready:ready[index],start}).then(value=>({value,error:null})).catch(error=>({value:null,error})))
  try{
    let armed=false
    for(let attempt=0;attempt<100;attempt++){
      const seen=await Promise.all(ready.map(path=>readFile(path).then(()=>true).catch(()=>false)))
      if(seen.every(Boolean)){armed=true;break}await new Promise(done=>setTimeout(done,100))
    }
    assert.equal(armed,true,'All separate processes must reach the barrier before concurrent requests')
  }finally{await writeFile(start,'go')}
  const results=await Promise.all(running)
  for(const result of results)assert.equal(result.error,null,String(result.error))
  return results.map(result=>result.value!)
}

for(const tempo of [false,true])test(`independent ${tempo?'Tempo':'L1'} proposal/decision/checkout processes retain one exact original authority and trade`,async()=>{
  const f=await fixture(tempo),proposalResults=await race(Array.from({length:3},()=>({operation:'propose' as const,org:f.org,actor:f.owner,body:f.body})))
  assert.ok(proposalResults.every(r=>[200,201].includes(r.status)),JSON.stringify(proposalResults));assert.equal(new Set(proposalResults.map(r=>r.body.authorization!.id)).size,1)
  const a=proposalResults[0].body.authorization!,savedDecision=decision(f,a),decisionResults=await race(Array.from({length:3},()=>({operation:'approve' as const,org:f.org,id:a.id,actor:f.reviewer,body:savedDecision})))
  assert.ok(decisionResults.every(r=>[200,201].includes(r.status)),JSON.stringify(decisionResults));assert.equal(new Set(decisionResults.map(r=>r.body.authorization!.authority_hash)).size,1)
  const body=checkoutBody(a),checkouts=await race(Array.from({length:3},()=>({operation:'checkout' as const,org:f.org,id:a.id,actor:f.buyer,body})))
  assert.deepEqual(checkouts.map(r=>r.status).sort(),[200,200,201],JSON.stringify(checkouts));assert.equal(new Set(checkouts.map(r=>r.body.trade!.id)).size,1)
  const uses=await db.select().from(schema.organization_listing_uses).where(eq(schema.organization_listing_uses.authorization_id,a.id));assert.equal(uses.length,1);assert.equal(uses[0].amount_minor,105)
})

for(const tempo of [false,true])for(const ceiling of ['gross','fee','department']as const)test(`separate ${tempo?'Tempo':'L1'} listing checkouts cannot race beyond shared ${ceiling} exposure`,async()=>{
  const first=await fixture(tempo),second=await secondListing(first)
  for(const f of [first,second]){
    if(ceiling==='gross'){f.body.max_daily='1.05';f.body.max_monthly='1.05';f.body.max_lifetime='1.05'}
    if(ceiling==='fee')f.body.max_lifetime_chain_fee_units=tempo?'5000':'100000000000000'
  }
  if(ceiling==='department')await (await import('@/lib/organization-team-budgets')).updateTeamBudget(first.org,first.team,first.owner,(await import('@/lib/organization-budgets')).organizationBudgetInput.parse({expected_version:0,max_per_execution:'10.00',max_daily:'1.05',max_monthly:'1.05'}))
  const a=(await propose(first)).authorization,b=(await propose(second)).authorization;await approve(first,a);await approve(second,b)
  const commands=[{operation:'checkout' as const,org:first.org,id:a.id,actor:first.buyer,body:checkoutBody(a)},{operation:'checkout' as const,org:second.org,id:b.id,actor:second.buyer,body:checkoutBody(b)}],results=await race(commands)
  assert.equal(results.filter(r=>r.status===201).length,1,JSON.stringify(results));const loser=results.findIndex(r=>r.status!==201),retry=await worker(commands[loser]);assert.equal(retry.status,409,JSON.stringify(retry))
  assert.match(retry.body.error_code!,ceiling==='gross'?/ORGANIZATION_LISTING_(?:DAILY|MONTHLY|LIFETIME)_EXPOSURE/:ceiling==='fee'?/ORGANIZATION_LISTING_FEE_EXPOSURE/:/TEAM_(?:DAILY|MONTHLY)_LIMIT/)
  const uses=await db.select().from(schema.organization_listing_uses).where(eq(schema.organization_listing_uses.listing_id,results[0].status===201?first.listing.id:second.listing.id));assert.equal(uses.length,1)
  const exposure=await domain.organizationListingExposure(db,first.org,first.buyer,domain.organizationListingInput.parse(first.body).payment)
  assert.equal(exposure.lifetime,105);assert.equal(tempo?exposure.fees:exposure.gas,BigInt(tempo?'5000':'100000000000000'))
})

for(const tempo of [false,true])test(`generic ${tempo?'Tempo':'L1'} funding versus pending review proposal cannot commit both obligations`,async()=>{
  for(let repetition=0;repetition<3;repetition++){
    const f=await fixture(tempo);await db.update(schema.buyer_spend_policies).set({policy_json:'{"max_per_execution":500}'}).where(eq(schema.buyer_spend_policies.buyer_id,f.buyer))
    const results=await race([{operation:'propose',org:f.org,actor:f.owner,body:f.body},{operation:'generic',org:f.org,actor:f.buyer,listingId:f.listing.id,body:{listing_id:f.listing.id,amount:1,payment_rail:tempo?'mpp':'evm',client_reference:crypto.randomUUID()}}])
    assert.equal(results.filter(r=>r.status===201).length,1,JSON.stringify(results));assert.ok(results.every(r=>[201,409].includes(r.status)),JSON.stringify(results))
    const grants=await db.select().from(schema.organization_listing_authorizations).where(eq(schema.organization_listing_authorizations.organization_id,f.org)),[listing]=await db.select().from(schema.listings).where(eq(schema.listings.id,f.listing.id))
    assert.equal(Number(grants.length>0)+Number(listing.status==='sold'),1,'A pending review and generic listing trade must never coexist')
    if(grants.length){assert.equal(grants[0].state,'pending');assert.equal(listing.status,'active')}else assert.equal(listing.status,'sold')
  }
})

for(const tempo of [false,true])test(`original ${tempo?'Tempo':'L1'} listing proposal, decision and checkout survive real before/after commit SIGKILL`,async()=>{
  for(const operation of ['propose','approve','checkout']as const)for(const boundary of ['before','after']as const){
    const f=await fixture(tempo);let a:Authorization|null=null
    if(operation!=='propose')a=(await propose(f)).authorization
    if(operation==='checkout')await approve(f,a!)
    const savedDecision=a?decision(f,a):null,body=operation==='propose'?f.body:operation==='approve'?savedDecision:checkoutBody(a!),marker=join(directory,`${f.org}-${operation}-${boundary}.marker`)
    const code=`(async()=>{
      const a=JSON.parse(process.argv[1]),fs=await import('node:fs/promises'),{db}=await import('./lib/db.ts'),s=await import('./lib/schema.ts'),{eq}=await import('drizzle-orm');
      const stop=async()=>{await fs.writeFile(process.argv[2],'reached');await new Promise(()=>{setInterval(()=>{},1000)})};
      if(a.boundary==='before'){const proto=Object.getPrototypeOf(db.session),transaction=proto.transaction;proto.transaction=function(fn,config){return transaction.call(this,async tx=>{const result=await fn(tx);
        const [grant]=await tx.select().from(s.organization_listing_authorizations).where(eq(s.organization_listing_authorizations.organization_id,a.f.org));
        const ready=a.operation==='propose'?!!grant:a.operation==='approve'?grant?.state==='approved':(await tx.select().from(s.organization_listing_uses).where(eq(s.organization_listing_uses.authorization_id,a.id))).length===1;
        if(ready)await stop();return result},config)}}
      const d={...await import('./lib/organization-listing-authorizations.ts'),...await import('./lib/organization-listing-checkout.ts')};
      if(a.operation==='propose')await d.proposeOrganizationListing(a.f.org,a.f.owner,d.organizationListingInput.parse(a.body));
      else if(a.operation==='approve')await d.approveOrganizationListing(a.f.org,a.id,a.f.reviewer,d.organizationListingDecision.parse(a.body));
      else await d.checkoutOrganizationListing(a.f.org,a.id,a.f.buyer,d.organizationListingCheckoutInput.parse(a.body));
      await stop()
    })().catch(error=>{console.error(error);process.exitCode=1})`
    const child=spawn(process.execPath,['--conditions=react-server','--import','tsx','-e',code,JSON.stringify({operation,boundary,f,id:a?.id,body}),marker],{cwd:process.cwd(),env:childEnv(),stdio:['ignore','ignore','pipe']})
    let errors='';child.stderr.on('data',chunk=>{errors+=chunk});const exited=new Promise<void>((done,reject)=>{child.once('exit',()=>done());child.once('error',reject)})
    try{
      let reached=false
      for(let attempt=0;attempt<150;attempt++){try{await readFile(marker);reached=true;break}catch{}if(child.exitCode!==null)throw Error(errors);await new Promise(done=>setTimeout(done,100))}
      assert.equal(reached,true,errors);child.kill('SIGKILL');await exited
      assert.equal(child.signalCode,'SIGKILL')
      const grants=await db.select().from(schema.organization_listing_authorizations).where(eq(schema.organization_listing_authorizations.organization_id,f.org))
      if(operation==='propose')assert.equal(grants.length,boundary==='before'?0:1)
      if(operation==='approve')assert.equal(grants[0].state,boundary==='before'?'pending':'approved')
      const [listing]=await db.select().from(schema.listings).where(eq(schema.listings.id,f.listing.id))
      if(operation==='checkout'){
        assert.equal((await db.select().from(schema.organization_listing_uses).where(eq(schema.organization_listing_uses.authorization_id,a!.id))).length,boundary==='before'?0:1)
        assert.equal(Number(listing.status==='sold'),boundary==='before'?0:1)
        assert.equal((await db.select().from(schema.trades).where(eq(schema.trades.buyer_id,f.buyer))).length,boundary==='before'?0:1)
        assert.equal((await db.select().from(schema.organization_trade_attributions).where(eq(schema.organization_trade_attributions.organization_id,f.org))).length,boundary==='before'?0:1)
      }
      const recovered=await propose(f);a=recovered.authorization;if(grants.length)assert.equal(a.id,grants[0].id)
      const originalDecision=operation==='approve'?savedDecision!:grants[0]?.decision_reference?{version:a.version,client_reference:grants[0].decision_reference,authority_hash:a.authority_hash,approve:true as const}:decision(f,a)
      await domain.approveOrganizationListing(f.org,a.id,f.reviewer,originalDecision)
      const originalCheckout=operation==='checkout'?body as ReturnType<typeof checkoutBody>:checkoutBody(a)
      const reservation=await domain.checkoutOrganizationListing(f.org,a.id,f.buyer,originalCheckout),again=await domain.checkoutOrganizationListing(f.org,a.id,f.buyer,originalCheckout)
      assert.equal(again.created,false);assert.equal(again.trade?.id,reservation.trade?.id)
      assert.equal((await db.select().from(schema.organization_listing_uses).where(eq(schema.organization_listing_uses.authorization_id,a.id))).length,1)
      assert.equal((await db.select().from(schema.trades).where(eq(schema.trades.buyer_id,f.buyer))).length,1)
    }finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await exited}
  }
})

for (const tempo of [false,true]) test(`reviewed ${tempo?'Tempo':'L1'} checkout racing an unrelated generic buyer commits exactly one original trade`, async () => {
  for (let repetition=0;repetition<3;repetition++) {
    const f=await fixture(tempo),a=(await propose(f)).authorization;await approve(f,a)
    const commands:Command[]=[{operation:'checkout',org:f.org,id:a.id,actor:f.buyer,body:checkoutBody(a)},
      {operation:'generic',org:f.org,actor:f.other,body:{listing_id:f.listing.id,amount:1,payment_rail:tempo?'mpp':'evm',client_reference:crypto.randomUUID()}}]
    const results=await race(commands)
    assert.equal(results.filter(result=>result.status===201).length,1,JSON.stringify(results))
    assert.ok(results.every(result=>[201,409].includes(result.status)),JSON.stringify(results))
    const trades=await db.select().from(schema.trades).where(eq(schema.trades.listing_id,f.listing.id))
    const uses=await db.select().from(schema.organization_listing_uses).where(eq(schema.organization_listing_uses.listing_id,f.listing.id))
    assert.equal(trades.length,1);assert.equal(uses.length,results[0].status===201?1:0)
    assert.equal(trades[0].buyer_id,results[0].status===201?f.buyer:f.other)
  }
})
