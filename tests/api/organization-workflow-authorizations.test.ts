import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { and, eq } from 'drizzle-orm'
import { privateKeyToAccount } from 'viem/accounts'
import { NextRequest } from 'next/server'
import { createLocalTestSchema } from '../helpers/local-schema'
let directory:string,db:typeof import('@/lib/db').db,schema:typeof import('@/lib/schema'),jwt:typeof import('@/lib/auth').generateJWT
let domain:typeof import('@/lib/organization-workflow-authorizations'),budget:typeof import('@/lib/workflow-execution-budget')
const treasury=privateKeyToAccount(`0x${'99'.repeat(32)}`).address.toLowerCase(),token=`0x${'44'.repeat(20)}`,payer=`0x${'11'.repeat(20)}`,fee='100000000000000'
const policy={required:true,methods:['buyer_review','schema'],acceptance:{version:1,mode:'explicit_buyer'}}
before(async()=>{
 directory=await mkdtemp(join(tmpdir(),'clawdmarket-workspace-test-reviewed-workflow-'))
 Object.assign(process.env,{TURSO_DATABASE_URL:`file:${join(directory,'workflow.db')}`,TURSO_AUTH_TOKEN:'',JWT_SECRET:'reviewed-workflow-fixture-only',TREASURY_ADDRESS:treasury,
  EVM_SETTLEMENT_PRIVATE_KEY:`0x${'99'.repeat(32)}`,CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED:'true',CLAWDMARKET_WORKFLOW_PLANNING_ENABLED:'true',CLAWDMARKET_WORKFLOW_EXECUTION_ENABLED:'true',
  CLAWDMARKET_REUSABLE_SERVICES_ENABLED:'true',CLAWDMARKET_ROUTE_PLANNING_ENABLED:'true',CLAWDMARKET_ROUTE_EXECUTION_ENABLED:'true',
  EVM_ACCEPTED_TOKENS:JSON.stringify([{chainId:1,chainName:'Disposable reviewed L1',address:token,symbol:'TEST',decimals:6,fixedUsdPrice:1,confirmations:1,rpcUrl:'https://rpc.example.invalid'}])})
 delete process.env.VERCEL;delete process.env.VERCEL_ENV;delete process.env.MPP_SECRET_KEY;delete process.env.MPP_SECRET_KEY_CURRENT
 db=(await import('@/lib/db')).db;schema=await import('@/lib/schema');await createLocalTestSchema(db.$client,schema)
 jwt=(await import('@/lib/auth')).generateJWT;domain=await import('@/lib/organization-workflow-authorizations');budget=await import('@/lib/workflow-execution-budget')
})
after(async()=>{db?.$client.close();if(directory)await rm(directory,{recursive:true,force:true})})
function request(path:string,actor:string,body:unknown){return new NextRequest(`http://localhost${path}`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${jwt({userId:actor,email:`${actor}@test.invalid`,role:'human'})}`},body:JSON.stringify(body)})}
async function fixture(privateMode=false,concurrency=2){
 const id=crypto.randomUUID(),agent=crypto.randomUUID(),owner=`owner-${id}`,reviewer=`reviewer-${id}`,other=`other-${id}`,buyer=`user_agent_${agent}`,team=crypto.randomUUID(),now=new Date()
 const sellers=[`seller-a-${id}`,`seller-b-${id}`],services=sellers.map(()=>crypto.randomUUID())
 await db.insert(schema.users).values([owner,reviewer,other,buyer,...sellers].map(id=>({id,name:id,email:`${id}@test.invalid`,password_hash:'unused'})))
 await db.insert(schema.agents).values({id:agent,name:'Workflow buyer',description:'Reviewed workflow buyer fixture',capabilities:'["code-review"]',endpoint:'https://example.invalid',owner_address:'',api_key:'unused'})
 await db.insert(schema.agent_owners).values({agentId:agent,userId:owner,establishedBy:'test'})
 await db.insert(schema.organizations).values({id,owner_account_id:owner,client_reference:id,name:'Workflow organization',created_at:now,updated_at:now})
 await db.insert(schema.organization_teams).values({id:team,organization_id:id,slug:'review',name:'Review',created_at:now,updated_at:now})
 await db.insert(schema.organization_agent_assignments).values({agent_id:agent,organization_id:id,team_id:team,cost_center:'REVIEW',assigned_at:now,updated_at:now})
 const membership=await import('@/lib/organization-membership'),purchasing=await import('@/lib/organization-purchasing')
 for(const actor of [reviewer,other]){const invitation=await membership.createOrganizationInvitation(id,owner,actor,crypto.randomUUID());assert.equal(invitation.kind,'ok');assert.equal((await membership.acceptOrganizationInvitation(invitation.invitation_id!,actor)).kind,'ok')}
 const role=await purchasing.grantPurchasingRole(id,owner,purchasing.purchasingRoleInput.parse({version:1,client_reference:crypto.randomUUID(),account_id:reviewer,team_id:team,role:'approver',max_purchase:'10.00',expires_at:new Date(Date.now()+3600_000).toISOString()}))
 for(const [i,seller]of sellers.entries()){
  await db.insert(schema.payout_addresses).values({user_id:seller,address:treasury})
  await db.insert(schema.service_definitions).values({id:services[i],seller_id:seller,title:'Workflow provider',description:'Return bounded structured findings.',capabilities:'["code-review"]',price_minor:100,status:'active',provider_protocol:'leased_v1',estimated_latency_seconds:30,max_concurrency:concurrency,
   output_schema:'{"type":"object","required":["result"],"properties":{"result":{"type":"string"}}}',verification_policy:JSON.stringify(policy)})
 }
 await db.insert(schema.buyer_spend_policies).values({buyer_id:buyer,owner_account_id:owner,policy_json:'{"approval_required_above":50,"max_per_execution":500}',version:1,created_at:now,updated_at:now})
 const plan=(await import('@/app/api/workflows/plan/route')).POST
 const result=await plan(request('/api/workflows/plan',buyer,{client_reference:crypto.randomUUID(),objective:'Review two independently approved objectives',max_budget:{amount:'2.10',currency:'USD'},deadline_seconds:600,
  nodes:['source','review'].map(key=>({key,objective:`Review private ${key} objective`,required_capabilities:['code-review'],budget:{amount:'1.05',currency:'USD'},deadline_seconds:key==='source'?300:600,depends_on:key==='review'?['source']:[]}))}))
 assert.equal(result.status,201,JSON.stringify(await result.clone().json()));const workflow=(await result.json()).workflow
 const privateNodes:{key:string;provider_share_ids:string[]}[]=[]
 if(privateMode){const sharing=await import('@/lib/organization-private-providers')
  for(const [i,key]of ['source','review'].entries()){
   const providerAgent=crypto.randomUUID(),providerOwner=`private-owner-${i}-${id}`,seller=`user_agent_${providerAgent}`
   await db.insert(schema.users).values([providerOwner,seller].map(id=>({id,name:id,email:`${id}@test.invalid`,password_hash:'unused'})))
   await db.insert(schema.agents).values({id:providerAgent,name:'Private provider',description:'Private workflow provider',visibility:'private',capabilities:'["code-review"]',endpoint:'https://example.invalid',owner_address:'',api_key:'unused'})
   await db.insert(schema.agent_owners).values({agentId:providerAgent,userId:providerOwner,establishedBy:'test'});await db.insert(schema.payout_addresses).values({user_id:seller,address:treasury})
   await db.update(schema.service_definitions).set({seller_id:seller,visibility:'organization'}).where(eq(schema.service_definitions.id,services[i]));sellers[i]=seller
   const offered=await sharing.offerPrivateProvider(services[i],providerOwner,sharing.providerOfferInput.parse({version:1,client_reference:crypto.randomUUID(),organization_id:id,team_id:team,expires_at:new Date(Date.now()+3600_000).toISOString()}))
   await sharing.acceptPrivateProvider(id,offered.share.id,owner,sharing.providerAcceptInput.parse({version:1,client_reference:crypto.randomUUID(),request_hash:offered.share.request_hash}));privateNodes.push({key,provider_share_ids:[offered.share.id]})
  }
 }
 const body={version:1,client_reference:crypto.randomUUID(),workflow_id:workflow.id,reviewer_role_id:role.role.id,max_daily:'3.00',max_monthly:'3.00',max_lifetime:'3.00',max_lifetime_chain_fee_units:(BigInt(fee)*3n).toString(),private_nodes:privateNodes,
  approval:{version:1,client_reference:crypto.randomUUID(),plan_hash:workflow.plan_hash,expires_at:new Date(Math.floor(Date.now()/1000)*1000+900_000).toISOString(),max_gross_minor:210,max_chain_fee_units:(BigInt(fee)*2n).toString(),private_data:'selected_provider_only',
   payment:{rail:'evm',chain_id:1,token_address:token,payer_address:payer,treasury_address:treasury,minimum_token_reserve_units:'1000000',minimum_native_reserve_wei:'1000000000000',max_gas_cost_wei:fee},
   nodes:['source','review'].map((key,i)=>({key,static_input:{secret:`private-${key}`},provider_requirements:{approved_providers:[sellers[i]]},verification:policy,max_per_attempt_minor:105,max_retry_minor:0,max_attempts:1,max_latency_seconds:60,max_chain_fee_per_attempt_units:fee,dependency_inputs:key==='review'?[{source_node:'source',artifact_index:0,target_field:'upstream'}]:[]}))}}
 return {id,agent,owner,reviewer,other,buyer,team,sellers,services,workflow,body,privateNodes}
}
type Fixture=Awaited<ReturnType<typeof fixture>>
const rejects=(action:()=>Promise<unknown>,code:string)=>assert.rejects(action,(e:unknown)=>(e as {code?:string}).code===code)
async function propose(f:Fixture){return (await domain.proposeOrganizationWorkflow(f.id,f.owner,domain.organizationWorkflowInput.parse(f.body))).authorization}
async function approve(f:Fixture,a:Awaited<ReturnType<typeof propose>>){return domain.approveOrganizationWorkflow(f.id,a.id,f.reviewer,{version:a.version,client_reference:crypto.randomUUID(),authority_hash:a.authority_hash,approve:true})}
async function activate(f:Fixture,a:Awaited<ReturnType<typeof propose>>){return budget.activateWorkflow(f.workflow.id,f.owner,{version:1,client_reference:`execute-${f.workflow.id}`,approval_id:a.approval_id,contract_hash:a.contract.terms? a.terms.contract_hash:'',authorize_spending:true})}
async function checkout(f:Fixture,a:Awaited<ReturnType<typeof propose>>){const active=await activate(f,a),prepared=await budget.prepareWorkflowNode(active.run.id,'source',f.buyer),execute=(await import('@/app/api/routes/[id]/execute/route')).POST
 const response=await execute(request(`/api/routes/${prepared.node.route_id}/execute`,f.buyer,{mandate_id:prepared.node.mandate_id}),{params:Promise.resolve({id:prepared.node.route_id!})});return {active,prepared,response,data:await response.json()}}
for(const privateMode of [false,true])test(`independent ${privateMode?'private':'public'} workflow review freezes exact graph and original contracts; pending grants cannot execute`,async()=>{
 const f=await fixture(privateMode),a=await propose(f)
 await rejects(()=>activate(f,a),'ORGANIZATION_WORKFLOW_APPROVAL_REQUIRED')
 await rejects(()=>domain.inspectOrganizationWorkflow(f.id,a.id,f.buyer),'ORGANIZATION_WORKFLOW_NOT_FOUND')
 await rejects(()=>domain.inspectOrganizationWorkflow(f.id,a.id,f.other),'ORGANIZATION_WORKFLOW_NOT_FOUND')
 assert.equal((await domain.findOrganizationWorkflow(f.id,f.body.client_reference,f.owner)).id,a.id)
 await rejects(()=>domain.approveOrganizationWorkflow(f.id,a.id,f.owner,{version:1,client_reference:crypto.randomUUID(),authority_hash:a.authority_hash,approve:true}),'ORGANIZATION_WORKFLOW_REVIEWER_REQUIRED')
 await approve(f,a);const selected=await checkout(f,a);assert.equal(selected.response.status,201,JSON.stringify(selected.data))
 const reservations=await db.select().from(schema.workflow_reservations).where(eq(schema.workflow_reservations.run_id,selected.active.run.id));assert.equal(reservations.length,1);assert.equal(reservations[0].amount_minor,105)
 const [order]=await db.select().from(schema.service_orders).where(eq(schema.service_orders.id,reservations[0].order_id));assert.equal(order.private_provider_share_id,privateMode?f.privateNodes[0].provider_share_ids[0]:null)
 assert.equal((await checkout(f,a)).data.trade.id,selected.data.trade.id)
 await rejects(()=>budget.prepareWorkflowNode(selected.active.run.id,'review',f.buyer),'WORKFLOW_DEPENDENCY_NOT_SETTLED')
 await domain.revokeOrganizationWorkflow(f.id,a.id,f.owner);assert.equal((await activate(f,a)).run.id,selected.active.run.id)
 const denied=(await import('@/app/api/routes/[id]/execute/route')).POST
 const replay=await denied(request('/api/routes/original/execute',f.buyer,{mandate_id:selected.prepared.node.mandate_id}),{params:Promise.resolve({id:selected.prepared.node.route_id!})});assert.equal(replay.status,200,'original checkout recovers without fresh spend')
})
test('workflow review rejects changed graph, consent, owner, reviewer and department before fresh economic exposure',async()=>{
 for(const mutation of ['graph','consent','owner','reviewer','department','service']){const f=await fixture(true),a=await propose(f);await approve(f,a);const active=await activate(f,a)
  if(mutation==='graph')await db.update(schema.workflow_nodes).set({objective:'Changed objective under original approval'}).where(and(eq(schema.workflow_nodes.workflow_id,f.workflow.id),eq(schema.workflow_nodes.node_key,'source')))
  if(mutation==='consent')await db.update(schema.organization_provider_shares).set({state:'revoked'}).where(eq(schema.organization_provider_shares.id,f.privateNodes[0].provider_share_ids[0]))
  if(mutation==='owner')await db.update(schema.organizations).set({owner_account_id:f.other}).where(eq(schema.organizations.id,f.id))
  if(mutation==='reviewer')await db.update(schema.organization_purchasing_roles).set({state:'revoked'}).where(eq(schema.organization_purchasing_roles.id,f.body.reviewer_role_id))
  if(mutation==='department')await db.update(schema.organization_teams).set({status:'archived'}).where(eq(schema.organization_teams.id,f.team))
  if(mutation==='service')await db.update(schema.service_definitions).set({price_minor:101}).where(eq(schema.service_definitions.id,f.services[0]))
  await assert.rejects(()=>budget.prepareWorkflowNode(active.run.id,'source',f.buyer),()=>true,mutation)
  assert.equal((await db.select().from(schema.workflow_reservations).where(eq(schema.workflow_reservations.run_id,active.run.id))).length,0)
 }
})

test('standalone reviewed routes and independently reviewed workflow children race under one original gross and fee history',async()=>{
 const marker=process.env.CLAWDMARKET_TEST_WORKFLOW_EXPOSURE_RACE
 if(!marker){const {execFile}=await import('node:child_process'),{promisify}=await import('node:util')
  for(const ceiling of ['gross','fee','department','capacity']){const env:NodeJS.ProcessEnv={...process.env,CLAWDMARKET_TEST_WORKFLOW_EXPOSURE_RACE:ceiling};delete env.NODE_TEST_CONTEXT
   const child=await promisify(execFile)(process.execPath,['--conditions=react-server','--import','tsx','--test','--test-reporter=spec','--test-name-pattern=^standalone reviewed routes','tests/api/organization-workflow-authorizations.test.ts'],{cwd:process.cwd(),env,timeout:30000});assert.match(child.stdout,/ℹ pass 1/);assert.match(child.stdout,/ℹ fail 0/)
  }return
 }
 for(const ceiling of [marker]){
 const f=await fixture(false,ceiling==='capacity'?2:10)
 if(ceiling==='department'){const now=new Date();await db.insert(schema.organization_team_budgets).values({team_id:f.team,organization_id:f.id,max_daily_minor:210,max_monthly_minor:210,version:1,created_at:now,updated_at:now})}
 const grossLimit=ceiling==='gross'?'2.10':'3.15',feeLimit=(BigInt(fee)*(ceiling==='fee'?2n:3n)).toString()
 const first=await propose(f);await approve(f,first);const root=await checkout(f,first);assert.equal(root.response.status,201)
 // Allow exactly one more purchase across either authority model.
 const copy=crypto.randomUUID(),[saved]=await db.select().from(schema.workflows).where(eq(schema.workflows.id,f.workflow.id))
 await db.insert(schema.workflows).values({...saved,id:copy,client_reference:crypto.randomUUID()})
 const rows=await db.select().from(schema.workflow_nodes).where(eq(schema.workflow_nodes.workflow_id,f.workflow.id))
 await db.insert(schema.workflow_nodes).values(rows.map(node=>({...node,id:crypto.randomUUID(),workflow_id:copy,route_id:null})))
 const snapshot=(await import('@/lib/workflow-planning')).workflowPlanHash
 const [copied]=await db.select().from(schema.workflows).where(eq(schema.workflows.id,copy)),copiedNodes=await db.select().from(schema.workflow_nodes).where(eq(schema.workflow_nodes.workflow_id,copy))
 const secondF={...f,workflow:{...f.workflow,id:copy},body:{...f.body,workflow_id:copy,client_reference:crypto.randomUUID(),max_daily:grossLimit,max_monthly:grossLimit,max_lifetime:grossLimit,max_lifetime_chain_fee_units:feeLimit,approval:{...f.body.approval,client_reference:crypto.randomUUID(),plan_hash:snapshot(copied,copiedNodes)}}}
 const second=await propose(secondF);await approve(secondF,second)
 const routeDomain=await import('@/lib/organization-route-authorizations')
 const input=routeDomain.organizationRouteInput.parse({version:1,client_reference:crypto.randomUUID(),agent_id:f.agent,reviewer_role_id:f.body.reviewer_role_id,
  route_request:{client_reference:crypto.randomUUID(),objective:'Review a separately approved standalone objective',required_capabilities:['code-review'],input:{secret:'standalone-original'},max_budget:{amount:'1.05',currency:'USD'},verification:policy,provider_requirements:{approved_providers:[f.sellers[0]]},payment_policy:{allowed_rails:['evm']}},
  max_daily:grossLimit,max_monthly:grossLimit,max_lifetime:grossLimit,max_lifetime_gas_cost_wei:feeLimit,mandate:{version:1,client_reference:crypto.randomUUID(),max_aggregate:'1.05',max_per_execution:'1.05',max_retry_budget:'0.00',max_attempts:1,approved_providers:[f.sellers[0]],max_latency_seconds:60,private_data:'selected_provider_only',expires_at:new Date(Date.now()+600000).toISOString(),payment:f.body.approval.payment}})
 const standalone=(await routeDomain.proposeOrganizationRoute(f.id,f.owner,input)).authorization
 await routeDomain.approveOrganizationRoute(f.id,standalone.id,f.reviewer,{version:1,client_reference:crypto.randomUUID(),authority_hash:standalone.authority_hash,approve:true})
 const {execFile}=await import('node:child_process'),{promisify}=await import('node:util')
 const code=`(async()=>{const a=JSON.parse(process.argv[1]),{db}=await import('./lib/db.ts'),{NextRequest}=await import('next/server'),{generateJWT}=await import('./lib/auth.ts'),{POST}=await import('./app/api/routes/[id]/execute/route.ts');let route=a.routeId,mandate=a.mandateId;
   try{if(a.workflow){const b=await import('./lib/workflow-execution-budget.ts'),active=await b.activateWorkflow(a.f.workflow.id,a.f.owner,{version:1,client_reference:'execute-'+a.f.workflow.id,approval_id:a.grant.approval_id,contract_hash:a.grant.terms.contract_hash,authorize_spending:true}),prepared=await b.prepareWorkflowNode(active.run.id,'source',a.f.buyer);route=prepared.node.route_id;mandate=prepared.node.mandate_id}
   const token=generateJWT({userId:a.f.buyer,email:a.f.buyer+'@test.invalid',role:'human'}),response=await POST(new NextRequest('http://localhost/api/routes/'+route+'/execute',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({mandate_id:mandate})}),{params:Promise.resolve({id:route})});console.log(JSON.stringify({status:response.status,body:await response.json()}))}
   catch(e){console.log(JSON.stringify({status:e.status||409,body:{error_code:e.code||'unknown'}}))}finally{db.$client.close()}})()`
 const worker=async(workflow:boolean)=>{const env:NodeJS.ProcessEnv={...process.env};delete env.NODE_TEST_CONTEXT
  const out=await promisify(execFile)(process.execPath,['--conditions=react-server','--import','tsx','-e',code,JSON.stringify({workflow,f:secondF,grant:second,routeId:standalone.route_id,mandateId:standalone.mandate.id})],{cwd:process.cwd(),env,timeout:20000})
  const result=JSON.parse(out.stdout.trim().split('\n').at(-1)!) as {status:number;body:{error_code?:string};diagnostics?:string}
  if(result.status>=500)result.diagnostics=out.stderr.trim()
  return result
 }
 const results=await Promise.all([worker(true),worker(false)])
 assert.equal(results.filter(r=>r.status===201).length,1,ceiling+JSON.stringify(results))
 if(ceiling!=='capacity'){
  const retried=await worker(results[0].status!==201);assert.equal(retried.status,409,ceiling+JSON.stringify(retried))
  if(ceiling==='gross')assert.match(retried.body.error_code!,/ORGANIZATION_(?:WORKFLOW|ROUTE)_GROSS_LIMIT/)
  if(ceiling==='fee')assert.match(retried.body.error_code!,/ORGANIZATION_(?:WORKFLOW_FEE|ROUTE_GAS)_LIMIT/)
  if(ceiling==='department')assert.match(retried.body.error_code!,/TEAM_(?:DAILY|MONTHLY)_LIMIT/)
 }
 const ledger=await domain.organizationWorkflowExposure(db,f.id,f.buyer,f.body.approval.payment as Parameters<typeof domain.organizationWorkflowExposure>[3])
 const direct=await routeDomain.readOriginalOrganizationRouteExposure(db,f.id,f.buyer,f.body.approval.payment as Parameters<typeof routeDomain.readOriginalOrganizationRouteExposure>[3])
 assert.equal(ledger.lifetime+direct.lifetime,210);assert.equal(ledger.gas+direct.gas,BigInt(fee)*2n)
 assert.equal((await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id,f.services[0])))[0].active_orders,2)
 }
})

test('lost workflow proposal and decision recover exact original references without reopening revocation or admitting another graph',async()=>{
 const f=await fixture(true),a=await propose(f),replay=await propose(f);assert.equal(replay.id,a.id)
 const decision={version:1 as const,client_reference:crypto.randomUUID(),authority_hash:a.authority_hash,approve:true as const}
 await domain.approveOrganizationWorkflow(f.id,a.id,f.reviewer,decision);await domain.revokeOrganizationWorkflow(f.id,a.id,f.owner)
 assert.equal((await domain.approveOrganizationWorkflow(f.id,a.id,f.reviewer,decision)).authorization.state,'revoked')
 await rejects(()=>domain.approveOrganizationWorkflow(f.id,a.id,f.reviewer,{...decision,client_reference:crypto.randomUUID()}),'ORGANIZATION_WORKFLOW_DECISION_CONFLICT')
 await rejects(()=>domain.proposeOrganizationWorkflow(f.id,f.owner,domain.organizationWorkflowInput.parse({...f.body,max_lifetime:'3.01'})),'ORGANIZATION_WORKFLOW_IDEMPOTENCY_CONFLICT')
 await rejects(()=>activate(f,a),'ORGANIZATION_WORKFLOW_APPROVAL_REQUIRED')
 assert.equal((await db.select().from(schema.workflow_runs).where(eq(schema.workflow_runs.workflow_id,f.workflow.id))).length,0)
})

test('private workflow proposal, decision, activation, child preparation and reservation survive real before/after-commit SIGKILL',async()=>{
 const {spawn}=await import('node:child_process'),{readFile}=await import('node:fs/promises')
 for(const operation of ['propose','approve','activate','prepare','reserve']as const)for(const boundary of ['before','after']as const){
  const f=await fixture(true);let a:Awaited<ReturnType<typeof propose>>|null=null,runId:string|null=null,routeId:string|null=null,mandateId:string|null=null
  if(operation!=='propose')a=await propose(f)
  if(['activate','prepare','reserve'].includes(operation))await approve(f,a!)
  if(['prepare','reserve'].includes(operation))runId=(await activate(f,a!)).run.id
  if(operation==='reserve'){const prepared=await budget.prepareWorkflowNode(runId!,'source',f.buyer);routeId=prepared.node.route_id;mandateId=prepared.node.mandate_id}
  const decision={version:1,client_reference:crypto.randomUUID(),authority_hash:a?.authority_hash,approve:true},args={operation,boundary,f,a,runId,routeId,mandateId,decision},marker=join(directory,`${f.id}-${operation}-${boundary}.marker`)
  const code=`(async()=>{const a=JSON.parse(process.argv[1]),{writeFile}=await import('node:fs/promises');const stop=async()=>{await writeFile(process.argv[2],'ready');await new Promise(()=>{})};
    const {db}=await import('./lib/db.ts'),s=await import('./lib/schema.ts'),{eq,and}=await import('drizzle-orm');
    if(a.boundary==='before'){const proto=Object.getPrototypeOf(db.session),original=proto.transaction;proto.transaction=function(fn,c){return original.call(this,async tx=>{const r=await fn(tx);let committed=false;
      if(a.operation==='propose'||a.operation==='approve'){const [g]=await tx.select().from(s.organization_workflow_authorizations).where(eq(s.organization_workflow_authorizations.organization_id,a.f.id));committed=!!g&&(a.operation==='propose'||g.state==='approved')}
      if(a.operation==='activate')committed=(await tx.select().from(s.workflow_runs).where(eq(s.workflow_runs.workflow_id,a.f.workflow.id))).length>0;
      if(a.operation==='prepare')committed=(await tx.select().from(s.workflow_node_runs).where(and(eq(s.workflow_node_runs.run_id,a.runId),eq(s.workflow_node_runs.node_key,'source'))))[0]?.route_id!=null;
      if(a.operation==='reserve')committed=(await tx.select().from(s.workflow_reservations).where(eq(s.workflow_reservations.run_id,a.runId))).length>0;
      if(committed)await stop();return r},c)}}
    const d=await import('./lib/organization-workflow-authorizations.ts'),b=await import('./lib/workflow-execution-budget.ts');
    if(a.operation==='propose')await d.proposeOrganizationWorkflow(a.f.id,a.f.owner,d.organizationWorkflowInput.parse(a.f.body));
    else if(a.operation==='approve')await d.approveOrganizationWorkflow(a.f.id,a.a.id,a.f.reviewer,d.organizationWorkflowDecision.parse(a.decision));
    else if(a.operation==='activate')await b.activateWorkflow(a.f.workflow.id,a.f.owner,{version:1,client_reference:'execute-'+a.f.workflow.id,approval_id:a.a.approval_id,contract_hash:a.a.terms.contract_hash,authorize_spending:true});
    else if(a.operation==='prepare')await b.prepareWorkflowNode(a.runId,'source',a.f.buyer);
    else{const {POST}=await import('./app/api/routes/[id]/execute/route.ts'),{NextRequest}=await import('next/server'),{generateJWT}=await import('./lib/auth.ts');const token=generateJWT({userId:a.f.buyer,email:a.f.buyer+'@test.invalid',role:'human'});
      const response=await POST(new NextRequest('http://localhost/api/routes/'+a.routeId+'/execute',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({mandate_id:a.mandateId})}),{params:Promise.resolve({id:a.routeId})});if(!response.ok)throw Error(await response.text())}
    await stop()})().catch(e=>{console.error(e);process.exitCode=1})`
  const child=spawn(process.execPath,['--conditions=react-server','--import','tsx','-e',code,JSON.stringify(args),marker],{cwd:process.cwd(),env:process.env,stdio:['ignore','ignore','pipe']})
  let errors='';child.stderr.on('data',chunk=>{errors+=chunk});const exited=new Promise<void>(done=>child.once('exit',()=>done()))
  try{
   let reached=false;for(let i=0;i<150;i++){try{await readFile(marker);reached=true;break}catch{}if(child.exitCode!==null)throw Error(errors);await new Promise(done=>setTimeout(done,100))}
   assert.equal(reached,true,errors);child.kill('SIGKILL');await exited
   const stored=await db.select().from(schema.organization_workflow_authorizations).where(eq(schema.organization_workflow_authorizations.organization_id,f.id))
   if(operation==='propose'){assert.equal(stored.length,boundary==='before'?0:1);assert.equal((await db.select().from(schema.workflow_approvals).where(eq(schema.workflow_approvals.workflow_id,f.workflow.id))).length,boundary==='before'?0:1);a=await propose(f)}
   if(operation==='approve')assert.equal(stored[0].state,boundary==='before'?'pending':'approved')
   if(operation==='reserve')assert.equal((await db.select().from(schema.workflow_reservations).where(eq(schema.workflow_reservations.run_id,runId!))).length,boundary==='before'?0:1)
   if(operation==='propose'||operation==='approve')await domain.approveOrganizationWorkflow(f.id,a!.id,f.reviewer,domain.organizationWorkflowDecision.parse(operation==='approve'?decision:{version:1,client_reference:crypto.randomUUID(),authority_hash:a!.authority_hash,approve:true}))
   const recovered=await checkout(f,a!);assert.ok([200,201].includes(recovered.response.status),JSON.stringify(recovered.data))
   assert.equal((await db.select().from(schema.workflow_reservations).where(eq(schema.workflow_reservations.run_id,recovered.active.run.id))).length,1)
  }finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await exited}
 }
})

test('named read credentials cannot inspect private workflow approval, prepare child terms or inspect its mandate',async()=>{
 const f=await fixture(true),a=await propose(f);await approve(f,a);const active=await activate(f,a),prepared=await budget.prepareWorkflowNode(active.run.id,'source',f.buyer)
 const named=await(await import('@/lib/agent-named-credentials')).createNamedAgentCredential({agentId:f.agent,name:'Private workflow read',scopes:['agent:read'],actorCredentialId:null})
 assert.equal(named.kind,'created');if(named.kind!=='created')throw Error('Credential fixture failed')
 const headers={Authorization:`Bearer ${named.api_key}`,'Content-Type':'application/json'}
 const underlying=await(await import('@/app/api/workflows/[id]/approval/route')).GET(new NextRequest(`http://localhost/api/workflows/${f.workflow.id}/approval`,{headers}),{params:Promise.resolve({id:f.workflow.id})})
 assert.equal(underlying.status,404);assert.doesNotMatch(await underlying.text(),new RegExp(f.sellers[0]))
 const child=await(await import('@/app/api/workflows/[id]/nodes/[key]/prepare/route')).POST(new NextRequest(`http://localhost/api/workflows/${f.workflow.id}/nodes/source/prepare`,{method:'POST',headers,body:JSON.stringify({version:1,run_id:active.run.id})}),{params:Promise.resolve({id:f.workflow.id,key:'source'})})
 assert.ok([401,404].includes(child.status))
 const mandate=await(await import('@/app/api/routes/[id]/mandate/route')).GET(new NextRequest(`http://localhost/api/routes/${prepared.node.route_id}/mandate`,{headers}),{params:Promise.resolve({id:prepared.node.route_id!})})
 assert.equal(mandate.status,404)
 const [route]=await db.select().from(schema.route_plans).where(eq(schema.route_plans.id,prepared.node.route_id!))
 const redacted=(await import('@/lib/route-planning')).routePlanDto(route);assert.deepEqual(redacted.input,{});assert.deepEqual(redacted.candidates,[])
})
