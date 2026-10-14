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
import { reviewedTaskFixture } from '../helpers/reviewed-task-fixture'

let directory:string,db:typeof import('@/lib/db').db,schema:typeof import('@/lib/schema'),domain:typeof import('@/lib/organization-task-authorizations')
const treasuryKey=`0x${'99'.repeat(32)}` as const,treasury=privateKeyToAccount(treasuryKey).address.toLowerCase(),token=`0x${'44'.repeat(20)}`
before(async()=>{
  directory=await mkdtemp(join(tmpdir(),'clawdmarket-workspace-test-task-races-'))
  Object.assign(process.env,{TURSO_DATABASE_URL:`file:${join(directory,'races.db')}`,TURSO_AUTH_TOKEN:'',JWT_SECRET:'task-races-fixture-only',TREASURY_ADDRESS:treasury,EVM_SETTLEMENT_PRIVATE_KEY:treasuryKey,
    MPP_RECIPIENT_ADDRESS:treasury,MPP_SECRET_KEY_CURRENT:'task-races-mpp-fixture-only-secret',TEMPO_RPC_URL:'https://rpc.example.invalid',CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED:'true',CLAWDMARKET_ROUTE_EXECUTION_ENABLED:'true',CLAWDMARKET_REUSABLE_SERVICES_ENABLED:'true',
    EVM_ACCEPTED_TOKENS:JSON.stringify([{chainId:1,chainName:'Task race fixture',address:token,symbol:'TEST',decimals:6,fixedUsdPrice:1,confirmations:1,rpcUrl:'https://rpc.example.invalid'}])})
  for(const name of ['VERCEL','VERCEL_ENV','CLAWDMARKET_NEW_PAYMENTS_PAUSED','DEV_WALLET_ADDRESS','DEV_FEE_WALLET_ADDRESS','CLAWDMARKET_AGENT_MAX_TRADE_USD'])delete process.env[name]
  db=(await import('@/lib/db')).db;schema=await import('@/lib/schema');await createLocalTestSchema(db.$client,schema);domain=await import('@/lib/organization-task-authorizations')
})
after(async()=>{db?.$client.close();if(directory)await rm(directory,{recursive:true,force:true})})
const fixture=(tempo=false)=>reviewedTaskFixture({db,schema},tempo)
type Fixture=Awaited<ReturnType<typeof fixture>>
type Authorization=Awaited<ReturnType<typeof domain.proposeOrganizationTask>>['authorization']
const propose=(f:Fixture)=>domain.proposeOrganizationTask(f.org,f.owner,domain.organizationTaskInput.parse(f.body))
const decision=(f:Fixture,a:Authorization)=>({version:a.version,client_reference:crypto.randomUUID(),authority_hash:a.authority_hash,approve:true as const})
const checkoutBody=(a:Authorization)=>({version:a.version,client_reference:crypto.randomUUID(),authority_hash:a.authority_hash})
async function approve(f:Fixture,a:Authorization){return domain.approveOrganizationTask(f.org,a.id,f.reviewer,decision(f,a))}
async function secondTask(f:Fixture){
  const id=`legacy-task-${crypto.randomUUID()}`,bid=crypto.randomUUID()
  const [task]=await db.select().from(schema.tasks).where(eq(schema.tasks.id,f.task)),[originalBid]=await db.select().from(schema.bids).where(eq(schema.bids.id,f.bid)),[workspace]=await db.select().from(schema.task_workspaces).where(eq(schema.task_workspaces.task_id,f.task))
  await db.insert(schema.tasks).values({...task,id,winningBidId:bid});await db.insert(schema.bids).values({...originalBid,id:bid,taskId:id});await db.insert(schema.task_workspaces).values({...workspace,task_id:id,trade_id:null})
  return {...f,task:id,bid,body:{...f.body,client_reference:crypto.randomUUID(),task_id:id,winning_bid_id:bid}}
}
const childCode=`(async()=>{
  const a=JSON.parse(process.argv[1]),fs=await import('node:fs/promises'),{db}=await import('./lib/db.ts');
  try{
    const d=await import('./lib/organization-task-authorizations.ts');
    if(a.ready){await fs.writeFile(a.ready,'ready');while(true){try{await fs.readFile(a.start);break}catch{}await new Promise(done=>setTimeout(done,10))}}
    let result;
    if(a.operation==='propose')result=await d.proposeOrganizationTask(a.org,a.actor,d.organizationTaskInput.parse(a.body));
    else if(a.operation==='approve')result=await d.approveOrganizationTask(a.org,a.id,a.actor,d.organizationTaskDecision.parse(a.body));
    else if(a.operation==='checkout')result=await d.checkoutOrganizationTask(a.org,a.id,a.actor,d.organizationTaskCheckoutInput.parse(a.body));
    else {const {POST}=await import('./app/api/tasks/[id]/fund/route.ts'),{NextRequest}=await import('next/server'),{generateJWT}=await import('./lib/auth.ts');const jwt=generateJWT({userId:a.actor,email:a.actor+'@test.invalid',role:'human'});const response=await POST(new NextRequest('http://localhost/api/tasks/'+a.task+'/fund',{method:'POST',headers:{Authorization:'Bearer '+jwt,'Content-Type':'application/json'},body:JSON.stringify(a.body)}),{params:Promise.resolve({id:a.task})});console.log(JSON.stringify({status:response.status,body:await response.json()}));return}
    console.log(JSON.stringify({status:result.created||result.idempotent===false?201:200,body:result}));
  }catch(error){console.log(JSON.stringify({status:error.status||409,body:{error_code:error.code||error.message}}))}finally{db.$client.close()}
})()`
type Command={operation:'propose'|'approve'|'checkout'|'generic';org:string;actor:string;body:unknown;id?:string;task?:string}
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
  const uses=await db.select().from(schema.organization_task_uses).where(eq(schema.organization_task_uses.authorization_id,a.id));assert.equal(uses.length,1);assert.equal(uses[0].amount_minor,105)
})

