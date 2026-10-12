import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import { db } from './db'
import { service_definitions } from './schema'
import { inspectReputationHealth } from './reputation-health'
import { serviceReputationMap } from './service-reputation'
import { planRoute, routePlanInput } from './route-planning'
import { eligibleReputationTradeSql } from './reputation-evidence-sql'
import { REPUTATION_V2_POLICY } from './reputation-v2-policy'
import { REPUTATION_RANKING_POLICY } from './reputation-ranking'
import { reusableServiceBuyerOrdersEnabled } from './routing-feature-flags'

/** Read-only assessment. Public aggregate artifact contains no source IDs or inputs. */
export async function inspectReputationPromotion() {
  const started = Date.now()
  const health = await inspectReputationHealth()
  const services = await db.select().from(service_definitions).where(and(
    eq(service_definitions.visibility, 'public'), eq(service_definitions.status, 'active'),
    sql`(${service_definitions.seller_id} NOT GLOB 'user_agent_*' OR EXISTS (
      SELECT 1 FROM agents a WHERE ('user_agent_' || a.id) = ${service_definitions.seller_id}
      AND a.visibility='public' AND a.status='active' AND a.archived_at IS NULL))`,
  )).orderBy(service_definitions.id).limit(501)
  const projectionStarted = Date.now()
  const scoped = await serviceReputationMap(services.slice(0, 500))
  const scopedProjectionLatency = Date.now()-projectionStarted
  const records = [...scoped.values()].flat()
  const facts = await db.$client.execute(`SELECT COUNT(*) AS eligible_public_work_units,
    SUM(t.status='disputed') AS open_disputes,
    MAX((SELECT MAX(e.recorded_at) FROM reputation_events e WHERE e.trade_id=t.id AND e.public_eligible=1)) AS evidence_recorded_as_of,
    SUM(EXISTS(SELECT 1 FROM reputation_adjudications a WHERE a.trade_id=t.id)) AS adjudicated_work_units,
    SUM(EXISTS(SELECT 1 FROM reputation_events e WHERE e.trade_id=t.id AND e.historical_related=1)) AS historical_related_work_units
    FROM trades t WHERE ${eligibleReputationTradeSql('t')}`)
  // Only replay genuine stored public requests. Reference/demo/canary/private work
  // is excluded by the same projection identity/cohort policy. No request is created.
  const routes = await db.$client.execute(`SELECT r.* FROM route_plans r
    JOIN service_orders o ON o.id=r.service_order_id JOIN trades t ON t.id=o.trade_id
    WHERE ${eligibleReputationTradeSql('t')}
    ORDER BY r.created_at DESC,r.id LIMIT 26`)
  const comparisons: { examined: number; truncated: boolean; eligible_candidates: number;
    modes: { mode: string; changed_positions: number; suggested_candidates: number;
      unproven_candidates: number; unproven_top_three: number }[] }[] = []
  let invalidRequests = 0, unavailableRequests = 0, closedBuyerRequests = 0
  for (const row of routes.rows.slice(0, 25)) {
    if (!reusableServiceBuyerOrdersEnabled(String(row.buyer_id))) { closedBuyerRequests++; continue }
    try {
      const request = routePlanInput.safeParse({client_reference:String(row.client_reference),
        objective:String(row.objective), required_capabilities:JSON.parse(String(row.required_capabilities)),
        input:JSON.parse(String(row.input_json)), max_budget:{amount:(Number(row.max_budget_minor)/100).toFixed(2),currency:'USD'},
        ...(row.deadline_seconds == null ? {} : {deadline_seconds:Number(row.deadline_seconds)}),
        verification:JSON.parse(String(row.verification_policy)), payment_policy:JSON.parse(String(row.payment_policy)),
        retry_policy:JSON.parse(String(row.retry_policy)), provider_requirements:JSON.parse(String(row.provider_requirements_json))})
      if (!request.success) { invalidRequests++; continue }
      const plan = await planRoute(request.data, String(row.buyer_id))
      const shadow = 'reputation_shadow' in plan ? plan.reputation_shadow : undefined
      if (!shadow) { unavailableRequests++; continue }
      comparisons.push({examined:plan.examined,truncated:plan.truncated,eligible_candidates:shadow.eligible_candidates,
        modes:shadow.comparisons.map(mode=>({mode:mode.mode,
          changed_positions:mode.suggested_ids.filter((id,index)=>id!==shadow.baseline_ids[index]).length,
          suggested_candidates:mode.suggested_ids.length,unproven_candidates:mode.unproven_ids.length,
          unproven_top_three:mode.suggested_ids.slice(0,3).filter(id=>mode.unproven_ids.includes(id)).length}))})
    } catch { unavailableRequests++ }
  }
  const evidenceScopes = records.filter(r=>r.delivery.weighted_model_estimate!==null)
  const blockers = ['representative_outcome_and_exclusion_review_required',
    'rank_change_and_provider_concentration_review_required', 'privacy_and_false_positive_review_required']
  if (!services.length) blockers.push('no_active_public_reusable_services')
  if (!evidenceScopes.length) blockers.push('no_dated_scoped_terminal_evidence')
  if (!comparisons.some(c=>c.eligible_candidates>1)) blockers.push('no_comparable_real_hard_gated_candidate_sets')
  if (!health.healthy || records.some(r=>r.projection_status!=='current')) blockers.push('projection_health_unavailable')
  if (services.length>500 || routes.rows.length>25 || comparisons.some(c=>c.truncated)) blockers.push('bounded_sample_requires_coverage_review')
  if (invalidRequests || unavailableRequests || closedBuyerRequests) blockers.push('original_request_replay_requires_review')
  return {kind:'read_only_reputation_promotion_assessment', checked_at:new Date().toISOString(),
    source_commit:process.env.GITHUB_SHA??null, policy_version:REPUTATION_V2_POLICY.aggregation_policy_version,
    baseline_policy:REPUTATION_RANKING_POLICY.default, ranking_policy:REPUTATION_RANKING_POLICY,
    production_source:process.env.REPUTATION_AUDIT_SOURCE==='production', promotion_ready:false,
    review_status:'pending_representative_evidence_review', blockers,
    // GitHub's aggregate artifact must not disclose private health evidence or
    // screening/cohort counters. Those remain in the authorized private monitor.
    health:{policy_version:health.policy_version,checked_at:health.checked_at,
      healthy:health.healthy,latency_ms:health.latency_ms,projections:health.projections,
      immutable_triggers:health.immutable_triggers},
    coverage:{active_public_services:Math.min(services.length,500),service_sample_truncated:services.length>500,
      scoped_records:records.length,scopes_with_dated_terminal_evidence:evidenceScopes.length,
      established_scopes:records.filter(r=>r.evidence_status==='established').length,
      unavailable_scopes:records.filter(r=>r.projection_status!=='current').length,stale_scopes:records.filter(r=>r.stale).length,
      scoped_projection_latency_ms:scopedProjectionLatency,public_work_units:facts.rows[0],
      original_public_requests:Math.min(routes.rows.length,25),request_sample_truncated:routes.rows.length>25,
      invalid_original_requests:invalidRequests,unavailable_request_replays:unavailableRequests,
      original_buyer_rollout_closed:closedBuyerRequests},
    comparisons,measurement_limits:{scope_counts_are_whole_job_observations:true,
      established_provider_concentration:'requires_review_of_representative_scoped_candidate_sets',
      exclusion_false_positive_rate:'unmeasured_without_reviewed_real_cases',
      privacy_failures:'local_regression_passes; production_review_required',
      latency:'single_read_snapshot; not_a_production_percentile',
      buyer_independence:'not_verified',calibrated:false},
    latency_ms:Date.now()-started,execution_authority:false,default_ranking_changed:false}
}
