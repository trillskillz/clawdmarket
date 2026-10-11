import 'server-only'
import { createHash,randomUUID } from 'node:crypto'
import { and,eq,sql } from 'drizzle-orm'
import { db } from './db'
import { reputation_screening_runs as runs,reputation_screening_cases as cases,reputation_screening_reviews as reviews } from './schema'
import { screenReputationGraph,REPUTATION_SCREENING_POLICY } from './reputation-screening'
import { publicTradeWhereSql } from './public-trade-visibility'
import { financialBackingSql,tradePrincipalSql } from './trade-evidence-sql'
import { REFERENCE_FLEET_MARKER } from './reference-fleet-manifest'
import { activityEpochSql } from './activity-query'
import { reputationTransaction,ReputationDecisionError } from './reputation-adjudication'
import { canonicalContract } from './structured-verification'
const hash=(value:unknown)=>createHash('sha256').update(canonicalContract(value)).digest('hex')
/** Explicit background operation. Public projection readers never traverse this graph. */
export async function runReputationScreening(){
 const rows=await db.all(sql.raw(`SELECT t.id,${tradePrincipalSql('t.buyer_id')} AS buyer,${tradePrincipalSql('t.seller_id')} AS seller,
  ${activityEpochSql('t.completed_at')} AS event_ms,${activityEpochSql('u.created_at')} AS joined_ms,
  EXISTS(SELECT 1 FROM reputation_events h WHERE h.trade_id=t.id AND h.historical_related=1) AS related
  FROM trades t LEFT JOIN users u ON u.id=t.buyer_id WHERE t.status IN('completed','complete') AND t.amount>0
  AND t.id NOT GLOB 'trade_reference_*' AND ${publicTradeWhereSql('t')}
  AND NOT EXISTS(SELECT 1 FROM reputation_events h WHERE h.trade_id=t.id AND h.public_eligible=0)
  AND NOT EXISTS(SELECT 1 FROM agents a WHERE (a.id IN(t.buyer_id,t.seller_id) OR 'user_agent_'||a.id IN(t.buyer_id,t.seller_id)) AND instr(a.description,'${REFERENCE_FLEET_MARKER}')>0)
  AND EXISTS(SELECT 1 FROM verification_results v JOIN trade_deliveries d ON d.id=v.delivery_id AND d.trade_id=t.id AND d.content_hash=v.content_hash
    WHERE v.trade_id=t.id AND v.method='buyer_review' AND v.status='passed') AND ${financialBackingSql('t')}
  ORDER BY t.id LIMIT ${REPUTATION_SCREENING_POLICY.max_edges+1}`))
 const edges=rows.map(raw=>{const row=raw as Record<string,unknown>;return {from:String(row.buyer),to:String(row.seller),tradeId:String(row.id),occurredAt:row.event_ms==null?null:Number(row.event_ms),
  related:Boolean(row.related)||row.buyer===row.seller,newAccount:row.event_ms!=null&&row.joined_ms!=null&&Number(row.event_ms)>=Number(row.joined_ms)&&Number(row.event_ms)-Number(row.joined_ms)<=7*86400000}})
 const result=screenReputationGraph(edges),fingerprint=hash({policy:result.policy,edges}),now=new Date()
 return reputationTransaction(async tx=>{
  const [prior]=await tx.select().from(runs).where(eq(runs.fingerprint,fingerprint)).limit(1)
  if(prior)return {run:prior,idempotent:true,queued_cases:0}
  const {concerns,...statistics}=result
  const [run]=await tx.insert(runs).values({id:randomUUID(),policy_version:result.policy.version,fingerprint,status:result.status,statistics_json:JSON.stringify(statistics),created_at:now}).returning()
  let queued=0
  for(const concern of concerns){const inserted=await tx.insert(cases).values({id:hash({policy:result.policy.version,kind:concern.kind,trades:[...concern.trade_ids].sort()}),run_id:run.id,kind:concern.kind,trade_ids_json:JSON.stringify(concern.trade_ids),created_at:now}).onConflictDoNothing().returning();queued+=inserted.length}
  return {run,idempotent:false,queued_cases:queued}
 })
}
/** Provider appeals and admin decisions append review status, never a fraud verdict. */
export async function appendScreeningReview(actor:string,caseId:string,input:{client_reference:string;status:'appealed'|'reviewed_clear'|'needs_adjudication';supersedes_id:string|null}){
 return reputationTransaction(async tx=>{
  const requestHash=hash(input),[prior]=await tx.select().from(reviews).where(and(eq(reviews.case_id,caseId),eq(reviews.client_reference,input.client_reference))).limit(1)
  if(prior){if(prior.actor_id!==actor||prior.request_hash!==requestHash)throw new ReputationDecisionError('REPUTATION_REVIEW_REFERENCE_CONFLICT');return{review:prior,idempotent:true}}
  const [original]=await tx.select().from(cases).where(eq(cases.id,caseId)).limit(1);if(!original)throw new ReputationDecisionError('REPUTATION_CASE_NOT_FOUND',404)
  const [latest]=await tx.select().from(reviews).where(and(eq(reviews.case_id,caseId),sql`NOT EXISTS(SELECT 1 FROM reputation_screening_reviews next WHERE next.supersedes_id=${reviews.id})`)).limit(1)
  if((latest?.id??null)!==input.supersedes_id)throw new ReputationDecisionError('REPUTATION_REVIEW_HEAD_CHANGED')
  const [review]=await tx.insert(reviews).values({id:randomUUID(),case_id:caseId,actor_id:actor,client_reference:input.client_reference,request_hash:requestHash,status:input.status,supersedes_id:input.supersedes_id,created_at:new Date()}).returning()
  return{review,idempotent:false}
 })
}
