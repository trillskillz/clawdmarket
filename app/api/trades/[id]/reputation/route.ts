import { NextRequest,NextResponse } from 'next/server'
import { and,eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { trades,users,reputation_adjudications as decisions } from '@/lib/schema'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { validateCsrf } from '@/lib/csrf'
import { authorizeAdmin,isAdmin } from '@/lib/admin-auth'
import { readBoundedJson } from '@/lib/private-artifacts'
import { appendReputationDecision,reputationDecisionInput,ReputationDecisionError,reputationTransaction } from '@/lib/reputation-adjudication'
import { z } from 'zod'
export const dynamic='force-dynamic'
const headers={'Cache-Control':'private, no-store',Vary:'Authorization, Cookie'}
const response=(value:unknown,status=200)=>NextResponse.json(value,{status,headers})
type Context={params:Promise<{id:string}>}
export async function GET(req:NextRequest,{params}:Context){
 const principal=await resolveRequestPrincipal(req);if(!principal)return response({error:'Unauthorized'},401)
 const [account]=await db.select({email:users.email}).from(users).where(eq(users.id,principal.userId)).limit(1)
 const {id}=await params,[trade]=await db.select().from(trades).where(eq(trades.id,id)).limit(1)
 if(!trade||(![trade.buyer_id,trade.seller_id].includes(principal.userId)&&!isAdmin({id:principal.userId,email:account?.email})))return response({error:'Trade not found'},404)
 return response({decisions:await db.select({id:decisions.id,client_reference:decisions.client_reference,responsibility:decisions.responsibility,status:decisions.status,reason:decisions.reason,severity:decisions.severity,supersedes_id:decisions.supersedes_id,created_at:decisions.created_at}).from(decisions).where(eq(decisions.trade_id,id)).orderBy(decisions.created_at,decisions.id),permissions:{can_append_decision:isAdmin({id:principal.userId,email:account?.email}),can_appeal:trade.seller_id===principal.userId},effect:'observation_only; no_payment_authority'})
}
export async function POST(req:NextRequest,{params}:Context){
 const principal=await resolveRequestPrincipal(req)
 const [account]=principal?await db.select({email:users.email}).from(users).where(eq(users.id,principal.userId)).limit(1):[]
 const admin=authorizeAdmin(principal?{userId:principal.userId,email:account?.email}:null)
 if(admin){Object.entries(headers).forEach(([k,v])=>admin.headers.set(k,v));return admin}
 if(principal!.usesCookieAuth&&!validateCsrf(req))return response({error:'CSRF validation failed'},403)
 try{
  const input=reputationDecisionInput.parse(await readBoundedJson(req,4096)),{id}=await params
  const result=await reputationTransaction(tx=>appendReputationDecision(tx,id,principal!.userId,input))
  return response(result,result.idempotent?200:201)
 }catch(error){
  if(error instanceof ReputationDecisionError)return response({error_code:error.code},error.status)
  if(error instanceof z.ZodError)return response({error_code:'INVALID_REPUTATION_DECISION'},400)
  return response({error_code:'REPUTATION_DECISION_UNAVAILABLE'},503)
 }
}
const appeal=z.object({version:z.literal(1),client_reference:z.string().min(8).max(128),finding_id:z.uuid()}).strict()
export async function PATCH(req:NextRequest,{params}:Context){
 const principal=await resolveRequestPrincipal(req);if(!principal)return response({error:'Unauthorized'},401)
 if(principal.usesCookieAuth&&!validateCsrf(req))return response({error:'CSRF validation failed'},403)
 try{
  const input=appeal.parse(await readBoundedJson(req,2048)),{id}=await params
  const result=await reputationTransaction(async tx=>{
   const [trade]=await tx.select().from(trades).where(eq(trades.id,id)).limit(1)
   if(!trade||trade.seller_id!==principal.userId)throw new ReputationDecisionError('REPUTATION_TRADE_NOT_FOUND',404)
   const [finding]=await tx.select().from(decisions).where(and(eq(decisions.id,input.finding_id),eq(decisions.trade_id,id))).limit(1)
   if(!finding||finding.responsibility!=='provider'||finding.status!=='upheld')throw new ReputationDecisionError('REPUTATION_APPEAL_FINDING_REQUIRED')
   const [prior]=await tx.select().from(decisions).where(and(eq(decisions.trade_id,id),eq(decisions.client_reference,input.client_reference))).limit(1)
   if(prior){if(prior.actor_id!==principal.userId||prior.supersedes_id!==finding.id||prior.status!=='appealed')throw new ReputationDecisionError('REPUTATION_DECISION_REFERENCE_CONFLICT');return{decision:prior,idempotent:true}}
   const [next]=await tx.select().from(decisions).where(eq(decisions.supersedes_id,finding.id)).limit(1);if(next)throw new ReputationDecisionError('REPUTATION_FINDING_SUPERSEDED')
   const [row]=await tx.insert(decisions).values({id:crypto.randomUUID(),trade_id:id,actor_id:principal.userId,client_reference:input.client_reference,request_hash:input.finding_id,
     responsibility:finding.responsibility,status:'appealed',reason:finding.reason,severity:finding.severity,supersedes_id:finding.id,created_at:new Date()}).returning()
   return{decision:row,idempotent:false}
  });return response(result,result.idempotent?200:201)
 }catch(error){if(error instanceof ReputationDecisionError)return response({error_code:error.code},error.status);if(error instanceof z.ZodError)return response({error_code:'INVALID_REPUTATION_APPEAL'},400);return response({error_code:'REPUTATION_APPEAL_UNAVAILABLE'},503)}
}
