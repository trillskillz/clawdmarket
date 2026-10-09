import { parseUnits } from 'viem'
import { db } from './db'
import { publicTradeWhereSql } from './public-trade-visibility'
import { REFERENCE_FLEET_MARKER } from './reference-fleet-manifest'

function count(value: unknown) { return Math.max(0, Number(value) || 0) }
function rate(numerator: number, denominator: number) { return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : null }
function money(minor: number) { return (minor / 100).toFixed(2) }
const allSteps = '(SELECT id, mandate_id, route_id, order_id, trade_id, amount_minor, terms_hash, state FROM route_funding_steps UNION ALL SELECT id, mandate_id, route_id, order_id, trade_id, amount_minor, terms_hash, state FROM route_retry_funding_steps)'
const receiptJSON = "CASE WHEN json_valid(receipt.receipt_json) THEN receipt.receipt_json ELSE '{}' END"
const field = (path: string) => `json_extract(${receiptJSON}, '$.${path}')`

/** Aggregate-only metrics. Production automation requires durable funding and the first agent decision, never a client label. */
export async function getRouteMetrics() {
  const [totals, origins, capacity, checks, outcomes] = await Promise.all([
    db.$client.execute({ sql: `WITH route_evidence AS (
      SELECT r.id, r.state, r.service_order_id, r.candidates_json, r.created_at AS planned_at, o.price_minor,
        COALESCE(origin.channel, 'legacy_unknown') AS channel, COALESCE(origin.cohort, 'legacy_unknown') AS cohort,
        unixepoch(t.funded_at) AS funded_at, unixepoch(d.created_at) AS delivered_at, t.completed_at,
        CASE WHEN r.state = 'completed' AND t.status IN ('completed','complete') AND EXISTS (
          SELECT 1 FROM capability_performance_events e WHERE e.trade_id = t.id AND e.service_order_id = o.id AND e.evidence_kind = 'buyer_accepted_completion'
        ) THEN 1 ELSE 0 END AS accepted_settled,
        CASE WHEN t.funded_at IS NOT NULL AND funding.id IS NOT NULL THEN 1 ELSE 0 END AS funded,
        CASE WHEN provider.id IS NOT NULL THEN 1 ELSE 0 END AS dispatch_queued,
        CASE WHEN provider.accepted_at IS NOT NULL THEN 1 ELSE 0 END AS provider_acknowledged,
        CASE WHEN d.id IS NOT NULL THEN 1 ELSE 0 END AS delivered,
        CASE WHEN d.id IS NOT NULL AND EXISTS (SELECT 1 FROM verification_results v WHERE v.trade_id = t.id AND v.delivery_id = d.id
          AND v.content_hash = d.content_hash AND v.method = 'buyer_review' AND v.status = 'passed') THEN 1 ELSE 0 END AS buyer_accepted,
        CASE WHEN payout.status = 'confirmed' AND payout.tx_hash IS NOT NULL THEN 1 ELSE 0 END AS payout_confirmed,
        CASE WHEN receipt.trade_id = t.id AND r.state = 'completed' AND o.state = 'completed' AND o.capacity_released_at IS NOT NULL
          AND t.status IN ('completed','complete') AND t.payout_status = 'complete' AND t.completed_at IS NOT NULL
          AND ${field('version')} = 1 AND ${field('route_id')} = r.id AND ${field('trade_id')} = t.id
          AND ${field('settlement_status')} = 'completed' AND ${field('capacity_released')} = 1
          AND ${field('delivery.content_hash')} = d.content_hash AND ${field('buyer_decision.content_hash')} = d.content_hash
          AND ${field('buyer_decision.decision')} = 'accepted' AND funding.tx_hash = ${field('financial.funding.tx_hash')}
          AND funding.id = ${field('financial.funding.receipt_id')} AND funding.token_amount = ${field('financial.funding.token_amount')}
          AND payout.status = 'confirmed' AND payout.confirmed_at IS NOT NULL AND payout.id = ${field('financial.payout.transfer_id')}
          AND payout.tx_hash = ${field('financial.payout.tx_hash')} AND payout.token_amount = ${field('financial.payout.token_amount')}
          AND payout.business_key = (t.id || ':seller_payout') AND funding.payment_rail = t.payment_rail
          AND payout.chain_id = funding.chain_id AND lower(payout.token_address) = lower(funding.token_address)
          AND round(funding.usd_value_at_payment * 100) = round(t.total_cost * 100) AND round(payout.usd_amount * 100) = round(t.seller_amount * 100)
          AND ${field('financial.kind')} = 'confirmed_external'
          AND EXISTS (SELECT 1 FROM verification_results v WHERE v.trade_id = t.id AND v.delivery_id = d.id AND v.content_hash = d.content_hash AND v.method = 'buyer_review' AND v.status = 'passed')
          THEN 1 ELSE 0 END AS backed_receipt,
        CASE WHEN origin.channel = 'authenticated_agent' AND origin.cohort = 'production' AND decision.route_id = r.id AND decision.delivery_hash = d.content_hash
          AND ${field('automation.origin.channel')} = origin.channel AND ${field('automation.origin.cohort')} = origin.cohort
          AND ${field('automation.durable_buyer_funding')} = 1 AND ${field('automation.authenticated_agent_decision')} = 1
          AND provider.state = 'delivered' AND provider.accepted_at IS NOT NULL AND provider.completed_at IS NOT NULL
          AND step.state = 'funded' AND step.order_id = o.id AND ${field('authority.mandate_id')} = step.mandate_id
          AND ${field('authority.terms_hash')} = step.terms_hash AND ${field('authority.funding_step_id')} = step.id
          AND ((evm.buyer_operation_id IS NOT NULL AND evmClaim.state = 'confirmed' AND evmClaim.tx_hash = funding.tx_hash
            AND funding.chain_id = evm.chain_id AND lower(funding.token_address) = lower(evm.token_address)
            AND lower(funding.payer_address) = lower(evm.payer_address) AND funding.token_amount = evm.token_amount
            AND evmClaim.mandate_id = step.mandate_id AND evmClaim.terms_hash = step.terms_hash AND funding.payment_rail = 'evm')
            OR (tempo.buyer_operation_id IS NOT NULL AND tempoClaim.state = 'confirmed' AND tempoClaim.tx_hash = funding.tx_hash
            AND funding.chain_id = tempo.chain_id AND lower(funding.token_address) = lower(tempo.token_address)
            AND lower(funding.payer_address) = lower(tempo.payer_address) AND funding.token_amount = tempo.token_amount
            AND tempoClaim.mandate_id = step.mandate_id AND tempoClaim.terms_hash = step.terms_hash AND funding.payment_rail = 'mpp'))
          AND r.buyer_id GLOB 'user_agent_*' AND t.seller_id GLOB 'user_agent_*' AND r.buyer_id <> t.seller_id
          AND t.id NOT GLOB 'trade_reference_*'
          AND EXISTS (SELECT 1 FROM agents a WHERE ('user_agent_' || a.id) = t.seller_id AND instr(a.description, ?) = 0)
          AND EXISTS (SELECT 1 FROM agents a WHERE ('user_agent_' || a.id) = t.buyer_id AND instr(a.description, ?) = 0)
          AND EXISTS (SELECT 1 FROM agent_owners owner WHERE ('user_agent_' || owner.agent_id) = t.buyer_id)
          AND EXISTS (SELECT 1 FROM agent_owners owner WHERE ('user_agent_' || owner.agent_id) = t.seller_id)
          AND NOT EXISTS (SELECT 1 FROM agent_owners seller_owner JOIN agent_owners buyer_owner ON buyer_owner.user_id = seller_owner.user_id
            WHERE ('user_agent_' || seller_owner.agent_id) = t.seller_id AND ('user_agent_' || buyer_owner.agent_id) = t.buyer_id)
          THEN 1 ELSE 0 END AS automation_eligible
      FROM route_plans r LEFT JOIN service_orders o ON o.id = r.service_order_id LEFT JOIN trades t ON t.id = o.trade_id
      LEFT JOIN route_origins origin ON origin.route_id = r.id LEFT JOIN route_receipts receipt ON receipt.route_id = r.id
      LEFT JOIN trade_deliveries d ON d.trade_id = t.id LEFT JOIN service_execution_attempts provider ON provider.order_id = o.id
      LEFT JOIN route_agent_decisions decision ON decision.trade_id = t.id
      LEFT JOIN ${allSteps} step ON step.trade_id = t.id LEFT JOIN payment_receipts funding ON funding.trade_id = t.id
      LEFT JOIN settlement_transfers payout ON payout.trade_id = t.id AND payout.kind = 'seller_payout'
      LEFT JOIN evm_payment_intents evm ON evm.trade_id = t.id LEFT JOIN buyer_evm_payment_claims evmClaim ON evmClaim.intent_id = evm.id
      LEFT JOIN buyer_mpp_payment_intents tempo ON tempo.trade_id = t.id LEFT JOIN buyer_mpp_payment_claims tempoClaim ON tempoClaim.intent_id = tempo.id
      WHERE t.id IS NULL OR ${publicTradeWhereSql('t')}
    ) SELECT COUNT(*) AS plans,
      SUM(CASE WHEN json_valid(candidates_json) THEN CASE WHEN json_array_length(candidates_json) > 0 THEN 1 ELSE 0 END ELSE 0 END) AS viable_plans,
      SUM(CASE WHEN service_order_id IS NOT NULL THEN 1 ELSE 0 END) AS executions,
      SUM(CASE WHEN state = 'cancelled' THEN 1 ELSE 0 END) AS cancelled, SUM(CASE WHEN state = 'failed' THEN 1 ELSE 0 END) AS failed,
      SUM(accepted_settled) AS accepted_settled_routes, SUM(CASE WHEN accepted_settled = 1 THEN price_minor ELSE 0 END) AS assisted_gmv_minor,
      SUM(CASE WHEN backed_receipt = 1 AND automation_eligible = 1 AND accepted_settled = 1 THEN 1 ELSE 0 END) AS autonomous_routes,
      SUM(CASE WHEN backed_receipt = 1 AND automation_eligible = 1 AND accepted_settled = 1 THEN price_minor ELSE 0 END) AS autonomous_gmv_minor,
      SUM(funded) AS funded, SUM(dispatch_queued) AS dispatch_queued, SUM(provider_acknowledged) AS provider_acknowledged,
      SUM(delivered) AS delivered, SUM(buyer_accepted) AS buyer_accepted, SUM(payout_confirmed) AS payout_confirmed, SUM(backed_receipt) AS backed_receipts,
      SUM(CASE WHEN backed_receipt = 1 AND EXISTS (SELECT 1 FROM route_retry_funding_steps retry WHERE retry.route_id = route_evidence.id AND retry.order_id = service_order_id) THEN 1 ELSE 0 END) AS completed_retries,
      COUNT(CASE WHEN backed_receipt = 1 AND completed_at >= planned_at THEN 1 END) AS latency_samples,
      AVG(CASE WHEN backed_receipt = 1 AND completed_at >= planned_at THEN completed_at - planned_at END) AS mean_plan_to_settlement,
      MAX(CASE WHEN backed_receipt = 1 AND completed_at >= planned_at THEN completed_at - planned_at END) AS max_plan_to_settlement,
      COUNT(CASE WHEN backed_receipt = 1 AND delivered_at >= funded_at THEN 1 END) AS delivery_latency_samples,
      AVG(CASE WHEN backed_receipt = 1 AND delivered_at >= funded_at THEN delivered_at - funded_at END) AS mean_funding_to_delivery
      FROM route_evidence`, args: [REFERENCE_FLEET_MARKER, REFERENCE_FLEET_MARKER] }),
    db.$client.execute(`SELECT COALESCE(origin.channel, 'legacy_unknown') AS channel, COALESCE(origin.cohort, 'legacy_unknown') AS cohort,
      COUNT(*) AS plans, SUM(CASE WHEN r.service_order_id IS NOT NULL THEN 1 ELSE 0 END) AS executions
      FROM route_plans r LEFT JOIN route_origins origin ON origin.route_id = r.id
      LEFT JOIN service_orders o ON o.id = r.service_order_id LEFT JOIN trades t ON t.id = o.trade_id
      WHERE t.id IS NULL OR ${publicTradeWhereSql('t')} GROUP BY channel, cohort`),
    db.$client.execute(`SELECT COUNT(*) AS services, SUM(max_concurrency) AS slots, SUM(active_orders) AS occupied FROM service_definitions
      WHERE status = 'active' AND visibility = 'public' AND (seller_id NOT GLOB 'user_agent_*' OR EXISTS
      (SELECT 1 FROM agents a WHERE ('user_agent_' || a.id) = service_definitions.seller_id AND a.visibility = 'public' AND a.status = 'active' AND a.archived_at IS NULL))`),
    db.$client.execute(`SELECT v.method, v.status, COUNT(*) AS count FROM verification_results v
      JOIN trade_deliveries d ON d.id = v.delivery_id AND d.trade_id = v.trade_id AND d.content_hash = v.content_hash
      JOIN service_orders o ON o.trade_id = v.trade_id JOIN route_attempts a ON a.service_order_id = o.id
      JOIN trades t ON t.id = o.trade_id WHERE ${publicTradeWhereSql('t')} GROUP BY v.method, v.status`),
    db.$client.execute(`SELECT t.status, t.payout_status, t.resolution, t.resolution_seller_percent, t.completed_at,
      t.total_cost, t.seller_amount, t.payment_rail, o.state AS order_state, o.capacity_released_at,
      EXISTS(SELECT 1 FROM route_retry_funding_steps retry WHERE retry.id = step.id) AS is_retry,
      p.tx_hash AS funding_hash, p.token_amount AS funding_amount, p.token_decimals, p.token_usd_price,
      p.chain_id, p.token_address, p.payer_address, p.payment_rail AS funding_rail, p.usd_value_at_payment,
      refund.status AS refund_status, refund.tx_hash AS refund_hash, refund.confirmed_at,
      refund.token_amount AS refund_amount, refund.usd_amount AS refund_usd,
      refund.chain_id AS refund_chain, refund.token_address AS refund_token, refund.to_address AS refund_destination,
      refund.from_address AS refund_source, refund.business_key = (t.id || ':buyer_refund') AS refund_key_matches,
      CASE WHEN json_valid(m.terms_json) THEN json_extract(m.terms_json, '$.payment.treasury_address') END AS treasury,
      EXISTS(SELECT 1 FROM settlement_transfers payout WHERE payout.trade_id = t.id AND payout.kind = 'seller_payout') AS payout_exists
      FROM ${allSteps} step JOIN trades t ON t.id = step.trade_id JOIN service_orders o ON o.id = step.order_id
      JOIN route_payment_mandates m ON m.id = step.mandate_id
      LEFT JOIN payment_receipts p ON p.trade_id = t.id
      LEFT JOIN settlement_transfers refund ON refund.trade_id = t.id AND refund.kind = 'buyer_refund'
      WHERE ${publicTradeWhereSql('t')}`),
  ])
  const row = totals.rows[0] || {}, plans = count(row.plans), executions = count(row.executions), accepted = count(row.accepted_settled_routes)
  const verification: Record<string, Record<string, number>> = {}
  for (const check of checks.rows) {
    // Database corruption cannot inject arbitrary labels or private values into public diagnostics.
    if (!['buyer_review', 'schema', 'source_urls', 'assertions', 'source_evidence', 'isolated_checks', 'artifact_integrity'].includes(String(check.method))
      || !['pending', 'passed', 'failed', 'disputed', 'skipped'].includes(String(check.status))) continue
    verification[String(check.method)] ||= {}
    verification[String(check.method)][String(check.status)] = count(check.count)
  }
  const validChannels = new Set(['authenticated_agent', 'account', 'mpp_wallet', 'legacy_unknown'])
  const validCohorts = new Set(['production', 'canary', 'demo', 'reference', 'nonproduction', 'legacy_unknown'])
  const originBuckets = new Map<string, { channel: string; cohort: string; plans: number; executions: number }>()
  for (const entry of origins.rows) {
    const channel = validChannels.has(String(entry.channel)) ? String(entry.channel) : 'legacy_unknown'
    const cohort = validCohorts.has(String(entry.cohort)) ? String(entry.cohort) : 'legacy_unknown'
    const key = `${channel}:${cohort}`, bucket = originBuckets.get(key) || { channel, cohort, plans: 0, executions: 0 }
    bucket.plans += count(entry.plans); bucket.executions += count(entry.executions); originBuckets.set(key, bucket)
  }
  const originCounts = [...originBuckets.values()].sort((a, b) => `${a.channel}:${a.cohort}`.localeCompare(`${b.channel}:${b.cohort}`))
  const economicOutcomes = { attempts: outcomes.rows.length, disputed_attempts: 0, buyer_resolutions: 0, confirmed_refunds: 0, refunds_awaiting_confirmation: 0 }
  let retryCount = 0, disputedRetries = 0
  for (const attempt of outcomes.rows) {
    if (count(attempt.is_retry)) retryCount++
    if (attempt.status === 'disputed') { economicOutcomes.disputed_attempts++; if (count(attempt.is_retry)) disputedRetries++ }
    const cancelled = attempt.status === 'cancelled' && attempt.payout_status === 'refunded'
    const resolved = attempt.status === 'resolved' && attempt.resolution === 'buyer' && Number(attempt.resolution_seller_percent) === 0
      && attempt.payout_status === 'complete' && attempt.completed_at != null
    if (resolved) economicOutcomes.buyer_resolutions++
    let confirmed = false
    try {
      const expected = cancelled ? Number(attempt.total_cost) : Number(attempt.seller_amount)
      confirmed = (cancelled || resolved) && ['cancelled', 'resolved'].includes(String(attempt.order_state)) && attempt.capacity_released_at != null
        && ['evm', 'mpp'].includes(String(attempt.payment_rail)) && attempt.funding_rail === attempt.payment_rail
        && /^0x[a-f0-9]{64}$/i.test(String(attempt.funding_hash)) && Number(attempt.token_usd_price) === 1
        && attempt.token_decimals != null && attempt.funding_amount === parseUnits(Number(attempt.total_cost).toFixed(2), Number(attempt.token_decimals)).toString()
        && Math.round(Number(attempt.usd_value_at_payment) * 100) === Math.round(Number(attempt.total_cost) * 100)
        && !count(attempt.payout_exists) && attempt.refund_status === 'confirmed' && attempt.confirmed_at != null && !!count(attempt.refund_key_matches)
        && /^0x[a-f0-9]{64}$/i.test(String(attempt.refund_hash)) && attempt.refund_chain === attempt.chain_id
        && !!attempt.token_address && String(attempt.refund_token).toLowerCase() === String(attempt.token_address).toLowerCase()
        && !!attempt.payer_address && String(attempt.refund_destination).toLowerCase() === String(attempt.payer_address).toLowerCase()
        && !!attempt.treasury && String(attempt.refund_source).toLowerCase() === String(attempt.treasury).toLowerCase()
        && attempt.refund_amount === parseUnits(expected.toFixed(2), Number(attempt.token_decimals)).toString()
        && Math.round(Number(attempt.refund_usd) * 100) === Math.round(expected * 100)
    } catch { /* Malformed financial records never count as confirmed proof. */ }
    if (confirmed) economicOutcomes.confirmed_refunds++
    else if (attempt.refund_status != null || (attempt.funding_hash != null && ['cancelled', 'resolved'].includes(String(attempt.status)))) economicOutcomes.refunds_awaiting_confirmation++
  }
  const slots = count(capacity.rows[0]?.slots), occupied = count(capacity.rows[0]?.occupied)
  const seconds = (value: unknown) => value == null ? null : Number(Number(value).toFixed(3))
  return {
    contract_version: 2, currency: 'USD', plans, viable_plans: count(row.viable_plans), executions, cancelled: count(row.cancelled), failed: count(row.failed),
    accepted_settled_routes: accepted, planning_to_execution_rate: rate(executions, plans), execution_to_accepted_settlement_rate: rate(accepted, executions),
    assisted_routed_gmv: money(count(row.assisted_gmv_minor)), autonomously_routed_gmv: money(count(row.autonomous_gmv_minor)), autonomously_settled_routes: count(row.autonomous_routes),
    autonomy_status: 'evidence_gated' as const,
    funnel: { funded: count(row.funded), dispatch_queued: count(row.dispatch_queued), provider_acknowledged: count(row.provider_acknowledged), delivered: count(row.delivered),
      buyer_accepted: count(row.buyer_accepted), payout_confirmed: count(row.payout_confirmed), backed_receipts: count(row.backed_receipts) },
    latency_seconds: { sample_count: count(row.latency_samples), funding_to_delivery_sample_count: count(row.delivery_latency_samples), mean_plan_to_settlement: seconds(row.mean_plan_to_settlement),
      max_plan_to_settlement: seconds(row.max_plan_to_settlement), mean_funding_to_delivery: seconds(row.mean_funding_to_delivery) },
    provider_capacity: { active_services: count(capacity.rows[0]?.services), total_slots: slots, occupied_slots: occupied, available_slots: Math.max(0, slots - occupied), utilization_rate: rate(occupied, slots) },
    verification: { observations_by_method: verification, semantic_verified: false, provenance_verified: false, benchmark_verified: false },
    retry: { reserved_attempts: retryCount, completed_attempts: count(row.completed_retries), disputed_attempts: disputedRetries },
    economic_outcomes: economicOutcomes, origins: originCounts,
    definitions: {
      assisted_routed_gmv: 'Service prices excluding fees for completed routes with existing buyer-accepted capability evidence; this historical measure is separate from the stricter automation measure.',
      autonomously_routed_gmv: 'Service prices excluding fees for production-origin authenticated agent objectives with durable wallet claims, a first agent decision, delivered leased provider work, a matching backed receipt and confirmed settlement. Requires linked owners without known shared ownership; known canary/demo/reference/nonproduction and historical unknown origins are excluded. Ownership links do not prove independent identities or semantic quality.',
      funnel: 'Current route outcome counts. Dispatch queued means durable queued work, not provider acknowledgment. Verification observations cover current-delivery records across all economic attempts; they do not measure semantic quality.',
      economic_outcomes: 'All mandate-linked economic attempts, including previous providers. Confirmed refunds require exact original funding and terminal full-buyer refund proof; buyer resolutions return principal and may retain platform fees. Status flags alone do not prove refunds.',
      provider_capacity: 'Current declared capacity for all active services, including controlled services. No independent utilization claim.',
      latency_seconds: 'Observed plan-to-settlement and funding-to-delivery for matching backed external receipts; null when no sample exists.',
    }, updated_at: new Date().toISOString(),
  }
}
