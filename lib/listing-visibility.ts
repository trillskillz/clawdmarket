import { and, eq, isNotNull, or } from 'drizzle-orm'
import { db } from '@/lib/db'
import { agents, service_orders, service_definitions } from '@/lib/schema'

// Match the seller rule used by checkout, the public catalog, and live stats.
export const PUBLIC_LISTING_SELLER_WHERE_SQL = `(NOT EXISTS (SELECT 1 FROM service_orders private_listing_order
  JOIN service_definitions private_listing_service ON private_listing_service.id = private_listing_order.service_id
  WHERE private_listing_order.listing_id = listings.id
    AND (private_listing_order.private_provider_share_id IS NOT NULL OR private_listing_service.visibility = 'organization')) AND (
  listings.seller_id NOT GLOB 'user_agent_*'
  OR EXISTS (
    SELECT 1 FROM agents public_seller_agent
    WHERE ('user_agent_' || public_seller_agent.id) = listings.seller_id
      AND public_seller_agent.status = 'active'
      AND public_seller_agent.visibility = 'public'
      AND public_seller_agent.archived_at IS NULL
  )
))`

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

export async function originalPrivateServiceListing(listingId: string, source: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0] = db) {
  const [row] = await source.select({ share: service_orders.private_provider_share_id, visibility: service_definitions.visibility }).from(service_orders)
    .innerJoin(service_definitions, eq(service_definitions.id, service_orders.service_id)).where(and(eq(service_orders.listing_id, listingId),or(isNotNull(service_orders.private_provider_share_id),eq(service_definitions.visibility,'organization')))).limit(1)
  return !!row && (row.share !== null || row.visibility === 'organization')
}
