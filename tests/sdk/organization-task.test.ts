import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { ClawdMarketClient, ClawdMarketTransportError, SDK_CONTRACT, type OrganizationTaskProposal } from '../../sdk/typescript/src/index'

const org='00000000-0000-4000-8000-000000000001',id='00000000-0000-4000-8000-000000000002',trade='00000000-0000-4000-8000-000000000003'

for(const tempo of [false,true])test(`task SDK recovers genuinely lost ${tempo?'Tempo':'L1'} proposal, decision and checkout HTTP replies using original references`,async t=>{
  const proposal:OrganizationTaskProposal={version:tempo?2:1,client_reference:'saved-original-task-proposal',task_id:'legacy-task-id',winning_bid_id:'original-bid',reviewer_role_id:id,
    expected_total:'1.05',max_daily:'1.05',max_monthly:'1.05',max_lifetime:'1.05',max_lifetime_chain_fee_units:tempo?'10000':'10000000000000000',expires_at:'2026-10-14T00:00:00.000Z',expected_token_decimals:6,expected_token_usd_price:1,
    payment:tempo?{rail:'mpp',chain_id:4217,token_address:`0x${'44'.repeat(20)}`,payer_address:`0x${'11'.repeat(20)}`,treasury_address:`0x${'99'.repeat(20)}`,minimum_token_reserve_units:'5000000',fee_token_address:`0x${'44'.repeat(20)}`,minimum_fee_token_reserve_units:'100000',max_fee_token_cost_units:'10000'}:
      {rail:'evm',chain_id:1,token_address:`0x${'44'.repeat(20)}`,payer_address:`0x${'11'.repeat(20)}`,treasury_address:`0x${'99'.repeat(20)}`,minimum_token_reserve_units:'5000000',minimum_native_reserve_wei:'1000000',max_gas_cost_wei:'10000000000000000'}} as OrganizationTaskProposal
  const decision={version:proposal.version,client_reference:'saved-original-task-decision',authority_hash:'a'.repeat(64),approve:true as const},checkout={version:proposal.version,client_reference:'saved-original-task-checkout',authority_hash:decision.authority_hash}
  const saved=new Map<string,string>(),calls:Array<{method:string;path:string;credential:string|undefined;body:string}>=[]
  let state='pending',checkoutExists=false,tradeStatus='pending'
  const authorization=()=>({id,organization_id:org,task_id:proposal.task_id,winning_bid_id:proposal.winning_bid_id,version:proposal.version,state,authority_hash:decision.authority_hash,decision:saved.has('decision')?decision:null})
  const result=()=>({ok:true,authorization_id:id,authority_hash:decision.authority_hash,task_id:proposal.task_id,trade:checkoutExists?{id:trade,status:tradeStatus,payment_rail:proposal.payment.rail}:null,checkout:null,workspace_url:'/taskboard/'+proposal.task_id,
    payment_authority:{id,kind:tempo?'organization_task_v2':'organization_task_v1',authority_hash:decision.authority_hash,terms:{payment:proposal.payment,token_decimals:6,token_usd_price:1,expires_at:proposal.expires_at}}})
  const server=createServer(async(req,res)=>{
    try {
      let body='';for await(const chunk of req)body+=String(chunk)
      const url=new URL(req.url!,'http://localhost'),method=req.method!
      calls.push({method,path:url.pathname+url.search,credential:req.headers.authorization,body})
      const phase=url.pathname.endsWith('/approval')?'decision':url.pathname.endsWith('/checkout')?'checkout':'proposal'
      assert.equal(req.headers.authorization,`Bearer ${phase==='decision'?'reviewer':phase==='checkout'?'buyer':'owner'}`)
      if(method==='POST'){
        const exact=JSON.stringify(phase==='proposal'?proposal:phase==='decision'?decision:checkout);assert.equal(body,exact)
        const previous=saved.get(phase)
        if(previous)assert.equal(body,previous)
        else {saved.set(phase,body);if(phase==='decision')state='approved';if(phase==='checkout')checkoutExists=true;res.destroy();return}
      }
      if(method==='DELETE')state='revoked'
      if(url.search)assert.equal(url.searchParams.get('client_reference'),proposal.client_reference)
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(phase==='checkout'?{...result(),created:false}:{authorization:authorization(),idempotent:true}))
    }catch{res.statusCode=500;res.end(JSON.stringify({error:'CONTROLLED_TEST_TRANSPORT_FAILED'}))}
  })
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())))
  const address=server.address();assert.ok(address&&typeof address==='object')
  const baseUrl=`http://127.0.0.1:${address.port}`,owner=new ClawdMarketClient({apiKey:'owner',baseUrl}),reviewer=new ClawdMarketClient({apiKey:'reviewer',baseUrl}),buyer=new ClawdMarketClient({apiKey:'buyer',baseUrl})
  await assert.rejects(owner.proposeOrganizationTask(org,proposal),(error:unknown)=>error instanceof ClawdMarketTransportError&&error.fundsState==='unknown')
  assert.equal(calls.length,1);assert.equal((await owner.recoverOrganizationTask(org,proposal.client_reference)).authorization.id,id)
  assert.equal((await owner.proposeOrganizationTask(org,proposal)).idempotent,true)
  await assert.rejects(reviewer.approveOrganizationTask(org,id,decision),ClawdMarketTransportError);assert.equal(calls.length,4)
  assert.equal((await owner.inspectOrganizationTask(org,id)).authorization.state,'approved')
  assert.equal((await reviewer.approveOrganizationTask(org,id,decision)).authorization.id,id)
  assert.equal((await buyer.recoverOrganizationTaskCheckout(org,id)).trade,null)
  await assert.rejects(buyer.checkoutOrganizationTask(org,id,checkout),ClawdMarketTransportError);assert.equal(calls.length,8)
  assert.equal((await buyer.recoverOrganizationTaskCheckout(org,id)).trade?.id,trade)
  assert.equal((await buyer.checkoutOrganizationTask(org,id,checkout)).trade?.id,trade)
  assert.equal((await owner.revokeOrganizationTask(org,id)).authorization.state,'revoked');tradeStatus='cancelled'
  assert.equal((await reviewer.approveOrganizationTask(org,id,decision)).authorization.state,'revoked')
  assert.equal((await buyer.recoverOrganizationTaskCheckout(org,id)).trade?.status,'cancelled')
  assert.equal((await buyer.checkoutOrganizationTask(org,id,checkout)).trade?.id,trade)
  assert.equal(saved.size,3);assert.equal(calls.filter(c=>c.method==='POST').length,8)
  assert.equal(SDK_CONTRACT.operations.checkout_organization_task.named_credential_scope,'payments:write')
  assert.equal(SDK_CONTRACT.operations.recover_organization_task_checkout.named_credential_scope,'payments:write')
})

