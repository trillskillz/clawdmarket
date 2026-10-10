import { NextRequest } from 'next/server'
import { z } from 'zod'
import { resolveSpendingAccount,originalSpendingPayment } from '@/lib/organization-spending-accounts'
import { createBuyerMppIntent,inspectBuyerMppIntent,claimBuyerMppPayment,BuyerMppPaymentError } from '@/lib/buyer-mpp-payment'
import { purchasingResult } from '@/lib/organization-purchasing-api'
import { PurchasingError } from '@/lib/organization-purchasing-transaction'
import { readBoundedJson,ArtifactError } from '@/lib/private-artifacts'
import { walletAuthOrigin } from '@/lib/wallet-auth'
import { getRequestOrigin } from '@/lib/request-origin'
import { rateLimit } from '@/lib/rate-limit'
import { internalErrorResponse } from '@/lib/api-error'
import * as funding from '@/lib/mpp-fund-api'
export const dynamic='force-dynamic'
type Context={params:Promise<{id:string;tradeId:string;action:string}>}
const operation=z.object({buyer_operation_id:z.string().uuid()}).strict()
const claim=z.object({intent_id:z.string().uuid(),mandate_id:z.string().uuid(),buyer_operation_id:z.string().uuid(),serialized_transaction:z.string().regex(/^0x76(?:[a-fA-F0-9]{2}){1,4096}$/)}).strict()
async function handle(request:NextRequest,{params}:Context){try{
  const {id,tradeId,action}=await params
  if(!z.string().uuid().safeParse(tradeId).success||!['intent','claim','proof'].includes(action)||request.method==='GET'&&action!=='intent')return purchasingResult({error_code:'SPENDING_PAYMENT_NOT_FOUND'},404)
  const evidence=await resolveSpendingAccount(request,id)
  if(!evidence)return purchasingResult({error_code:'SPENDING_CREDENTIAL_REQUIRED'},401)
  const original=await originalSpendingPayment((await import('@/lib/db')).db,tradeId)
  if(!original||original.account.id!==evidence.accountId||original.trade.buyer_id!==evidence.buyerId||original.account.version!==3)return purchasingResult({error_code:'SPENDING_PAYMENT_NOT_FOUND'},404)
  const limit=await rateLimit(`organization-spending-payment:${evidence.accountId}`,{interval:86400_000,maxRequests:100,failClosed:true})
  if(!limit.success)return purchasingResult({error_code:'SPENDING_RATE_LIMIT'},429)
  if(action==='intent'){
    if(request.method==='GET')return purchasingResult(await inspectBuyerMppIntent(tradeId,evidence.buyerId))
    const input=operation.parse(await readBoundedJson(request,256)),result=await createBuyerMppIntent(tradeId,evidence.buyerId,input.buyer_operation_id,walletAuthOrigin(getRequestOrigin(request)))
    return purchasingResult(result,result.created?201:200)
  }
  if(action==='claim')return purchasingResult(await claimBuyerMppPayment(tradeId,evidence.buyerId,claim.parse(await readBoundedJson(request,10_240))))
  return funding.POST(request,{params:Promise.resolve({id:tradeId})},{userId:evidence.buyerId,agentId:evidence.agentId,kind:'registered-agent',usesCookieAuth:false})
}catch(error){
  if(error instanceof PurchasingError||error instanceof BuyerMppPaymentError||error instanceof ArtifactError)return purchasingResult({error_code:error.code,send_allowed:false},error.status)
  if(error instanceof z.ZodError)return purchasingResult({error_code:'INVALID_SPENDING_PAYMENT',send_allowed:false},400)
  const response=internalErrorResponse('Organization Tempo payment failed',error);response.headers.set('Cache-Control','private, no-store');return response
}}
export async function POST(request:NextRequest,context:Context){return handle(request,context)}
export async function GET(request:NextRequest,context:Context){return handle(request,context)}
