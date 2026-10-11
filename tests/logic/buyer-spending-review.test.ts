import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, chmod, symlink, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { originalSpendingReview, spendingReviewRequest, prepareBuyerSpendingReview, confirmBuyerSpendingReview } from '../../scripts/buyer-spending-review.mjs'

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const key=`cmos_${'ab'.repeat(32)}`,address=(n:string)=>`0x${n.repeat(40)}`
const request={version:1,origin:'http://127.0.0.1:3000',organization_id:id(1),order_id:id(2),rpc_url:'http://127.0.0.1:8545/'}
function snapshot(version=2){
  const payment=version===2?{rail:'evm',chain_id:1,token_address:address('1'),payer_address:address('2'),treasury_address:address('3'),minimum_token_reserve_units:'1000000',minimum_native_reserve_wei:'1000000',max_gas_cost_wei:'100000',max_lifetime_gas_cost_wei:'200000'}
    :{rail:'mpp',chain_id:4217,token_address:address('1'),payer_address:address('2'),treasury_address:address('3'),minimum_token_reserve_units:'1000000',fee_token_address:address('1'),minimum_fee_token_reserve_units:'1000000',max_fee_token_cost_units:'10000',max_lifetime_fee_token_cost_units:'20000'}
  const buyer=`user_agent_${id(6)}`
  return {account:{version,id:id(3),organization_id:id(1),buyer_agent_id:id(6),state:'active',authority:version===2?'approved_direct_service_evm':'approved_direct_service_mpp',payment,token_decimals:6,token_usd_price:1,max_purchase:'1.05',max_daily:'2.10',max_monthly:'2.10',max_lifetime:'2.10',allowed_services:[{service_id:id(5),provider_share_id:null}],client_reference:'original-reviewed-grant',name:'Reviewed original grant',team_id:null,cost_center:'TEST',expires_at:new Date(Date.now()+60_000).toISOString(),credential_hash:'must-not-copy',credential_prefix:'must-not-copy'},
    order:{id:id(2),trade_id:id(4),service_id:id(5),purchasing_approval_id:id(7),organization_spending_account_id:id(3),buyer_id:buyer,payment_rail:payment.rail,private_provider_share_id:null,input:{private_source:'must-not-copy'}},
    trade:{id:id(4),buyer_id:buyer,payment_rail:payment.rail,total_cost:1.05,status:'pending'},use:{order_id:id(2),trade_id:id(4),account_id:id(3),buyer_id:buyer,amount_minor:105,authority_hash:'a'.repeat(64)}}
}

test('buyer review copies only original payment facts for both fixed rails without credentials or private order input',()=>{
  for(const version of [2,3]){
    const source=snapshot(version),review=originalSpendingReview(request,source)
    assert.equal(review.approval.account_id,source.account.id);assert.equal(review.approval.purchasing_approval_id,source.order.purchasing_approval_id)
    assert.deepEqual(review.approval.payment,source.account.payment);assert.equal(review.approval.total_cost,'1.05')
    assert.equal(JSON.stringify(review).includes('must-not-copy'),false)
    assert.equal('buyer_operation_id' in review.approval,false);assert.equal('serialized_transaction' in review.approval,false)
    assert.equal(originalSpendingReview(request,source).review_sha256,review.review_sha256)
  }
})

test('buyer review rejects swapped original identity, gross, service share, grant state and unsupported payment metadata',()=>{
  const mutations=[(v:any)=>{v.account.organization_id=id(9)},(v:any)=>{v.order.id=id(9)},(v:any)=>{v.use.authority_hash='bad'},(v:any)=>{v.trade.buyer_id='user_agent_foreign'},(v:any)=>{v.account.id=id(9)},(v:any)=>{v.use.amount_minor=104},(v:any)=>{v.order.private_provider_share_id=id(9)},(v:any)=>{v.account.state='revoked'},(v:any)=>{v.trade.status='escrow_held'},(v:any)=>{v.account.payment.chain_id=8453},(v:any)=>{v.account.payment.max_lifetime_gas_cost_wei='0'},(v:any)=>{v.account.payment.private_key='must-not-copy'}]
  for(const mutate of mutations){const source=snapshot();mutate(source);assert.throws(()=>originalSpendingReview(request,source),/BUYER_/)}
  for(const value of [{...request,api_key:key},{...request,origin:'https://user:secret@example.com'},{...request,rpc_url:'http://outside.invalid/'},{...request,order_id:'../other'}])assert.throws(()=>spendingReviewRequest(value),/BUYER_/)
})

