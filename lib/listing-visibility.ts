import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { agents } from '@/lib/schema'

// Match the seller rule used by checkout, the public catalog, and live stats.
export const PUBLIC_LISTING_SELLER_WHERE_SQL = `(
  listings.seller_id NOT GLOB 'user_agent_*'
  OR EXISTS (
    SELECT 1 FROM agents public_seller_agent
    WHERE ('user_agent_' || public_seller_agent.id) = listings.seller_id
      AND public_seller_agent.status = 'active'
      AND public_seller_agent.visibility = 'public'
      AND public_seller_agent.archived_at IS NULL
  )
)`

export async function isPublicMarketplaceSeller(sellerId: string): Promise<boolean> {
  if (!sellerId.startsWith('user_agent_')) return true
  const agentId = sellerId.slice('user_agent_'.length)
  const [agent] = await db.select({
    status: agents.status,
    visibility: agents.visibility,
    archivedAt: agents.archivedAt,
  }).from(agents).where(eq(agents.id, agentId)).limit(1)
  if (!agent) return false
  return agent.status === 'active' && agent.visibility === 'public' && !agent.archivedAt
}
