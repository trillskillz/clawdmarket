import 'server-only'
import { db } from './db'
import { loadReputationV2Map } from './reputation-v2'
import { REPUTATION_V2_POLICY } from './reputation-v2-policy'
/** Private operational aggregates. No buyer/owner IDs, review bodies or contracts. */
export async function inspectReputationHealth(){
 const start=Date.now()
 const [events,screening,providers,triggers]=await db.$client.batch([
  {sql:`SELECT COUNT(*) AS observed_events,COUNT(DISTINCT trade_id) AS observed_work_units,
    SUM(source_type='legacy_trade') AS legacy_backfill_work_units,SUM(source_type='legacy_trade' AND occurred_at IS NULL) AS legacy_unknown_dates,
    SUM(public_eligible=0) AS private_observations_suppressed,SUM(historical_related=1) AS historical_related_observations,
    MAX(recorded_at) AS latest_event_recorded_at FROM reputation_events`,args:[]},
  {sql:'SELECT status,statistics_json,created_at FROM reputation_screening_runs ORDER BY created_at DESC,id DESC LIMIT 1',args:[]},
  {sql:"SELECT id FROM agents WHERE visibility='public' AND archived_at IS NULL AND status IN('active','inactive') ORDER BY id LIMIT 26",args:[]},
  {sql:"SELECT COUNT(*) AS immutable_triggers FROM sqlite_master WHERE type='trigger' AND name GLOB 'reputation_*_immutable_*'",args:[]},
 ],'read')
 const projectionStart=Date.now(),sample=providers.rows.slice(0,25).map(row=>String(row.id)),records=await loadReputationV2Map(sample)
 const unavailable=[...records.values()].filter(r=>r.projection_status==='unavailable').length
 return{policy_version:REPUTATION_V2_POLICY.aggregation_policy_version,checked_at:new Date().toISOString(),latency_ms:Date.now()-start,
  projections:{sampled:sample.length,sample_truncated:providers.rows.length>25,unavailable,stale:[...records.values()].filter(r=>r.stale).length,latency_ms:Date.now()-projectionStart},
  evidence:events.rows[0],immutable_triggers:Number(triggers.rows[0]?.immutable_triggers??0),
  screening:screening.rows[0]?{status:screening.rows[0].status,statistics:JSON.parse(String(screening.rows[0].statistics_json)),last_run_at:new Date(Number(screening.rows[0].created_at)).toISOString()}:null,
  healthy:unavailable===0&&Number(triggers.rows[0]?.immutable_triggers??0)===10,publication_gate:'authorized_after_release_checks',
  ranking_promotion_gate:'closed_until_reviewed_representative_real_outcomes',
  default_ranking_changed:false,calibrated:false}
}
