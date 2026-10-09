import { NextRequest } from 'next/server'
import { and,eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { organization_spending_uses,service_orders,trades } from '@/lib/schema'
import { spendingOrderInput,resolveSpendingAccount } from '@/lib/organization-spending-accounts'
import { purchasingBody,purchasingResult } from '@/lib/organization-purchasing-api'
import { PurchasingError } from '@/lib/organization-purchasing-transaction'
import { ArtifactError } from '@/lib/private-artifacts'
import { reserveServiceOrder,ServiceOrderReservationError } from '@/lib/service-order-reservation'
import { serviceOrderDto } from '@/lib/service-definitions'
import { CreditError } from '@/lib/account-credit'
import { BuyerSpendPolicyError } from '@/lib/buyer-spend-policy'
import { AgentSpendPolicyError } from '@/lib/agent-spend-policy'
import { internalErrorResponse } from '@/lib/api-error'
import { rateLimit } from '@/lib/rate-limit'
import { z } from 'zod'
export const dynamic='force-dynamic'
type Context={params:Promise<{id:string}>}
function failure(error:unknown){
  if(error instanceof PurchasingError||error instanceof ArtifactError||error instanceof CreditError||error instanceof ServiceOrderReservationError)return purchasingResult({success:false,error_code:error.code,retryable:error.status===503,state:'no_funds_moved'},error.status)
  if(error instanceof BuyerSpendPolicyError||error instanceof AgentSpendPolicyError)return purchasingResult({success:false,error_code:error.code,state:'no_funds_moved'},409)
  if(error instanceof z.ZodError)return purchasingResult({error_code:'INVALID_SPENDING_ORDER'},400)
  const response=internalErrorResponse('Organization delegated purchase failed',error);response.headers.set('Cache-Control','private, no-store');return response
}
export async function POST(request:NextRequest,{params}:Context){try{
  const evidence=await resolveSpendingAccount(request,(await params).id)
  if(!evidence)return purchasingResult({error_code:'SPENDING_CREDENTIAL_REQUIRED'},401)
  const limit=await rateLimit(`organization-spending:${evidence.accountId}`,{interval:86400_000,maxRequests:100,failClosed:true})
  if(!limit.success)return purchasingResult({error_code:'SPENDING_RATE_LIMIT'},429)
  const input=await purchasingBody(request,spendingOrderInput)
  const result=await reserveServiceOrder({serviceId:input.service_id,principal:{userId:evidence.buyerId,agentId:evidence.agentId,kind:'registered-agent',usesCookieAuth:false},request:input.order,organizationSpendingEvidence:evidence})
  return purchasingResult({order:serviceOrderDto(result.order),trade:result.trade,idempotent:result.idempotent},result.idempotent?200:201)
}catch(error){return failure(error)}}
export async function GET(request:NextRequest,{params}:Context){try{
  const evidence=await resolveSpendingAccount(request,(await params).id)
  if(!evidence)return purchasingResult({error_code:'SPENDING_CREDENTIAL_REQUIRED'},401)
  const id=z.string().uuid().safeParse(request.nextUrl.searchParams.get('order_id'))
  if(!id.success)return purchasingResult({error_code:'ORIGINAL_ORDER_ID_REQUIRED'},400)
  const [use]=await db.select().from(organization_spending_uses).where(and(eq(organization_spending_uses.account_id,evidence.accountId),eq(organization_spending_uses.order_id,id.data))).limit(1)
  if(!use)return purchasingResult({error_code:'SPENDING_ORDER_NOT_FOUND'},404)
  const [order]=await db.select().from(service_orders).where(and(eq(service_orders.id,use.order_id),eq(service_orders.buyer_id,evidence.buyerId))).limit(1)
  const [trade]=await db.select().from(trades).where(eq(trades.id,use.trade_id)).limit(1)
  if(!order||!trade||order.organization_spending_account_id!==evidence.accountId||order.trade_id!==trade.id||trade.buyer_id!==evidence.buyerId)throw new PurchasingError('SPENDING_ORDER_INTEGRITY',503)
  return purchasingResult({order:serviceOrderDto(order),trade,use})
}catch(error){return failure(error)}}
