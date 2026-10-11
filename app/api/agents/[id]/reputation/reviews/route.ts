import { NextRequest,NextResponse } from 'next/server'
import { and,eq,sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/lib/db'
import { users,agent_owners,reputation_screening_cases as cases } from '@/lib/schema'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { isAdmin } from '@/lib/admin-auth'
import { validateCsrf } from '@/lib/csrf'
import { readBoundedJson } from '@/lib/private-artifacts'
import { appendScreeningReview } from '@/lib/reputation-screening-store'
import { ReputationDecisionError } from '@/lib/reputation-adjudication'
export const dynamic='force-dynamic'
const headers={'Cache-Control':'private, no-store',Vary:'Authorization, Cookie'}
const respond=(value:unknown,status=200)=>NextResponse.json(value,{status,headers})
type Context={params:Promise<{id:string}>}
async function access(req:NextRequest,id:string){
 const principal=await resolveRequestPrincipal(req);if(!principal)return null
 const [account]=await db.select({email:users.email}).from(users).where(eq(users.id,principal.userId)).limit(1)
 const admin=isAdmin({id:principal.userId,email:account?.email})
 const [owner]=await db.select().from(agent_owners).where(eq(agent_owners.agentId,id)).limit(1)
 return admin||principal.agentId===id||owner?.userId===principal.userId?{principal,admin}:null
}
function relevant(id:string){return sql`EXISTS(SELECT 1 FROM json_each(${cases.trade_ids_json}) work JOIN trades t ON t.id=work.value WHERE t.seller_id IN(${id},${'user_agent_'+id}))`}
export async function GET(req:NextRequest,{params}:Context){
 const {id}=await params,auth=await access(req,id);if(!auth)return respond({error:'Not found'},404)
 const rows=await db.select({id:cases.id,kind:cases.kind,created_at:cases.created_at,review:sql<string|null>`(SELECT json_object('id',r.id,'status',r.status) FROM reputation_screening_reviews r WHERE r.case_id=${cases.id} AND NOT EXISTS(SELECT 1 FROM reputation_screening_reviews next WHERE next.supersedes_id=r.id) LIMIT 1)`}).from(cases).where(relevant(id)).orderBy(cases.created_at,cases.id).limit(100)
 return respond({cases:rows.map(r=>({...r,review:r.review?JSON.parse(r.review):null})),limit:100,interpretation:'screening_signal_only; no_fraud_verdict_or_execution_effect'})
}
const input=z.object({case_id:z.string().regex(/^[a-f0-9]{64}$/),client_reference:z.string().min(8).max(128),status:z.enum(['appealed','reviewed_clear','needs_adjudication']),supersedes_id:z.uuid().nullable()}).strict()
export async function POST(req:NextRequest,{params}:Context){
 const {id}=await params,auth=await access(req,id);if(!auth)return respond({error:'Not found'},404)
 if(auth.principal.usesCookieAuth&&!validateCsrf(req))return respond({error:'CSRF validation failed'},403)
 try{
  const body=input.parse(await readBoundedJson(req,2048))
  if(!auth.admin&&body.status!=='appealed')return respond({error:'Administrator review required'},403)
  const [original]=await db.select({id:cases.id}).from(cases).where(and(eq(cases.id,body.case_id),relevant(id))).limit(1)
  if(!original)return respond({error:'Not found'},404)
  const result=await appendScreeningReview(auth.principal.userId,body.case_id,body);return respond(result,result.idempotent?200:201)
 }catch(error){if(error instanceof z.ZodError)return respond({error_code:'INVALID_REPUTATION_REVIEW'},400);if(error instanceof ReputationDecisionError)return respond({error_code:error.code},error.status);return respond({error_code:'REPUTATION_REVIEW_UNAVAILABLE'},503)}
}
