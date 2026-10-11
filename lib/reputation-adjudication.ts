import 'server-only'
import { createHash,randomUUID } from 'node:crypto'
import { and,eq,isNull } from 'drizzle-orm'
import { z } from 'zod'
import { db } from './db'
import { reputation_adjudications as decisions,trades } from './schema'
import { canonicalContract } from './structured-verification'
type Source=typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]
export class ReputationDecisionError extends Error {constructor(public code:string,public status=409){super(code)}}
export const reputationDecisionInput=z.object({
  version:z.literal(1),client_reference:z.string().min(8).max(128),
  responsibility:z.enum(['provider','buyer','platform','external','shared','unknown']),
  status:z.enum(['upheld','neutral','overturned']),
  reason:z.enum(['provider_nonperformance','provider_abandonment','buyer_cancellation','buyer_noncooperation','platform_outage','rail_delay','goodwill_refund','seller_favor','shared_fault','insufficient_evidence','finding_overturned']),
  severity:z.enum(['ordinary','serious']),supersedes_id:z.uuid().nullable(),
}).strict().superRefine((v,c)=>{
  if(v.responsibility==='provider'&&v.status==='upheld'&&!['provider_nonperformance','provider_abandonment'].includes(v.reason))c.addIssue({code:'custom',message:'Provider fault needs an attributable reason'})
  if(v.status==='overturned'&&(!v.supersedes_id||v.reason!=='finding_overturned'))c.addIssue({code:'custom',message:'Overturn the original finding explicitly'})
  if(v.status==='neutral'&&v.severity==='serious')c.addIssue({code:'custom',message:'Neutral outcomes are not serious violations'})
})
export type ReputationDecision=z.output<typeof reputationDecisionInput>
/** Caller supplies administrator authorization. Never changes money or trade status. */
export async function appendReputationDecision(source:Source,tradeId:string,actor:string,input:ReputationDecision) {
  const requestHash=createHash('sha256').update(canonicalContract(input)).digest('hex')
  const [prior]=await source.select().from(decisions).where(and(eq(decisions.trade_id,tradeId),eq(decisions.client_reference,input.client_reference))).limit(1)
  if(prior){if(prior.actor_id!==actor||prior.request_hash!==requestHash)throw new ReputationDecisionError('REPUTATION_DECISION_REFERENCE_CONFLICT');return{decision:prior,idempotent:true}}
  const [trade]=await source.select().from(trades).where(eq(trades.id,tradeId)).limit(1)
  if(!trade||!['disputed','resolved'].includes(trade.status))throw new ReputationDecisionError('REPUTATION_DISPUTE_REQUIRED')
  if(trade.resolution==='seller'&&input.responsibility==='provider'&&input.status==='upheld')throw new ReputationDecisionError('REPUTATION_SELLER_FAVOR_CONTRADICTION')
  const [latest]=await source.select().from(decisions).where(and(eq(decisions.trade_id,tradeId),
    isNull((await import('drizzle-orm')).sql`(SELECT next.id FROM reputation_adjudications next WHERE next.supersedes_id=${decisions.id})`))).limit(1)
  if((latest?.id??null)!==input.supersedes_id)throw new ReputationDecisionError('REPUTATION_ORIGINAL_FINDING_REQUIRED')
  const [row]=await source.insert(decisions).values({id:randomUUID(),trade_id:tradeId,actor_id:actor,client_reference:input.client_reference,
    request_hash:requestHash,responsibility:input.responsibility,status:input.status,reason:input.reason,severity:input.severity,supersedes_id:input.supersedes_id,created_at:new Date()}).returning()
  return{decision:row,idempotent:false}
}

/** Original references survive a lost response; contention retries a fresh snapshot. */
export async function reputationTransaction<T>(write:(tx:Parameters<Parameters<typeof db.transaction>[0]>[0])=>Promise<T>):Promise<T>{
 const {createClient}=await import('@libsql/client'),{drizzle}=await import('drizzle-orm/libsql'),schema=await import('./schema')
 for(let attempt=0;attempt<6;attempt++){
  const client=createClient({url:process.env.TURSO_DATABASE_URL?.trim()||'file:./local.db',authToken:process.env.TURSO_AUTH_TOKEN})
  try{return await drizzle(client,{schema}).transaction(write)}catch(error){
   let cause:unknown=error,busy=false
   for(let depth=0;cause&&typeof cause==='object'&&depth<6;depth++){
    const e=cause as {message?:string;cause?:unknown};busy||=/SQLITE_BUSY|database is locked|UNIQUE constraint failed: reputation_(adjudications|screening_reviews|screening_runs)\./i.test(e.message||'');cause=e.cause
   }
   if(!busy||attempt===5)throw error
  }finally{client.close()}
  await new Promise(resolve=>setTimeout(resolve,20*2**attempt))
 }
 throw new ReputationDecisionError('REPUTATION_STORAGE_BUSY',503)
}
