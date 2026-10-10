import { NextRequest } from 'next/server'
import { resolveSpendingAccount,originalSpendingPayment } from '@/lib/organization-spending-accounts'
import { purchasingResult } from '@/lib/organization-purchasing-api'
import { PurchasingError } from '@/lib/organization-purchasing-transaction'
import { readBoundedJson,ArtifactError } from '@/lib/private-artifacts'
import { claimBuyerEvmPayment,BuyerPaymentClaimError } from '@/lib/buyer-payment-claim'
import * as intentApi from '@/lib/evm-intent-api'
import * as proofApi from '@/lib/evm-fund-api'
import { rateLimit } from '@/lib/rate-limit'
import { internalErrorResponse } from '@/lib/api-error'
import { z } from 'zod'
export const dynamic='force-dynamic'
type Context={params:Promise<{id:string;tradeId:string;action:string}>}
const address=z.string().regex(/^0x[a-fA-F0-9]{40}$/)
const intentInput=z.object({chain_id:z.union([z.literal(1),z.literal(11155111)]),token_address:address,payer_address:address,buyer_operation_id:z.string().uuid()}).strict()
const proofInput=z.object({intent_id:z.string().uuid(),chain_id:z.union([z.literal(1),z.literal(11155111)]),token_address:address,payer_address:address,tx_hash:z.string().regex(/^0x[a-fA-F0-9]{64}$/),payer_signature:z.string().regex(/^0x[a-fA-F0-9]{130}$/)}).strict()
const claimInput=z.object({intent_id:z.string().uuid(),mandate_id:z.string().uuid(),buyer_operation_id:z.string().uuid(),
  serialized_transaction:z.string().regex(/^0x(?:[a-fA-F0-9]{2}){1,4096}$/),payer_signature:z.string().regex(/^0x[a-fA-F0-9]{130}$/)}).strict()
async function run(request:NextRequest,{params}:Context){try{
  const {id,tradeId,action}=await params
  if(!z.string().uuid().safeParse(tradeId).success||!['intent','claim','proof'].includes(action)||request.method==='GET'&&action!=='intent')return purchasingResult({error_code:'SPENDING_PAYMENT_NOT_FOUND'},404)
  const evidence=await resolveSpendingAccount(request,id)
  if(!evidence)return purchasingResult({error_code:'SPENDING_CREDENTIAL_REQUIRED'},401)
  const original=await originalSpendingPayment((await import('@/lib/db')).db,tradeId)
  if(!original||original.account.id!==evidence.accountId||original.trade.buyer_id!==evidence.buyerId||original.account.version!==2)return purchasingResult({error_code:'SPENDING_PAYMENT_NOT_FOUND'},404)
  const limit=await rateLimit(`organization-spending-payment:${evidence.accountId}`,{interval:86400_000,maxRequests:100,failClosed:true})
  if(!limit.success)return purchasingResult({error_code:'SPENDING_RATE_LIMIT'},429)
  const principal={userId:evidence.buyerId,agentId:evidence.agentId,kind:'registered-agent' as const,usesCookieAuth:false},context={params:Promise.resolve({id:tradeId})}
  if(action==='claim')return purchasingResult(await claimBuyerEvmPayment(tradeId,evidence.buyerId,claimInput.parse(await readBoundedJson(request,10_240))))
  // Bound the existing intent/proof implementation's JSON parsing before calling it.
  let bounded=request
  if(request.method==='POST')bounded=new NextRequest(request.url,{method:'POST',headers:request.headers,body:JSON.stringify((action==='proof'?proofInput:intentInput).parse(await readBoundedJson(request,10_240)))})
  const response=action==='proof'?await proofApi.POST(bounded,context,principal):request.method==='GET'?await intentApi.GET(bounded,context,principal):await intentApi.POST(bounded,context,principal)
  response.headers.set('Cache-Control','private, no-store');response.headers.set('Vary','Authorization, Cookie');return response
}catch(error){
  if(error instanceof PurchasingError||error instanceof BuyerPaymentClaimError||error instanceof ArtifactError)return purchasingResult({error_code:error.code,send_allowed:false},error.status)
  if(error instanceof z.ZodError)return purchasingResult({error_code:'INVALID_SPENDING_PAYMENT',send_allowed:false},400)
  const response=internalErrorResponse('Organization payment recovery failed',error);response.headers.set('Cache-Control','private, no-store');return response
}}
export async function GET(request:NextRequest,context:Context){return run(request,context)}
export async function POST(request:NextRequest,context:Context){return run(request,context)}
