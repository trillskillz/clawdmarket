/** Buyer-host funding of one original approved enterprise service order. */
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Credential } from 'mppx'
import { parseUnits, keccak256, toHex } from 'viem'
import { Account } from 'viem/tempo'
import { canonicalJSON } from './verifier-contract.mjs'
import { readBuyerPaymentJournal, saveBuyerPaymentJournal } from './buyer-payment-journal.mjs'
import { buyerWalletReference, withBuyerWalletLock } from './buyer-wallet-lock.mjs'
import { inspectSignedEvmPayment, assertBuyerWalletReserve } from '../lib/buyer-signed-transaction.mjs'
import { inspectSignedTempoPayment } from '../lib/buyer-tempo-transaction.mjs'
import { assertBuyerTempoReserve } from '../lib/buyer-tempo-fees.mjs'
import { evmPaymentProofMessage } from '../lib/evm-payment-message.mjs'
import { createBuyerEvmAdapter } from './buyer-evm-adapter.mjs'
import { createBuyerTempoAdapter } from './buyer-tempo-adapter.mjs'

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const fingerprint=value=>createHash('sha256').update(canonicalJSON(value)).digest('hex')
const complete=['funded','refunded']
function fail(code){throw new Error(code)}
function origin(value){const url=new URL(value);if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))fail('BUYER_ORIGIN_INVALID');return url.origin}
function cents(value){if(typeof value!=='string'||!/^[1-9][0-9]{0,8}(?:\.[0-9]{1,2})?$|^0\.[0-9]{2}$/.test(value))fail('BUYER_SPENDING_APPROVAL_INVALID');const result=Number(parseUnits(value,2));if(!Number.isSafeInteger(result)||result<=0)fail('BUYER_SPENDING_APPROVAL_INVALID');return result}
const frozenIntent=intent=>fingerprint({...intent,tx_hash:undefined,payer_signature:undefined})
async function chain(operation){try{return await operation()}catch(error){if(/^BUYER_[A-Z0-9_]+$/.test(error.message||''))throw error;fail('BUYER_CHAIN_UNAVAILABLE_RESUME_SAME_PAYMENT')}}
function reviewed(approval){
  if(approval?.version!==1||![2,3].includes(approval.grant_version)||!['organization_id','account_id','order_id','trade_id','service_id','purchasing_approval_id'].every(key=>uuid.test(approval[key]))
    ||typeof approval.buyer_id!=='string'||!approval.buyer_id.startsWith('user_agent_')||!/^[a-f0-9]{64}$/.test(approval.authority_hash))fail('BUYER_SPENDING_APPROVAL_INVALID')
  const payment=approval.payment
  if(!payment||payment.rail!==(approval.grant_version===2?'evm':'mpp')||!['token_address','payer_address','treasury_address'].every(key=>/^0x[0-9a-f]{40}$/.test(payment[key]||''))
    ||!Number.isInteger(approval.token_decimals)||approval.token_decimals<0||approval.token_decimals>36||!Number.isFinite(approval.token_usd_price)||approval.token_usd_price<=0)fail('BUYER_SPENDING_APPROVAL_INVALID')
  if(payment.rail==='evm'?![1,11155111].includes(payment.chain_id):payment.chain_id!==4217||approval.token_decimals!==6||approval.token_usd_price!==1||payment.fee_token_address!==payment.token_address)fail('BUYER_SPENDING_APPROVAL_INVALID')
  if(cents(approval.total_cost)>cents(approval.max_purchase))fail('BUYER_SPENDING_APPROVAL_INVALID')
  return payment
}
/** No checkout, approval creation, delivery acceptance, payout, top-up or replacement signing. */
export async function runBuyerSpendingFunding({approval,apiKey,recoveryApiKey,stateDirectory,account,adapter,fetcher=fetch,prepareOnly=false}){
  const payment=reviewed(approval),base=origin(approval.origin)
  if(typeof apiKey!=='string'||!/^cmos_[a-f0-9]{64}$/.test(apiKey)||recoveryApiKey!==undefined&&(typeof recoveryApiKey!=='string'||!recoveryApiKey.trim())||!stateDirectory||account?.type!=='local'||typeof account.signTransaction!=='function'
    ||account.address.toLowerCase()!==payment.payer_address||adapter?.chainId!==payment.chain_id||adapter.rpcUrl!==new URL(approval.rpc_url).toString())fail('BUYER_CONFIGURATION_INVALID')
  const scoped=`/api/organizations/${approval.organization_id}/spending-accounts/orders/${approval.trade_id}/fund/${payment.rail}`
  const original=`/api/trades/${approval.trade_id}/fund/${payment.rail}`
  return withBuyerWalletLock(stateDirectory,payment.chain_id,payment.payer_address,async signal=>{
    const api=async(method,path,body,{recover=false,credential,confirming=false}={})=>{
      signal.throwIfAborted();let response
      try{
        response=await fetcher(base+path,{method,redirect:'error',credentials:'omit',signal:AbortSignal.any([signal,AbortSignal.timeout(10_000)]),headers:{Authorization:`Bearer ${recover?recoveryApiKey:apiKey}`,Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'}),...(credential?{'Payment-Authorization':credential}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})})
        const reader=response.body?.getReader(),chunks=[];if(!reader)fail('BUYER_RESPONSE_INVALID');let size=0,value
        try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>65536)fail('BUYER_RESPONSE_TOO_LARGE');chunks.push(Buffer.from(part.value))}value=JSON.parse(Buffer.concat(chunks).toString('utf8'))}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
        signal.throwIfAborted()
        if(!response.ok){if(confirming&&response.status===409&&value.code==='PAYMENT_CONFIRMING'&&value.retryable===true)return {confirming:true};if(!recover&&[401,403].includes(response.status))fail('BUYER_SPENDING_KEY_CLOSED');fail(`BUYER_HTTP_${response.status}`)}
        return value
      }catch(error){if(/^BUYER_[A-Z0-9_]+$/.test(error.message||''))throw error;fail('BUYER_REQUEST_UNCERTAIN_RESUME_SAME_PAYMENT')}
    }
    const reference=fingerprint({kind:'organization-service-funding-v1',origin:base,approval}),wallet=buyerWalletReference(payment.chain_id,payment.payer_address),directory=resolve(stateDirectory),stateFile=resolve(directory,reference+'.json'),walletFile=resolve(directory,wallet+'.json')
    let journal=await readBuyerPaymentJournal(stateFile)
    if(journal&&(journal.reference!==reference||journal.approval_hash!==fingerprint(approval)||journal.wallet!==wallet||journal.origin!==base||journal.trade_id!==approval.trade_id||journal.order_id!==approval.order_id||journal.account_id!==approval.account_id||!uuid.test(journal.operation_id)||journal.rail!==payment.rail))fail('BUYER_JOURNAL_SCOPE_MISMATCH')
    const result=()=>({state:journal.state,order_id:approval.order_id,trade_id:approval.trade_id,tx_hash:journal.tx_hash,idempotent:true})
    if(journal&&complete.includes(journal.state))return result()
    const previousWallet=await readBuyerPaymentJournal(walletFile)
    if(previousWallet&&(previousWallet.wallet!==wallet||!/^[a-f0-9]{64}$/.test(previousWallet.active_reference)))fail('BUYER_JOURNAL_SCOPE_MISMATCH')
    if(previousWallet&&previousWallet.active_reference!==reference){const previous=await readBuyerPaymentJournal(resolve(directory,previousWallet.active_reference+'.json'));if(!previous||previous.reference!==previousWallet.active_reference||previous.wallet!==wallet||!complete.includes(previous.state))fail('BUYER_WALLET_PAYMENT_UNRECONCILED')}
    let closed=false
    try{
      const inspected=await api('GET',`/api/organizations/${approval.organization_id}/spending-accounts/orders?order_id=${approval.order_id}`)
      if(inspected.use?.authority_hash!==approval.authority_hash||inspected.use.account_id!==approval.account_id||inspected.use.trade_id!==approval.trade_id||inspected.use.amount_minor!==cents(approval.total_cost)
        ||inspected.order?.id!==approval.order_id||inspected.order.trade_id!==approval.trade_id||inspected.order.service_id!==approval.service_id||inspected.order.purchasing_approval_id!==approval.purchasing_approval_id||inspected.order.organization_spending_account_id!==approval.account_id||inspected.trade?.id!==approval.trade_id||inspected.trade.buyer_id!==approval.buyer_id||inspected.trade.payment_rail!==payment.rail||Math.round(inspected.trade.total_cost*100)!==cents(approval.total_cost))fail('BUYER_CHECKOUT_SCOPE_MISMATCH')
    }catch(error){if(error.message!=='BUYER_SPENDING_KEY_CLOSED'||!journal?.serialized_transaction||!recoveryApiKey)throw error;closed=true}
    await saveBuyerPaymentJournal(walletFile,{version:1,wallet,active_reference:reference})
    if(!journal){journal={version:1,reference,approval_hash:fingerprint(approval),wallet,origin:base,trade_id:approval.trade_id,order_id:approval.order_id,account_id:approval.account_id,operation_id:crypto.randomUUID(),rail:payment.rail,state:'planned',submission_started:false};await saveBuyerPaymentJournal(stateFile,journal)}
    const save=async()=>{signal.throwIfAborted();await saveBuyerPaymentJournal(stateFile,journal)}
    const inspection=async()=>{
      if(closed)return api('GET',original+'/intent',undefined,{recover:true})
      try{return await api('GET',scoped+'/intent')}catch(error){if(error.message!=='BUYER_SPENDING_KEY_CLOSED'||!journal.serialized_transaction||!recoveryApiKey)throw error;closed=true;return api('GET',original+'/intent',undefined,{recover:true})}
    }
    if(!journal.intent){
      if(closed||journal.serialized_transaction||journal.tx_hash||journal.submission_started)fail('BUYER_ORIGINAL_INTENT_REQUIRED')
      journal.state='intent_requested';await save()
      const made=await api('POST',scoped+'/intent',{buyer_operation_id:journal.operation_id,...(payment.rail==='evm'?{chain_id:payment.chain_id,token_address:payment.token_address,payer_address:payment.payer_address}:{})}),intent=made.intent
      if(!intent||!uuid.test(intent.id)||intent.buyer_operation_id!==journal.operation_id||intent.trade_id!==approval.trade_id||intent.buyer_id!==approval.buyer_id||intent.origin!==base||intent.chain_id!==payment.chain_id||intent.payer_address!==payment.payer_address||intent.token_address!==payment.token_address||intent.treasury_address!==payment.treasury_address||intent.token_decimals!==approval.token_decimals||Math.round(intent.amount_usd*100)!==cents(approval.total_cost)||intent.token_amount!==parseUnits((intent.amount_usd/approval.token_usd_price).toFixed(approval.token_decimals),approval.token_decimals).toString()||made.claim_required!==true||intent.tx_hash)fail('BUYER_ORIGINAL_INTENT_REQUIRED')
      if(payment.rail==='mpp'){
        const challenge=intent.challenge
        if(intent.account_id!==approval.account_id||intent.authority_hash!==approval.authority_hash||challenge?.method!=='tempo'||challenge.intent!=='charge'||challenge.request?.amount!==intent.token_amount||challenge.request.currency?.toLowerCase()!==payment.token_address||challenge.request.recipient?.toLowerCase()!==payment.treasury_address||challenge.request.externalId!==approval.trade_id||challenge.request.methodDetails?.chainId!==payment.chain_id||challenge.request.methodDetails?.memo!==keccak256(toHex(`clawdmarket:${approval.trade_id}`))||challenge.request.methodDetails?.feePayer===true||challenge.request.methodDetails?.splits?.length||challenge.expires!==intent.expires_at)fail('BUYER_ORIGINAL_INTENT_REQUIRED')
      }else if(intent.token_usd_price!==approval.token_usd_price)fail('BUYER_ORIGINAL_INTENT_REQUIRED')
      journal.intent=intent;journal.intent_hash=frozenIntent(intent);journal.state='intent_ready';await save()
    }
    if(frozenIntent(journal.intent)!==journal.intent_hash||journal.intent.buyer_operation_id!==journal.operation_id||journal.intent.trade_id!==approval.trade_id)fail('BUYER_JOURNAL_SCOPE_MISMATCH')
    let server=await inspection()
    if(!server.intent||frozenIntent(server.intent)!==journal.intent_hash)fail('BUYER_ORIGINAL_INTENT_REQUIRED')
    const inspect=raw=>payment.rail==='evm'?inspectSignedEvmPayment(raw,journal.intent,payment):inspectSignedTempoPayment(raw,journal.intent,payment)
    const reserve=async raw=>{
      const snapshot=await chain(()=>adapter.snapshot(raw,payment,signal)),common={...snapshot,paymentAmount:BigInt(journal.intent.token_amount),payment}
      if(payment.rail==='evm')assertBuyerWalletReserve(common);else assertBuyerTempoReserve(common)
    }
    if(!journal.serialized_transaction){
      if(closed||journal.submission_started||journal.tx_hash||journal.payer_signature||journal.credential||server.claim)fail('BUYER_ORIGINAL_TRANSACTION_REQUIRED')
      const raw=await chain(()=>adapter.prepare(journal.intent,signal)),checked=await inspect(raw);await reserve(raw)
      journal.serialized_transaction=raw;journal.tx_hash=checked.tx_hash
      if(payment.rail==='evm')journal.payer_signature=await account.signMessage({message:evmPaymentProofMessage(journal.intent,checked.tx_hash)})
      else journal.credential=Credential.serialize({challenge:journal.intent.challenge,payload:{type:'transaction',signature:raw},source:`did:pkh:eip155:${payment.chain_id}:${payment.payer_address}`})
      journal.state='signed';await save()
    }
    const checked=await inspect(journal.serialized_transaction)
    if(journal.tx_hash!==checked.tx_hash||typeof journal.submission_started!=='boolean'||payment.rail==='evm'&&!/^0x[a-fA-F0-9]{130}$/.test(journal.payer_signature||'')||payment.rail==='mpp'&&journal.credential!==Credential.serialize({challenge:journal.intent.challenge,payload:{type:'transaction',signature:journal.serialized_transaction},source:`did:pkh:eip155:${payment.chain_id}:${payment.payer_address}`}))fail('BUYER_JOURNAL_SCOPE_MISMATCH')
    const claimMatches=claim=>claim?.intent_id===journal.intent.id&&claim.trade_id===approval.trade_id&&claim.account_id===approval.account_id&&claim.authority_hash===approval.authority_hash&&claim.tx_hash===journal.tx_hash&&claim.chain_id===payment.chain_id&&claim.payer_address===payment.payer_address&&claim.nonce===checked.nonce&&(payment.rail==='mpp'?claim.valid_before===checked.valid_before&&claim.maximum_fee_token_cost_units===checked.maximum_fee_token_cost_units&&claim.fee_token_address===payment.fee_token_address:claim.maximum_execution_gas_cost_wei===checked.maximum_execution_gas_cost_wei)
    if(server.claim&&!claimMatches(server.claim))fail('BUYER_CLAIM_SCOPE_MISMATCH')
    const proof=payment.rail==='evm'?{intent_id:journal.intent.id,chain_id:payment.chain_id,token_address:payment.token_address,payer_address:payment.payer_address,tx_hash:journal.tx_hash,payer_signature:journal.payer_signature}:{tx_hash:journal.tx_hash,payer_address:payment.payer_address}
    const reconcile=async()=>{
      let funded
      if(closed)funded=await api('POST',original,proof,{recover:true,confirming:true})
      else try{funded=await api('POST',scoped+'/proof',proof,{confirming:true})}catch(error){if(error.message!=='BUYER_SPENDING_KEY_CLOSED'||!recoveryApiKey)throw error;closed=true;funded=await api('POST',original,proof,{recover:true,confirming:true})}
      if(funded.confirming)return false
      server=await inspection()
      if(!server.intent||frozenIntent(server.intent)!==journal.intent_hash||!claimMatches(server.claim)||server.claim.state!=='confirmed'||server.trade?.id!==approval.trade_id||funded.ok!==true)fail('BUYER_FUNDING_RECEIPT_MISMATCH')
      if(['escrow_held','pending_release','completed','complete','disputed','resolved'].includes(server.trade.status))journal.state='funded'
      else if(server.trade.status==='cancelled'&&server.trade.payout_status==='refunded')journal.state='refunded'
      else if(server.trade.status==='cancelled'&&server.trade.payout_status==='processing')journal.state='refund_pending'
      else fail('BUYER_FUNDING_RECEIPT_MISMATCH')
      await save();return true
    }
    if(closed||server.claim?.state==='confirmed'||journal.submission_started||server.claim?.first_submission_at){if(await reconcile())return result()}
    if(prepareOnly&&!closed&&!journal.submission_started&&!server.claim?.first_submission_at)return {...result(),state:'prepared'}
    if(closed){if(await reconcile())return result();return {...result(),state:'held_recover_existing_payment'}}
    const claimed=await api('POST',scoped+'/claim',{intent_id:journal.intent.id,mandate_id:approval.account_id,buyer_operation_id:journal.operation_id,serialized_transaction:journal.serialized_transaction,...(payment.rail==='evm'?{payer_signature:journal.payer_signature}:{})})
    if(!claimMatches(claimed.claim)||payment.rail==='mpp'&&(claimed.claim.valid_before!==checked.valid_before||claimed.claim.maximum_fee_token_cost_units!==checked.maximum_fee_token_cost_units)||payment.rail==='evm'&&claimed.claim.maximum_execution_gas_cost_wei!==checked.maximum_execution_gas_cost_wei)fail('BUYER_CLAIM_SCOPE_MISMATCH')
    if(claimed.send_allowed!==true){if(await reconcile())return result();return {...result(),state:'held_recover_existing_payment'}}
    if(journal.submission_started&&await chain(()=>adapter.lookup(journal.tx_hash,signal)))return {...result(),state:'awaiting_confirmation'}
    await reserve(journal.serialized_transaction)
    journal.submission_started=true;journal.state='payment_unknown';await save();signal.throwIfAborted()
    if(payment.rail==='evm'){
      let submitted;try{submitted=await adapter.broadcast(journal.serialized_transaction,signal)}catch{fail('BUYER_BROADCAST_UNCERTAIN_RESUME_SAME_PAYMENT')}
      if(submitted?.toLowerCase()!==journal.tx_hash)fail('BUYER_BROADCAST_HASH_MISMATCH')
    }else await api('POST',scoped+'/proof',undefined,{credential:journal.credential,confirming:true})
    if(await reconcile())return {...result(),idempotent:false}
    return {...result(),state:'awaiting_confirmation'}
  })
}
async function cli(){
  const [approvalPath,stateDirectory,mode]=process.argv.slice(2)
  if(!approvalPath||!stateDirectory||mode&&mode!=='--prepare-only')fail('BUYER_APPROVAL_AND_STATE_REQUIRED')
  const approval=await readBuyerPaymentJournal(resolve(approvalPath));if(!approval)fail('BUYER_APPROVAL_AND_STATE_REQUIRED')
  const payment=reviewed(approval),account=payment.rail==='mpp'?Account.fromSecp256k1(process.env.CLAWDMARKET_BUYER_PRIVATE_KEY):(await import('viem/accounts')).privateKeyToAccount(process.env.CLAWDMARKET_BUYER_PRIVATE_KEY)
  const adapter=(payment.rail==='mpp'?createBuyerTempoAdapter:createBuyerEvmAdapter)({chainId:payment.chain_id,rpcUrl:approval.rpc_url,account})
  process.stdout.write(JSON.stringify(await runBuyerSpendingFunding({approval,apiKey:process.env.CLAWDMARKET_SPENDING_API_KEY,recoveryApiKey:process.env.CLAWDMARKET_BUYER_API_KEY,stateDirectory,account,adapter,prepareOnly:mode==='--prepare-only'}))+'\n')
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))cli().catch(error=>{process.stderr.write((/^BUYER_[A-Z0-9_]+$/.test(error.message||'')?error.message:'BUYER_WORKER_STOPPED_RESUME_SAME_PAYMENT')+'\n');process.exitCode=1})