for(const tempo of [false,true])for(const ceiling of ['gross','fee','department']as const)test(`separate ${tempo?'Tempo':'L1'} task checkouts cannot race beyond shared ${ceiling} exposure`,async()=>{
  const first=await fixture(tempo),second=await secondTask(first)
  for(const f of [first,second]){
    if(ceiling==='gross'){f.body.max_daily='1.05';f.body.max_monthly='1.05';f.body.max_lifetime='1.05'}
    if(ceiling==='fee')f.body.max_lifetime_chain_fee_units=tempo?'5000':'100000000000000'
  }
  if(ceiling==='department')await (await import('@/lib/organization-team-budgets')).updateTeamBudget(first.org,first.team,first.owner,(await import('@/lib/organization-budgets')).organizationBudgetInput.parse({expected_version:0,max_per_execution:'10.00',max_daily:'1.05',max_monthly:'1.05'}))
  const a=(await propose(first)).authorization,b=(await propose(second)).authorization;await approve(first,a);await approve(second,b)
  const commands=[{operation:'checkout' as const,org:first.org,id:a.id,actor:first.buyer,body:checkoutBody(a)},{operation:'checkout' as const,org:second.org,id:b.id,actor:second.buyer,body:checkoutBody(b)}],results=await race(commands)
  assert.equal(results.filter(r=>r.status===201).length,1,JSON.stringify(results));const loser=results.findIndex(r=>r.status!==201),retry=await worker(commands[loser]);assert.equal(retry.status,409,JSON.stringify(retry))
  assert.match(retry.body.error_code!,ceiling==='gross'?/ORGANIZATION_TASK_(?:DAILY|MONTHLY|LIFETIME)_EXPOSURE/:ceiling==='fee'?/ORGANIZATION_TASK_FEE_EXPOSURE/:/TEAM_(?:DAILY|MONTHLY)_LIMIT/)
  const uses=await db.select().from(schema.organization_task_uses).where(eq(schema.organization_task_uses.task_id,results[0].status===201?first.task:second.task));assert.equal(uses.length,1)
  const exposure=await domain.organizationTaskExposure(db,first.org,first.buyer,domain.organizationTaskInput.parse(first.body).payment)
  assert.equal(exposure.lifetime,105);assert.equal(tempo?exposure.fees:exposure.gas,BigInt(tempo?'5000':'100000000000000'))
})

for(const tempo of [false,true])test(`generic ${tempo?'Tempo':'L1'} funding versus pending review proposal cannot commit both obligations`,async()=>{
  for(let repetition=0;repetition<3;repetition++){
    const f=await fixture(tempo);await db.update(schema.buyer_spend_policies).set({policy_json:'{"max_per_execution":500}'}).where(eq(schema.buyer_spend_policies.buyer_id,f.buyer))
    const results=await race([{operation:'propose',org:f.org,actor:f.owner,body:f.body},{operation:'generic',org:f.org,actor:f.buyer,task:f.task,body:{payment_rail:tempo?'mpp':'evm',expected_total:1.05,client_reference:crypto.randomUUID()}}])
    assert.equal(results.filter(r=>r.status===201).length,1,JSON.stringify(results));assert.ok(results.every(r=>[201,409].includes(r.status)),JSON.stringify(results))
    const grants=await db.select().from(schema.organization_task_authorizations).where(eq(schema.organization_task_authorizations.organization_id,f.org)),[workspace]=await db.select().from(schema.task_workspaces).where(eq(schema.task_workspaces.task_id,f.task))
    assert.equal(Number(grants.length>0)+Number(workspace.trade_id!==null),1,'A pending review and generic task trade must never coexist')
    if(grants.length){assert.equal(grants[0].state,'pending');assert.equal(workspace.trade_id,null)}else assert.ok(workspace.trade_id)
  }
})

