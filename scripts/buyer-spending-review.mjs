/** Read-only original order review followed by explicit private approval-file creation. */
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, link, unlink } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readBuyerPaymentJournal } from './buyer-payment-journal.mjs'
import { validateBuyerSpendingApproval } from './buyer-spending-worker.mjs'

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const address=/^0x[a-f0-9]{40}$/
const fail=code=>{throw new Error(code)}
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value)
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex')
function strict(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key))||keys.some(key=>!Object.hasOwn(value,key)))fail('BUYER_REVIEW_INVALID')}
function safeUrl(value,originOnly=false){
  if(typeof value!=='string'||value!==value.trim()||/[\s\\]/.test(value))fail('BUYER_REVIEW_URL_INVALID')
  let url;try{url=new URL(value)}catch{fail('BUYER_REVIEW_URL_INVALID')}
  if(url.username||url.password||url.search||url.hash||originOnly&&url.pathname!=='/'||url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))fail('BUYER_REVIEW_URL_INVALID')
  return originOnly?url.origin:url.toString()
}
export function spendingReviewRequest(value){
  strict(value,['version','origin','organization_id','order_id','rpc_url'])
  if(value.version!==1||!uuid.test(value.organization_id)||!uuid.test(value.order_id))fail('BUYER_REVIEW_INVALID')
  return {...value,origin:safeUrl(value.origin,true),rpc_url:safeUrl(value.rpc_url)}
}
function paymentTerms(payment,version){
  const keys=['rail','chain_id','token_address','payer_address','treasury_address','minimum_token_reserve_units',...(version===2?['minimum_native_reserve_wei','max_gas_cost_wei','max_lifetime_gas_cost_wei']:['fee_token_address','minimum_fee_token_reserve_units','max_fee_token_cost_units','max_lifetime_fee_token_cost_units'])]
  strict(payment,keys)
  if(payment.rail!==(version===2?'evm':'mpp')||!['token_address','payer_address','treasury_address',...(version===3?['fee_token_address']:[])].every(key=>address.test(payment[key])))fail('BUYER_REVIEW_SCOPE_CHANGED')
  for(const key of keys.filter(key=>key.includes('reserve')||key.includes('cost'))){if(typeof payment[key]!=='string'||!/^(0|[1-9][0-9]{0,77})$/.test(payment[key])||BigInt(payment[key])>=2n**256n||key.startsWith('max_')&&BigInt(payment[key])<=0n)fail('BUYER_REVIEW_SCOPE_CHANGED')}
  const per=BigInt(version===2?payment.max_gas_cost_wei:payment.max_fee_token_cost_units),lifetime=BigInt(version===2?payment.max_lifetime_gas_cost_wei:payment.max_lifetime_fee_token_cost_units)
  if(lifetime<per)fail('BUYER_REVIEW_SCOPE_CHANGED')
  return Object.fromEntries(keys.map(key=>[key,payment[key]]))
}
export function originalSpendingReview(request,snapshot){
  request=spendingReviewRequest(request)
  const {account,order,trade,use}=snapshot??{}
  if(!account||![2,3].includes(account.version)||account.state!=='active'||account.organization_id!==request.organization_id||!uuid.test(account.id)
    ||!order||order.id!==request.order_id||order.organization_spending_account_id!==account.id
    ||!uuid.test(order.service_id)||!uuid.test(order.purchasing_approval_id)||!uuid.test(order.trade_id)
    ||!trade||trade.id!==order.trade_id||trade.status!=='pending'||trade.buyer_id!==`user_agent_${account.buyer_agent_id}`||order.buyer_id!==trade.buyer_id
    ||!use||use.order_id!==order.id||use.trade_id!==trade.id||use.account_id!==account.id||use.buyer_id!==trade.buyer_id||!/^[a-f0-9]{64}$/.test(use.authority_hash)
    ||!Number.isSafeInteger(use.amount_minor)||use.amount_minor<=0||!Number.isFinite(trade.total_cost)||Math.round(trade.total_cost*100)!==use.amount_minor
    ||!Array.isArray(account.allowed_services)||!account.allowed_services.some(pair=>pair.service_id===order.service_id&&(pair.provider_share_id??null)===(order.private_provider_share_id??null)))fail('BUYER_REVIEW_SCOPE_CHANGED')
  const payment=paymentTerms(account.payment,account.version)
  if(order.payment_rail!==payment.rail||trade.payment_rail!==payment.rail||account.authority!==(account.version===2?'approved_direct_service_evm':'approved_direct_service_mpp'))fail('BUYER_REVIEW_SCOPE_CHANGED')
  if(typeof account.expires_at!=='string'||!Number.isFinite(Date.parse(account.expires_at))||Date.parse(account.expires_at)<=Date.now())fail('BUYER_REVIEW_SCOPE_CHANGED')
  const approval={version:1,origin:request.origin,organization_id:request.organization_id,account_id:account.id,authority_hash:use.authority_hash,grant_version:account.version,
    buyer_id:trade.buyer_id,order_id:order.id,trade_id:trade.id,service_id:order.service_id,purchasing_approval_id:order.purchasing_approval_id,payment,
    token_decimals:account.token_decimals,token_usd_price:account.token_usd_price,total_cost:(use.amount_minor/100).toFixed(2),max_purchase:account.max_purchase,rpc_url:request.rpc_url}
  validateBuyerSpendingApproval(approval)
  const review={grant_reference:account.client_reference,grant_name:account.name,expires_at:account.expires_at,team_id:account.team_id,cost_center:account.cost_center,
    max_daily:account.max_daily,max_monthly:account.max_monthly,max_lifetime:account.max_lifetime,provider_share_id:order.private_provider_share_id??null}
  if(typeof review.grant_reference!=='string'||review.grant_reference.length<8||typeof review.grant_name!=='string'||typeof review.cost_center!=='string'
    ||review.team_id!==null&&!uuid.test(review.team_id)||review.provider_share_id!==null&&!uuid.test(review.provider_share_id)
    ||!['max_daily','max_monthly','max_lifetime'].every(key=>typeof review[key]==='string'&&/^(0|[1-9][0-9]{0,9})(\.[0-9]{1,2})?$/.test(review[key])))fail('BUYER_REVIEW_SCOPE_CHANGED')
  const original={version:1,request,approval,review}
  return {...original,review_sha256:digest(original)}
}
export function validateOriginalSpendingReview(value){
  strict(value,['version','request','approval','review','review_sha256'])
  strict(value.approval,['version','origin','organization_id','account_id','authority_hash','grant_version','buyer_id','order_id','trade_id','service_id','purchasing_approval_id','payment','token_decimals','token_usd_price','total_cost','max_purchase','rpc_url'])
  strict(value.review,['grant_reference','grant_name','expires_at','team_id','cost_center','max_daily','max_monthly','max_lifetime','provider_share_id'])
  paymentTerms(value.approval.payment,value.approval.grant_version)
  validateBuyerSpendingApproval(value.approval)
  const {review_sha256,...original}=value
  if(canonical(spendingReviewRequest(value.request))!==canonical(value.request))fail('BUYER_REVIEW_INVALID')
  if(value.version!==1||!/^[a-f0-9]{64}$/.test(review_sha256)||digest(original)!==review_sha256)fail('BUYER_REVIEW_INVALID')
  return value
}
async function inspectOriginal(request,apiKey,fetcher){
  request=spendingReviewRequest(request)
  if(typeof apiKey!=='string'||!/^cmos_[a-f0-9]{64}$/.test(apiKey))fail('BUYER_REVIEW_CREDENTIAL_REQUIRED')
  let response;try{response=await fetcher(request.origin+`/api/organizations/${request.organization_id}/spending-accounts/orders?order_id=${request.order_id}`,{
    method:'GET',redirect:'error',credentials:'omit',signal:AbortSignal.timeout(10_000),headers:{Authorization:`Bearer ${apiKey}`,Accept:'application/json'},
  })}catch{fail('BUYER_REVIEW_INSPECTION_UNAVAILABLE')}
  if(!response.ok)fail(response.status===401||response.status===404?'BUYER_REVIEW_SCOPE_UNAVAILABLE':'BUYER_REVIEW_INSPECTION_UNAVAILABLE')
  const reader=response.body?.getReader();if(!reader)fail('BUYER_REVIEW_INSPECTION_UNAVAILABLE')
  let length=0;const chunks=[]
  try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>65_536){await reader.cancel();fail('BUYER_REVIEW_INSPECTION_UNAVAILABLE')}chunks.push(value)}}catch{fail('BUYER_REVIEW_INSPECTION_UNAVAILABLE')}finally{reader.releaseLock()}
  try{return originalSpendingReview(request,JSON.parse(Buffer.concat(chunks).toString('utf8')))}catch(error){if(error.message==='BUYER_REVIEW_SCOPE_CHANGED')throw error;fail('BUYER_REVIEW_INVALID')}
}
async function saveOriginal(path,value){
  if(Buffer.byteLength(JSON.stringify(value))>65_536)fail('BUYER_REVIEW_INVALID')
  path=resolve(path);const parent=dirname(path);await mkdir(parent,{recursive:true,mode:0o700})
  const info=await lstat(parent);if(!info.isDirectory()||(info.mode&0o077)!==0||info.uid!==process.getuid?.())fail('BUYER_PRIVATE_STATE_DIRECTORY_REQUIRED')
  const existing=await readBuyerPaymentJournal(path)
  if(existing){if(canonical(existing)!==canonical(value))fail('BUYER_REVIEW_OUTPUT_CONFLICT');return false}
  const temporary=path+'.'+crypto.randomUUID()+'.tmp',file=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600)
  try{
    try{await file.writeFile(JSON.stringify(value,null,2)+'\n');await file.sync()}finally{await file.close()}
    try{await link(temporary,path)}catch(error){if(error.code!=='EEXIST')throw error;const saved=await readBuyerPaymentJournal(path);if(canonical(saved)!==canonical(value))fail('BUYER_REVIEW_OUTPUT_CONFLICT');return false}
    const directory=await open(parent,'r');try{await directory.sync()}finally{await directory.close()}
    return true
  }finally{await unlink(temporary).catch(()=>{})}
}
/** Both stages only GET the original reservation; neither reserves an intent nor signs or sends. */
export async function prepareBuyerSpendingReview({request,apiKey,outputPath,fetcher=fetch}){
  const review=await inspectOriginal(request,apiKey,fetcher),created=await saveOriginal(outputPath,review)
  return {state:'review_required',review_sha256:review.review_sha256,created}
}
export async function confirmBuyerSpendingReview({review,apiKey,outputPath,fetcher=fetch}){
  validateOriginalSpendingReview(review)
  const current=await inspectOriginal(review.request,apiKey,fetcher)
  if(canonical(current)!==canonical(review))fail('BUYER_REVIEW_SCOPE_CHANGED')
  const created=await saveOriginal(outputPath,current.approval)
  return {state:'approval_saved',review_sha256:review.review_sha256,created}
}
async function cli(){
  const [mode,inputPath,outputPath,...extra]=process.argv.slice(2)
  if(!['review','confirm'].includes(mode)||!inputPath||!outputPath||extra.length)fail('BUYER_REVIEW_ARGUMENTS_REQUIRED')
  const input=await readBuyerPaymentJournal(resolve(inputPath));if(!input)fail('BUYER_REVIEW_INPUT_REQUIRED')
  const result=await (mode==='review'?prepareBuyerSpendingReview({request:input,apiKey:process.env.CLAWDMARKET_SPENDING_API_KEY,outputPath}):confirmBuyerSpendingReview({review:input,apiKey:process.env.CLAWDMARKET_SPENDING_API_KEY,outputPath}))
  process.stdout.write(JSON.stringify(result)+'\n')
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))cli().catch(error=>{process.stderr.write((/^BUYER_[A-Z0-9_]+$/.test(error.message||'')?error.message:'BUYER_REVIEW_FAILED')+'\n');process.exitCode=1})
