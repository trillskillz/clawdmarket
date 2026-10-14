import { sql } from 'drizzle-orm'
import { db } from './db'
import { publicTradeWhereSql } from './public-trade-visibility'
import { financialBackingSql } from './trade-evidence-sql'
import { fundedReputationTradeSql } from './reputation-evidence-sql'
import { independentPartiesSql } from './independent-economic-evidence'
import { loadMarketplaceCohorts } from './marketplace-cohorts'

/** Aggregate existing records for explicitly selected pilot services. No
 * private inputs, artifact content, credentials or party identifiers leave it. */
export async function inspectPilotFunnel(serviceIds: string[], kind: 'service' | 'task' = 'service') {
  if (!serviceIds.length || serviceIds.length > 10) throw new Error('Specify 1–10 actual pilot service or task IDs')
  const ids = sql.join(serviceIds.map(id => sql`${id}`), sql`, `)
  const selected = kind === 'service'
    ? sql`EXISTS(SELECT 1 FROM service_orders o WHERE o.trade_id=t.id AND o.service_id IN (${ids}))`
    : sql`EXISTS(SELECT 1 FROM task_workspaces w WHERE w.trade_id=t.id AND w.task_id IN (${ids}))`
  const rows = await db.all<{ buyer_id: string; seller_id: string; funded: number; delivered: number; accepted: number; settled: number; independent: number; fee: number }>(sql`
    SELECT t.buyer_id,t.seller_id,
      CASE WHEN ${sql.raw(fundedReputationTradeSql('t'))} THEN 1 ELSE 0 END AS funded,
      EXISTS(SELECT 1 FROM trade_deliveries d WHERE d.trade_id=t.id) AS delivered,
      EXISTS(SELECT 1 FROM verification_results v JOIN trade_deliveries d ON d.id=v.delivery_id AND d.content_hash=v.content_hash
        WHERE v.trade_id=t.id AND d.trade_id=t.id AND v.method='buyer_review' AND v.status='passed') AS accepted,
      CASE WHEN t.status IN ('completed','complete') AND ${sql.raw(financialBackingSql('t'))} THEN 1 ELSE 0 END AS settled,
      CASE WHEN ${sql.raw(independentPartiesSql('t'))} THEN 1 ELSE 0 END AS independent,
      COALESCE(t.platform_fee,t.fee,0) AS fee
    FROM trades t WHERE ${selected} AND ${sql.raw(publicTradeWhereSql('t'))}`)
  const cohorts = await loadMarketplaceCohorts([...new Set(rows.flatMap(row => [row.buyer_id, row.seller_id]))])
  const buckets = Object.fromEntries(['platform_controlled', 'ownership_unverified', 'independently_reviewed_parties'].map(cohort => [cohort, { checkout: 0, funded: 0, delivered: 0, buyer_accepted: 0, financially_settled: 0, recorded_platform_fees_usd: 0, repeat_purchasing_accounts: 0 }]))
  const repeat = new Map<string, { cohort: string; count: number }>()
  for (const row of rows) {
    const controlled = [row.buyer_id, row.seller_id].some(id => cohorts.get(id)?.cohort.startsWith('platform_'))
    const cohort = controlled ? 'platform_controlled' : row.independent ? 'independently_reviewed_parties' : 'ownership_unverified'
    const bucket = buckets[cohort]
    bucket.checkout++; bucket.funded += Number(row.funded); bucket.delivered += Number(row.delivered)
    bucket.buyer_accepted += Number(row.accepted); bucket.financially_settled += Number(row.settled)
    if (row.settled) {
      bucket.recorded_platform_fees_usd += Number(row.fee)
      const key = `${cohort}:${row.buyer_id}`
      repeat.set(key, { cohort, count: (repeat.get(key)?.count || 0) + 1 })
    }
  }
  for (const value of repeat.values()) if (value.count > 1) buckets[value.cohort].repeat_purchasing_accounts++
  for (const bucket of Object.values(buckets)) bucket.recorded_platform_fees_usd = Number(bucket.recorded_platform_fees_usd.toFixed(2))
  const discovery = await db.all<{ requests: number }>(sql`SELECT COUNT(*) AS requests FROM analytics_events e
    WHERE e.event_type=${kind === 'service' ? 'service_discovery' : 'task_discovery'} AND json_valid(e.metadata)
      AND json_extract(e.metadata,${kind === 'service' ? '$.service_id' : '$.task_id'}) IN (${ids})`)
  return { kind: 'read_only_pilot_funnel', observed_at: new Date().toISOString(), selection_kind: kind, selected_records: serviceIds.length,
    discovery: { reported_public_views: Number(discovery[0]?.requests || 0), source: 'client_reported; not unique people, authenticated ownership or purchasing evidence', coverage: 'Unmeasured; blocked or omitted client events are not evidence of zero discovery.' },
    cohorts: buckets, contribution_margin_usd: null, operator_intervention_minutes: null,
    measurement_limits: { economics: 'Checkout, funding, delivery, exact-delivery buyer acceptance and financial backing are distinct stored facts. Repeat purchasing counts accounts, not independent people.',
      costs: 'Contribution margin requires actual rail costs, provider/processing costs and the reviewed operator time ledger; absent costs remain unmeasured.',
      attribution: 'Controlled overrides independence. Unknown or expired ownership never qualifies as independently reviewed. Private organization work is excluded.' },
    execution_authority: false }
}
