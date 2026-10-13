import { REFERENCE_FLEET_MARKER } from './reference-fleet-manifest'
import 'server-only'
import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { db } from './db'
import { activityEpochSql } from './activity-query'
import { backedReputationTradeSql, eligibleReputationTradeSql,unmoderatedReputationTradeSql,fundedReputationTradeSql,resolvedReputationTradeSql } from './reputation-evidence-sql'
import { publicTradeWhereSql } from './public-trade-visibility'
import { tradePrincipalSql } from './trade-evidence-sql'
import { projectReputation, unavailableReputation, type ReputationObservation, type ReputationV2 } from './reputation-v2-model'
import { REPUTATION_V2_POLICY, type ReputationScope } from './reputation-v2-policy'
import { readWithLocalContentionRecovery } from './local-sqlite-read'

type Source=typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]
const provider="CASE WHEN t.seller_id GLOB 'user_agent_*' THEN substr(t.seller_id,12) ELSE t.seller_id END"
/** Immutable affiliation at any original transition can tighten, never loosen, current eligibility. */
export const HISTORICAL_REPUTATION_EXCLUSION_SQL="NOT EXISTS (SELECT 1 FROM reputation_events historical_event WHERE historical_event.trade_id=t.id AND historical_event.historical_related=1)"
export const PROVIDER_FAULT_SQL=`EXISTS (SELECT 1 FROM reputation_adjudications finding WHERE finding.trade_id=t.id
  AND finding.responsibility='provider' AND finding.status IN ('upheld','appealed')
  AND NOT EXISTS (SELECT 1 FROM reputation_adjudications correction WHERE correction.supersedes_id=finding.id))`
function list(value:unknown):string[]{try{const v=JSON.parse(String(value??'[]'));return Array.isArray(v)?v.filter(x=>typeof x==='string'):[]}catch{return[]}}
function millis(value:unknown):number|null{const n=Number(value);return value!==null&&value!==undefined&&Number.isFinite(n)?n:null}

export type ReputationRequest={key:string;provider_id:string;scope:ReputationScope}
/** One bounded authoritative query for all requested providers/scopes, never N+1. */
export async function loadReputationV2Records(requests:ReputationRequest[],source:Source=db) {
  if(!requests.length)return new Map<string,ReputationV2>()
  // A failed native read must not retain a lock on the shared financial pool.
  try {
    return await (source === db
      ? readWithLocalContentionRecovery(reader => loadReputationProjection(requests, reader))
      : loadReputationProjection(requests, source))
  } catch {
    console.error('reputation_v2_projection_unavailable')
    return new Map(requests.map(r=>[r.key,unavailableReputation(r.scope)]))
  }
}

