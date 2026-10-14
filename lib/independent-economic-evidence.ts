import { db } from './db'
import { acceptedBackedTradeSql } from './reputation-evidence-sql'
import { runtimeReferenceExclusionSql } from './marketplace-cohort-policy'
import { loadMarketplaceCohorts } from './marketplace-cohorts'
import { publicTradeWhereSql } from './public-trade-visibility'

/** Different accounts/owner links are insufficient. Both parties need current
 * reviewed attribution to distinct owner groups; expires/retractions fail shut. */
export function independentPartiesSql(trade: 't') {
  return `(${runtimeReferenceExclusionSql(`${trade}.buyer_id`, `${trade}.seller_id`)} AND EXISTS (SELECT 1 FROM marketplace_cohort_attributions buyer_cohort
    JOIN marketplace_cohort_attributions seller_cohort ON seller_cohort.principal_id=${trade}.seller_id
    WHERE buyer_cohort.principal_id=${trade}.buyer_id
      AND buyer_cohort.cohort='independence_verified' AND seller_cohort.cohort='independence_verified'
      AND buyer_cohort.owner_group <> seller_cohort.owner_group
      AND (buyer_cohort.principal_id NOT GLOB 'user_agent_*' OR EXISTS (SELECT 1 FROM agent_owners owning
        WHERE ('user_agent_' || owning.agent_id)=buyer_cohort.principal_id AND owning.updated_at < unixepoch(buyer_cohort.recorded_at)))
      AND (seller_cohort.principal_id NOT GLOB 'user_agent_*' OR EXISTS (SELECT 1 FROM agent_owners owning
        WHERE ('user_agent_' || owning.agent_id)=seller_cohort.principal_id AND owning.updated_at < unixepoch(seller_cohort.recorded_at)))
      AND datetime(buyer_cohort.expires_at)>datetime('now') AND datetime(seller_cohort.expires_at)>datetime('now')
      AND buyer_cohort.id=(SELECT id FROM marketplace_cohort_attributions WHERE principal_id=${trade}.buyer_id ORDER BY recorded_at DESC,id DESC LIMIT 1)
      AND seller_cohort.id=(SELECT id FROM marketplace_cohort_attributions WHERE principal_id=${trade}.seller_id ORDER BY recorded_at DESC,id DESC LIMIT 1)))`
}

export async function getIndependentEconomicEvidence() {
  const [result, recorded] = await Promise.all([
    db.$client.execute(`SELECT COUNT(*) AS trades, COALESCE(SUM(t.amount),0) AS volume
      FROM trades t WHERE t.payment_rail IN ('credit','mpp','evm') AND ${acceptedBackedTradeSql('t')} AND ${independentPartiesSql('t')}`),
    db.$client.execute(`SELECT t.buyer_id,t.seller_id,t.amount,CASE WHEN ${independentPartiesSql('t')} THEN 1 ELSE 0 END AS reviewed_parties
      FROM trades t WHERE t.status IN ('completed','complete') AND ${publicTradeWhereSql('t')}`),
  ])
  const parties = [...new Set(recorded.rows.flatMap(row => [String(row.buyer_id), String(row.seller_id)]))]
  const cohorts = await loadMarketplaceCohorts(parties)
  const breakdown = { platform_controlled: 0, ownership_unverified: 0, independently_reviewed_parties: 0 }
  for (const row of recorded.rows) {
    const controlled = [String(row.buyer_id), String(row.seller_id)].some(id => cohorts.get(id)?.cohort.startsWith('platform_'))
    const key = controlled ? 'platform_controlled' : row.reviewed_parties ? 'independently_reviewed_parties' : 'ownership_unverified'
    breakdown[key] += Number(row.amount || 0)
  }
  for (const key of Object.keys(breakdown) as (keyof typeof breakdown)[]) breakdown[key] = Number(breakdown[key].toFixed(2))
  return { completed_trades: Number(result.rows[0]?.trades || 0), volume_usd: Number(Number(result.rows[0]?.volume || 0).toFixed(2)), recorded_volume_by_ownership: breakdown }
}