test('buyer review and explicit confirmation issue only original GETs and preserve immutable private files on replay',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'clawdmarket-workspace-test-review-'))
  const calls:string[]=[],source=snapshot(),fetcher=async(url:any,init:any)=>{
    calls.push(String(url));assert.equal(init.method,'GET');assert.equal(init.body,undefined);assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');assert.equal(init.headers.Authorization,`Bearer ${key}`)
    return Response.json(source)
  }
  try{
    const reviewPath=join(directory,'review.json'),approvalPath=join(directory,'approval.json')
    assert.equal((await prepareBuyerSpendingReview({request,apiKey:key,outputPath:reviewPath,fetcher})).state,'review_required')
    const reviewed=JSON.parse(await readFile(reviewPath,'utf8'))
    assert.equal((await prepareBuyerSpendingReview({request,apiKey:key,outputPath:reviewPath,fetcher})).created,false)
    assert.equal((await confirmBuyerSpendingReview({review:reviewed,apiKey:key,outputPath:approvalPath,fetcher})).state,'approval_saved')
    assert.deepEqual(JSON.parse(await readFile(approvalPath,'utf8')),reviewed.approval)
    assert.equal((await confirmBuyerSpendingReview({review:reviewed,apiKey:key,outputPath:approvalPath,fetcher})).created,false)
    assert.equal((await stat(reviewPath)).mode&0o777,0o600);assert.equal((await stat(approvalPath)).mode&0o777,0o600)
    assert.equal(calls.length,4);assert.ok(calls.every(url=>url.endsWith(`/spending-accounts/orders?order_id=${request.order_id}`)))
    source.account.payment.treasury_address=address('4')
    await assert.rejects(confirmBuyerSpendingReview({review:reviewed,apiKey:key,outputPath:approvalPath,fetcher}),/BUYER_REVIEW_SCOPE_CHANGED/)
    assert.deepEqual(JSON.parse(await readFile(approvalPath,'utf8')),reviewed.approval)
  }finally{await rm(directory,{recursive:true,force:true})}
})

test('unavailable original review, changed review bytes and conflicting or unsafe output cannot create an approval',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'clawdmarket-workspace-test-review-'))
  let calls=0;const source=snapshot(),fetcher=async()=>{calls++;return Response.json(source)}
  try{
    const review=originalSpendingReview(request,source),path=join(directory,'approval.json')
    await assert.rejects(confirmBuyerSpendingReview({review:{...review,review_sha256:'0'.repeat(64)},apiKey:key,outputPath:path,fetcher}),/BUYER_REVIEW_INVALID/);assert.equal(calls,0)
    await assert.rejects(prepareBuyerSpendingReview({request,apiKey:'ordinary-reader',outputPath:path,fetcher}),/BUYER_REVIEW_CREDENTIAL_REQUIRED/);assert.equal(calls,0)
    await assert.rejects(confirmBuyerSpendingReview({review,apiKey:key,outputPath:path,fetcher:async()=>{throw Error('Reply lost')}}),/BUYER_REVIEW_INSPECTION_UNAVAILABLE/)
    await assert.rejects(readFile(path),{code:'ENOENT'})
    await confirmBuyerSpendingReview({review,apiKey:key,outputPath:path,fetcher})
    const other=originalSpendingReview({...request,rpc_url:'http://127.0.0.1:8546/'},source)
    await assert.rejects(confirmBuyerSpendingReview({review:other,apiKey:key,outputPath:path,fetcher}),/BUYER_REVIEW_OUTPUT_CONFLICT/)
    const linked=join(directory,'linked.json');await symlink(path,linked)
    await assert.rejects(confirmBuyerSpendingReview({review,apiKey:key,outputPath:linked,fetcher}),/BUYER_INVALID_PRIVATE_JOURNAL/)
    await chmod(directory,0o755)
    await assert.rejects(confirmBuyerSpendingReview({review,apiKey:key,outputPath:join(directory,'unsafe.json'),fetcher}),/BUYER_PRIVATE_STATE_DIRECTORY_REQUIRED/)
  }finally{await rm(directory,{recursive:true,force:true})}
})