async function loadReputationProjection(requests:ReputationRequest[],source:Source) {
  if(!requests.length)return new Map<string,ReputationV2>()
  const keys=[...new Set(requests.map(r=>r.provider_id))],principals=keys.flatMap(id=>[id,`user_agent_${id}`]),args: (string|number)[]=[...principals]
  let where=`t.seller_id IN (${principals.map(()=>'?').join(',')}) AND ${eligibleReputationTradeSql('t')}
    AND (t.funded_at IS NOT NULL OR t.status IN ('complete','completed','resolved'))`
  if(requests.every(r=>r.scope.service_id)){const services=[...new Set(requests.map(r=>r.scope.service_id!))];where+=` AND o.service_id IN (${services.map(()=>'?').join(',')})`;args.push(...services)}
  const success=`(${backedReputationTradeSql('t')} AND ${HISTORICAL_REPUTATION_EXCLUSION_SQL})`
  const funded=fundedReputationTradeSql('t')
  try {
    const query=`SELECT t.id, ${provider} AS provider, ${tradePrincipalSql('t.buyer_id')} AS buyer_group, t.amount,
      o.service_id, o.execution_contract_json, o.execution_started_at, r.required_capabilities, r.execution_deadline_at,
      (SELECT MAX(recorded.recorded_at)*1000 FROM reputation_events recorded WHERE recorded.trade_id=t.id) AS recorded_ms,
      (SELECT original.buyer_principal FROM reputation_events original WHERE original.trade_id=t.id ORDER BY original.recorded_at,original.id LIMIT 1) AS historical_buyer_group,
      (SELECT original.agent_version FROM reputation_events original WHERE original.trade_id=t.id AND original.agent_version IS NOT NULL ORDER BY original.recorded_at,original.id LIMIT 1) AS agent_version,
      (SELECT original.seller_principal FROM reputation_events original WHERE original.trade_id=t.id ORDER BY original.recorded_at,original.id LIMIT 1) AS operator_period,
      ${activityEpochSql('t.completed_at')} AS event_ms,
      CASE WHEN ${funded} THEN ${activityEpochSql('d.created_at')} ELSE NULL END AS delivery_ms,
      CASE WHEN ${success} THEN 'accepted'
        WHEN ${resolvedReputationTradeSql('t')} AND ${PROVIDER_FAULT_SQL} AND ${HISTORICAL_REPUTATION_EXCLUSION_SQL} THEN 'provider_failure'
        WHEN t.status IN ('escrow_held','pending_release','disputed') AND ${funded} THEN 'pending'
        ELSE 'unknown' END AS outcome,
      (SELECT AVG(feedback.score) FROM ratings feedback WHERE feedback.trade_id=t.id AND feedback.rater_id=t.buyer_id
        AND feedback.rated_id IN(t.seller_id,${provider},'user_agent_'||${provider}) AND feedback.score BETWEEN 1 AND 5 AND feedback.score=CAST(feedback.score AS INTEGER)
        AND datetime(feedback.created_at)<=datetime('now')) AS rating,
      (SELECT MAX(${activityEpochSql('feedback.created_at')}) FROM ratings feedback WHERE feedback.trade_id=t.id AND feedback.rater_id=t.buyer_id
        AND feedback.rated_id IN(t.seller_id,${provider},'user_agent_'||${provider}) AND feedback.score BETWEEN 1 AND 5 AND feedback.score=CAST(feedback.score AS INTEGER)
        AND datetime(feedback.created_at)<=datetime('now')) AS rating_ms,
      (SELECT json_group_array(DISTINCT v.method) FROM verification_results v WHERE v.trade_id=t.id AND v.status='passed'
        AND v.delivery_id=d.id AND v.content_hash=d.content_hash) AS methods,
      EXISTS(SELECT 1 FROM verification_results first_pass WHERE first_pass.trade_id=t.id AND first_pass.status='failed') AS first_pass_failure,
      (SELECT CASE WHEN finding.responsibility='provider' THEN finding.status ELSE NULL END FROM reputation_adjudications finding WHERE finding.trade_id=t.id
        AND NOT EXISTS(SELECT 1 FROM reputation_adjudications correction WHERE correction.supersedes_id=finding.id)
        ORDER BY finding.created_at DESC,finding.id DESC LIMIT 1) AS incident,
      (SELECT finding.severity FROM reputation_adjudications finding WHERE finding.trade_id=t.id
        AND finding.responsibility='provider' AND finding.status IN ('upheld','appealed')
        AND NOT EXISTS(SELECT 1 FROM reputation_adjudications correction WHERE correction.supersedes_id=finding.id) LIMIT 1) AS incident_severity,
      t.status='disputed' AS open_case
      FROM trades t LEFT JOIN service_orders o ON o.trade_id=t.id
      LEFT JOIN route_plans r ON r.service_order_id=o.id LEFT JOIN trade_deliveries d ON d.trade_id=t.id
      WHERE ${where} ORDER BY t.id LIMIT ${REPUTATION_V2_POLICY.maximum_observations+1}`
    // A single query observes one authoritative SQLite snapshot. Projection
    // performs no network IO and never supplies money or approval authority.
    const pieces=query.split('?'),statement=sql.empty()
    pieces.forEach((piece,index)=>{statement.append(sql.raw(piece));if(index<args.length)statement.append(sql`${args[index]}`)})
    const rows=await source.all(statement)
    if(rows.length>REPUTATION_V2_POLICY.maximum_observations)throw Error('reputation_history_bound')
    // Connected known affiliations retain an old repeat-customer cap while
    // current common ownership can tighten it. A transfer cannot split a known
    // historical group into new votes. Hidden control remains unverified.
    const parents=new Map<string,string>()
    const root=(key:string):string=>{const p=parents.get(key);if(!p){parents.set(key,key);return key}if(p===key)return key;const r=root(p);parents.set(key,r);return r}
    for(const raw of rows){const row=raw as Record<string,unknown>;if(row.historical_buyer_group!=null)parents.set(root(String(row.historical_buyer_group)),root(String(row.buyer_group)))}
    const facts=new Map<string,ReputationObservation[]>(),unattributed=new Map<string,Set<string>>()
    for(const raw of rows){
      const row=raw as Record<string,unknown>,key=String(row.provider)
      let contract:Record<string,unknown>|null=null;try{contract=JSON.parse(String(row.execution_contract_json))}catch{/* legacy scope stays unknown */}
      // A frozen advertised bundle does not prove which components were performed.
      const advertised=list(contract?.capabilities)
      const capabilities=Array.isArray(contract?.requested_capabilities)?contract.requested_capabilities as string[]:row.required_capabilities?list(row.required_capabilities):advertised.length===1?advertised:[]
      const version=contract?createHash('sha256').update(String(row.execution_contract_json)).digest('hex'):null
      const at=millis(row.event_ms),outcome=String(row.outcome) as ReputationObservation['outcome']
      const fact:ReputationObservation={workId:String(row.id),group:root(String(row.buyer_group)),outcome,at:at??Number.NaN,recordedAt:millis(row.recorded_ms),
        rating:outcome==='accepted'?millis(row.rating):null,ratingAt:millis(row.rating_ms),deliveryAt:millis(row.delivery_ms),deadlineAt:millis(row.execution_deadline_at),
        committedAt:row.execution_started_at==null?null:Number(row.execution_started_at)*1000,
        firstPassFailure:Boolean(row.first_pass_failure),methods:list(row.methods),incident:['upheld','appealed','overturned'].includes(String(row.incident))?String(row.incident) as ReputationObservation['incident']:null,
        serviceVersion:version,agentVersion:millis(row.agent_version),operatorPeriod:row.operator_period==null?null:String(row.operator_period),seriousIncident:row.incident_severity==='serious',openCase:Boolean(row.open_case),valueMinor:Math.round(Number(row.amount)*100)}
      for(const request of requests){const scope=request.scope;if(request.provider_id!==key)continue
        if(scope.service_id&&scope.service_id!==row.service_id)continue
        if((scope.capability_id&&capabilities.length===0)||(scope.execution_mode&&!contract?.execution_mode)||(scope.service_version&&!version)){const excluded=unattributed.get(request.key)??new Set<string>();excluded.add(String(row.id));unattributed.set(request.key,excluded);continue}
        if(scope.capability_id&&!capabilities.includes(scope.capability_id))continue
        if(scope.execution_mode&&contract?.execution_mode!==scope.execution_mode)continue
        if(scope.service_version&&version!==scope.service_version)continue
        facts.set(request.key,[...(facts.get(request.key)??[]),fact])
      }
    }
    const projections=new Map(requests.map(r=>[r.key,projectReputation(facts.get(r.key)??[],r.scope)]))
    for(const [key,record] of projections)record.scope_coverage.unattributed_work_units=unattributed.get(key)?.size??0
    if(requests.some(r=>r.scope.execution_mode!=='contracted')){
      const instantQuery=sql`SELECT c.*,session.buyer_id,session.contract_json,${sql.raw(unmoderatedReputationTradeSql('t'))} AS moderation_eligible,
        EXISTS(SELECT 1 FROM credit_entries sale WHERE sale.reference=c.id AND sale.user_id=c.seller_id AND sale.kind='instant_sale' AND sale.available_delta=c.unit_price_minor AND sale.escrow_delta=0) AS paid,
        EXISTS(SELECT 1 FROM credit_entries funding WHERE funding.reference=session.id AND funding.user_id=session.buyer_id AND funding.kind='instant_funding' AND funding.available_delta=-session.budget_minor AND funding.escrow_delta=0) AS funded
        FROM instant_calls c JOIN instant_sessions session ON session.id=c.session_id
        JOIN (SELECT original.id,original.seller_id,original_session.buyer_id FROM instant_calls original JOIN instant_sessions original_session ON original_session.id=original.session_id) t ON t.id=c.id
        WHERE c.seller_id IN (${sql.join(principals.map(id=>sql`${id}`),sql`,`)})
        AND ${sql.raw(publicTradeWhereSql('t'))}
        AND NOT EXISTS(SELECT 1 FROM agents reference_provider WHERE (reference_provider.id IN(t.buyer_id,t.seller_id) OR 'user_agent_'||reference_provider.id IN(t.buyer_id,t.seller_id)) AND instr(reference_provider.description,${REFERENCE_FLEET_MARKER})>0)
        AND ${sql.raw(`${tradePrincipalSql('t.buyer_id')}<>${tradePrincipalSql('t.seller_id')}`)}
        AND NOT EXISTS(SELECT 1 FROM reputation_events h WHERE h.source_type='instant_call' AND h.source_id=c.id AND (h.historical_related=1 OR h.public_eligible=0))
        ORDER BY c.id LIMIT ${REPUTATION_V2_POLICY.maximum_observations+1}`
      const calls=await source.all(instantQuery)
      if(calls.length>REPUTATION_V2_POLICY.maximum_observations)throw Error('reputation_instant_history_bound')
      for(const raw of calls){const row=raw as Record<string,unknown>;if(!row.funded)continue
        let contract:Record<string,unknown>;try{contract=JSON.parse(String(row.contract_json))}catch{continue}
        const caps=Array.isArray(contract.capabilities)?contract.capabilities as string[]:[],performed=caps.length===1?caps:[]
        const version=createHash('sha256').update(String(row.contract_json)).digest('hex'),provider=String(row.seller_id).replace(/^user_agent_/,'')
        let receipt:Record<string,unknown>|null=null;try{receipt=JSON.parse(String(row.receipt_json))}catch{/* not a settled schema call */}
        const backed=Number(row.moderation_eligible)===1&&!!row.paid&&receipt?.call_id===row.id&&receipt?.session_id===row.session_id&&receipt?.buyer_id===row.buyer_id&&receipt?.seller_id===row.seller_id&&receipt?.amount_minor===row.unit_price_minor&&receipt?.verification==='schema_v1'&&receipt?.output_sha256===createHash('sha256').update(String(row.output_json)).digest('hex')
        for(const request of requests){const scope=request.scope;if(request.provider_id!==provider||scope.execution_mode==='contracted')continue
          if(scope.service_id&&scope.service_id!==row.service_id||scope.capability_id&&!performed.includes(scope.capability_id)||scope.service_version&&scope.service_version!==version)continue
          const summary=projections.get(request.key)!.instant_execution
          if(row.state==='completed'&&backed)summary.schema_transport_success++
          else if(row.state==='failed')summary.failed_operations++
          else if(row.state==='claimed'||row.state==='pending')summary.pending++
          else summary.unknown++
        }
      }
    }
    return projections
  }catch{
    console.error('reputation_v2_projection_unavailable')
    return new Map(requests.map(r=>[r.key,unavailableReputation(r.scope)]))
  }
}

/** Public compatibility reader, using the same scoped projection. */
export function loadReputationV2Map(ids:string[],scope:ReputationScope={kind:'provider_history'},source:Source=db){
 return loadReputationV2Records([...new Set(ids)].map(id=>({key:id,provider_id:id,scope})),source)
}