for(const tempo of [false,true])test(`original ${tempo?'Tempo':'L1'} task proposal, decision and checkout survive real before/after commit SIGKILL`,async()=>{
  for(const operation of ['propose','approve','checkout']as const)for(const boundary of ['before','after']as const){
    const f=await fixture(tempo);let a:Authorization|null=null
    if(operation!=='propose')a=(await propose(f)).authorization
    if(operation==='checkout')await approve(f,a!)
    const savedDecision=a?decision(f,a):null,body=operation==='propose'?f.body:operation==='approve'?savedDecision:checkoutBody(a!),marker=join(directory,`${f.org}-${operation}-${boundary}.marker`)
    const code=`(async()=>{
      const a=JSON.parse(process.argv[1]),fs=await import('node:fs/promises'),{db}=await import('./lib/db.ts'),s=await import('./lib/schema.ts'),{eq}=await import('drizzle-orm');
      const stop=async()=>{await fs.writeFile(process.argv[2],'reached');await new Promise(()=>{setInterval(()=>{},1000)})};
      if(a.boundary==='before'){const proto=Object.getPrototypeOf(db.session),transaction=proto.transaction;proto.transaction=function(fn,config){return transaction.call(this,async tx=>{const result=await fn(tx);
        const [grant]=await tx.select().from(s.organization_task_authorizations).where(eq(s.organization_task_authorizations.organization_id,a.f.org));
        const ready=a.operation==='propose'?!!grant:a.operation==='approve'?grant?.state==='approved':(await tx.select().from(s.organization_task_uses).where(eq(s.organization_task_uses.authorization_id,a.id))).length===1;
        if(ready)await stop();return result},config)}}
      const d=await import('./lib/organization-task-authorizations.ts');
      if(a.operation==='propose')await d.proposeOrganizationTask(a.f.org,a.f.owner,d.organizationTaskInput.parse(a.body));
      else if(a.operation==='approve')await d.approveOrganizationTask(a.f.org,a.id,a.f.reviewer,d.organizationTaskDecision.parse(a.body));
      else await d.checkoutOrganizationTask(a.f.org,a.id,a.f.buyer,d.organizationTaskCheckoutInput.parse(a.body));
      await stop()
    })().catch(error=>{console.error(error);process.exitCode=1})`
    const child=spawn(process.execPath,['--conditions=react-server','--import','tsx','-e',code,JSON.stringify({operation,boundary,f,id:a?.id,body}),marker],{cwd:process.cwd(),env:childEnv(),stdio:['ignore','ignore','pipe']})
    let errors='';child.stderr.on('data',chunk=>{errors+=chunk});const exited=new Promise<void>((done,reject)=>{child.once('exit',()=>done());child.once('error',reject)})
    try{
      let reached=false
      for(let attempt=0;attempt<150;attempt++){try{await readFile(marker);reached=true;break}catch{}if(child.exitCode!==null)throw Error(errors);await new Promise(done=>setTimeout(done,100))}
      assert.equal(reached,true,errors);child.kill('SIGKILL');await exited
      assert.equal(child.signalCode,'SIGKILL')
      const grants=await db.select().from(schema.organization_task_authorizations).where(eq(schema.organization_task_authorizations.organization_id,f.org))
      if(operation==='propose')assert.equal(grants.length,boundary==='before'?0:1)
      if(operation==='approve')assert.equal(grants[0].state,boundary==='before'?'pending':'approved')
      const [workspace]=await db.select().from(schema.task_workspaces).where(eq(schema.task_workspaces.task_id,f.task))
      if(operation==='checkout'){
        assert.equal((await db.select().from(schema.organization_task_uses).where(eq(schema.organization_task_uses.authorization_id,a!.id))).length,boundary==='before'?0:1)
        assert.equal(Number(workspace.trade_id!==null),boundary==='before'?0:1)
        assert.equal((await db.select().from(schema.trades).where(eq(schema.trades.buyer_id,f.buyer))).length,boundary==='before'?0:1)
        assert.equal((await db.select().from(schema.organization_trade_attributions).where(eq(schema.organization_trade_attributions.organization_id,f.org))).length,boundary==='before'?0:1)
      }
      const recovered=await propose(f);a=recovered.authorization;if(grants.length)assert.equal(a.id,grants[0].id)
      const originalDecision=operation==='approve'?savedDecision!:grants[0]?.decision_reference?{version:a.version,client_reference:grants[0].decision_reference,authority_hash:a.authority_hash,approve:true as const}:decision(f,a)
      await domain.approveOrganizationTask(f.org,a.id,f.reviewer,originalDecision)
      const originalCheckout=operation==='checkout'?body as ReturnType<typeof checkoutBody>:checkoutBody(a)
      const reservation=await domain.checkoutOrganizationTask(f.org,a.id,f.buyer,originalCheckout),again=await domain.checkoutOrganizationTask(f.org,a.id,f.buyer,originalCheckout)
      assert.equal(again.created,false);assert.equal(again.trade?.id,reservation.trade?.id)
      assert.equal((await db.select().from(schema.organization_task_uses).where(eq(schema.organization_task_uses.authorization_id,a.id))).length,1)
      assert.equal((await db.select().from(schema.trades).where(eq(schema.trades.buyer_id,f.buyer))).length,1)
    }finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await exited}
  }
})
