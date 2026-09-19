import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { agents } from '@/lib/schema'

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
