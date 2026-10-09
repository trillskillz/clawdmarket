import { createClient } from '@libsql/client'
import { backedCapabilityEventSql } from '../lib/capability-evidence-sql'
import { backedReputationTradeSql, LISTING_BACKED_BUYER_COUNT_SQL, listingFeedbackAggregateSql, rankedBuyerFeedbackSql } from '../lib/reputation-evidence-sql'

// Compile the actual query shapes through the configured database transport.
// EXPLAIN reads schema metadata only; it neither reads private evidence rows nor
// mutates data. This gate runs after additive migrations, before deployment.
const url = process.env.TURSO_DATABASE_URL?.trim()
if (!url) throw new Error('TURSO_DATABASE_URL is required for evidence query verification')
const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN })
const queries = [
  { name: 'buyer_feedback', sql: `WITH feedback AS (${rankedBuyerFeedbackSql('1 = 0')})
    SELECT rated_id, COUNT(*) FROM feedback WHERE feedback_rank = 1 GROUP BY rated_id` },
  { name: 'backed_reputation', sql: `WITH observations AS MATERIALIZED (
    SELECT t.seller_id, CASE WHEN ${backedReputationTradeSql('t')} THEN 1 ELSE 0 END AS backed FROM trades t
  ) SELECT seller_id, SUM(backed) FROM observations GROUP BY seller_id` },
  { name: 'marketplace_ranking', sql: `SELECT listings.id FROM listings ORDER BY
    ${LISTING_BACKED_BUYER_COUNT_SQL} DESC,
    COALESCE(${listingFeedbackAggregateSql('AVG(score)')}, 0) DESC,
    COALESCE(${listingFeedbackAggregateSql('COUNT(*)')}, 0) DESC LIMIT 1` },
  { name: 'capability_backing', sql: `SELECT e.seller_agent_id, COUNT(*) FROM capability_performance_events e
    JOIN trades t ON t.id = e.trade_id WHERE ${backedCapabilityEventSql('e', 't')} GROUP BY e.seller_agent_id` },
]

async function main() {
  try {
    for (const query of queries) {
      try { await client.execute(`EXPLAIN ${query.sql}`) }
      catch (error) {
        // Do not emit connection configuration, credentials or database rows.
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'QUERY_UNAVAILABLE'
        throw new Error(`Evidence query verification failed: ${query.name} (${code})`)
      }
      console.log(`Evidence query verified: ${query.name}`)
    }
  } finally { client.close() }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1 })
