import { isAddress } from 'viem'
import { db } from '@/lib/db'
import { loadAgentTrustMap } from '@/lib/agent-trust'
import { PUBLIC_LISTING_SELLER_WHERE_SQL } from '@/lib/listing-visibility'

// First-render catalog data for crawlers and non-JS visitors. Client filters
// continue to use /api/listings, which owns pagination and checkout eligibility.
export async function getPublicCatalogSnapshot(limit = 24) {
  const client = (db as any).$client
  const [page, count] = await Promise.all([
    client.execute({
      sql: `SELECT listings.id, listings.seller_id, listings.category, listings.title,
          listings.description, listings.price_bankr, listings.status, listings.created_at,
          u.name AS seller_name, u.role AS seller_role, u.email AS seller_email,
          a.id AS agent_id, a.capabilities AS agent_capabilities,
          COALESCE(a.created_at, u.created_at) AS agent_created_at,
          a.status AS seller_status, a.last_seen_at AS seller_last_seen_at,
          COALESCE((SELECT p.address FROM payout_addresses p WHERE p.user_id = listings.seller_id LIMIT 1),
            CASE WHEN u.email LIKE 'wallet_0x%@wallet.local' THEN SUBSTR(u.email, 8, 42) ELSE NULL END,
            a.owner_address) AS seller_payout_address,
          (SELECT COUNT(*) FROM ratings r WHERE r.rated_id = listings.seller_id) AS seller_rating_count,
          (SELECT AVG(r.score) FROM ratings r WHERE r.rated_id = listings.seller_id) AS seller_avg_rating,
          (SELECT COUNT(*) FROM trades t WHERE t.seller_id = listings.seller_id
            AND t.status IN ('completed', 'complete')) AS completed_trades
        FROM listings
        LEFT JOIN users u ON u.id = listings.seller_id
        LEFT JOIN agents a ON ('user_agent_' || a.id) = listings.seller_id
        WHERE listings.status = 'active' AND ${PUBLIC_LISTING_SELLER_WHERE_SQL}
        ORDER BY listings.created_at DESC LIMIT ?`,
      args: [limit],
    }),
    client.execute({
      sql: `SELECT COUNT(*) AS count FROM listings WHERE status = 'active' AND ${PUBLIC_LISTING_SELLER_WHERE_SQL}`,
      args: [],
    }),
  ])
  const rows = page.rows || []
  const trust = await loadAgentTrustMap(rows.map((row: any) => ({
    id: String(row.agent_id || row.seller_id),
    created_at: row.agent_created_at,
    avg_rating: row.seller_avg_rating,
    rating_count: row.seller_rating_count,
  })))
  return {
    total: Number(count.rows?.[0]?.count || 0),
    listings: rows.map((row: any) => {
      const score = trust.get(String(row.agent_id || row.seller_id))
      return {
        id: row.id,
        seller_id: row.seller_id,
        seller_name: row.seller_name,
        agent_id: row.agent_id || row.seller_id,
        agent_capabilities: row.agent_capabilities || '[]',
        seller_avg_rating: Number(row.seller_avg_rating || 0),
        seller_rating_count: Number(row.seller_rating_count || 0),
        completed_trades: Number(row.completed_trades || 0),
        category: row.category,
        title: row.title,
        description: row.description,
        price_bankr: Number(row.price_bankr || 0),
        price_usd: Number(row.price_bankr || 0),
        status: row.status,
        created_at: row.created_at,
        agent_trust: score?.trustScore ?? 0,
        agent_trust_confidence: score?.confidence ?? 'low',
        agent_trust_rating_count: score?.components.ratingCount ?? 0,
        agent_trust_completed_trades: score?.components.completedTrades ?? 0,
        external_payment_ready: Boolean(row.seller_payout_address && isAddress(String(row.seller_payout_address))),
      }
    }),
  }
}
