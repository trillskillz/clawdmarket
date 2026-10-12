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
        const message = error instanceof Error ? error.message : ''
        const diagnostic = message.match(/parser stack overflow|no such (?:column|table|function): [A-Za-z0-9_.]+|ambiguous column name: [A-Za-z0-9_.]+/)
        // Identifiers may be reported only if they occur in this fixed schema
        // query. Never print an arbitrary transport message or connection URL.
        const fixedErrors = [
          'circular reference', 'multiple recursive references', 'recursive reference in a subquery',
          'recursive aggregate queries not supported', 'aggregate functions are not allowed',
          'HAVING clause on a non-aggregate query', 'too many terms in compound SELECT',
          'Expression tree is too large', 'query is too complex', 'not authorized',
          'virtual tables cannot be used in recursive queries', 'out of memory',
        ]
        const category = fixedErrors.find(value => message.toLowerCase().includes(value.toLowerCase()))
        const knownWords = new Set((query.sql + ' SQLite error syntax near cannot be used allowed supported recursive reference references circular multiple aggregate functions queries HAVING clause on a non-aggregate query too many terms compound SELECT Expression tree is large maximum depth complex not authorized virtual tables out of memory exceeded limit parser stack overflow operation unsupported instruction bytecode failed prepare statement invalid misuse internal').toLowerCase().match(/[a-z_][a-z_0-9]*/g))
        // Only vocabulary from the fixed query or fixed compiler terms survives.
        // URLs, credentials, arbitrary identifiers and numbers are redacted.
        const safeMessage = message.slice(0, 1200).replace(/https?:\/\/\S+|libsql:\/\/\S+/gi, '[redacted]')
          .replace(/[A-Za-z_0-9]+/g, token => knownWords.has(token.toLowerCase()) ? token : '[redacted]')
          .replace(/\[redacted\](?:\s*\[redacted\])+/g, '[redacted]')
        const reason = diagnostic && (diagnostic[0] === 'parser stack overflow' || query.sql.includes(diagnostic[0].split(': ').at(-1)!))
          ? `; ${diagnostic[0]}` : category ? `; ${category}` : `; compiler=${safeMessage}`
        throw new Error(`Evidence query verification failed: ${query.name} (${code}${reason})`)
      }
      console.log(`Evidence query verified: ${query.name}`)
    }
  } finally { client.close() }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1 })