test('task SDK rejects substituted organization/authorization and malformed original references before HTTP',()=>{
  let calls=0;const client=new ClawdMarketClient({apiKey:'owner',fetch:async()=>{calls++;throw Error('unexpected request')}})
  assert.throws(()=>client.inspectOrganizationTask('../foreign',id),/UUID/)
  assert.throws(()=>client.recoverOrganizationTaskCheckout(org,'../foreign'),/UUID/)
  for(const ref of [' short ','original/?foreign','a'.repeat(129),'missing'])assert.throws(()=>client.recoverOrganizationTask(org,ref),/client_reference/)
  assert.equal(calls,0)
})

test('task SDK acceptance is an explicit exact delivery hash and retains uncertainty without automatic retry',async()=>{
  const hash='d'.repeat(64),bodies:string[]=[],client=new ClawdMarketClient({apiKey:'buyer',fetch:async(url,init)=>{
    assert.equal(new URL(String(url)).pathname,`/api/trades/${trade}/confirm`);assert.equal(init?.method,'POST')
    bodies.push(String(init?.body));if(bodies.length===1)throw Error('Acceptance reply lost after commit')
    return Response.json({ok:true,trade:{id:trade,status:'completed'}})
  }})
  assert.throws(()=>client.confirmTaskDelivery(trade,'foreign-delivery'),/content_hash/);assert.equal(bodies.length,0)
  await assert.rejects(client.confirmTaskDelivery(trade,hash),ClawdMarketTransportError);assert.equal(bodies.length,1)
  await client.confirmTaskDelivery(trade,hash);assert.deepEqual(bodies,[JSON.stringify({content_hash:hash}),JSON.stringify({content_hash:hash})])
})
