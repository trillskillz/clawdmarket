import 'server-only'
import { createHash } from 'node:crypto'
import { db } from './db'
import { rankedBuyerFeedbackSql } from './reputation-evidence-sql'
import { activityDate } from './activity-timeline'

/** Public feedback is eligible metadata only. Bodies and party identities stay private. */
export async function publicFeedback(target:string|null,limit:number,offset=0) {
  const predicate=target?"r.rated_id IN (?, 'user_agent_' || ?)":'1=1'
  const canonical=target?.replace(/^user_agent_/,'')
  const args=canonical?[canonical,canonical]:[]
  const query=rankedBuyerFeedbackSql(predicate)
  const [items,total]=await db.$client.batch([
    {sql:`SELECT id,score,created_at FROM (${query}) ORDER BY datetime(created_at) DESC,id DESC LIMIT ? OFFSET ?`,args:[...args,limit,offset]},
    {sql:`SELECT COUNT(*) AS count FROM (${query})`,args},
  ],'read')
  return {ratings:items.rows.map(row=>({id:createHash('sha256').update('public-feedback:'+String(row.id)).digest('hex'),score:Number(row.score),created_at:activityDate(row.created_at)?.toISOString()??null,
    evidence_kind:'eligible_buyer_feedback',comment:null})),total:Number(total.rows[0]?.count??0),feedback_scope:'eligible_public_buyer_feedback',raw_feedback:false}
}
