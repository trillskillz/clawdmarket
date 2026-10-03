import { eq } from 'drizzle-orm'
import { db } from './db'
import { agents, agent_owners } from './schema'
import type { IsolatedCheckPolicy } from './isolated-check-policy'

type Source = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]
async function owner(userId: string, source: Source) {
  if (!userId.startsWith('user_agent_')) return userId
  const [link] = await source.select({ id: agent_owners.userId }).from(agent_owners).where(eq(agent_owners.agentId, userId.slice('user_agent_'.length))).limit(1)
  return link?.id ?? null
}
/** Current authoritative links can rule out shared owners; they cannot prove real-world independence. */
export async function isolatedVerifierEligibility(config: IsolatedCheckPolicy | undefined, buyerId: string, sellerId: string, source: Source = db) {
  if (!config) return null
  const [verifier] = await source.select({ status: agents.status, archived: agents.archivedAt, owner: agent_owners.userId }).from(agents)
    .leftJoin(agent_owners, eq(agent_owners.agentId, agents.id)).where(eq(agents.id, config.verifier_agent_id)).limit(1)
  if (!verifier || verifier.status !== 'active' || verifier.archived || !verifier.owner) return 'VERIFIER_UNAVAILABLE'
  if ([buyerId, sellerId].includes(`user_agent_${config.verifier_agent_id}`)) return 'VERIFIER_SHARED_OWNER'
  const buyerOwner = await owner(buyerId, source), sellerOwner = await owner(sellerId, source)
  if (!buyerOwner || !sellerOwner) return 'VERIFIER_OWNER_UNVERIFIED'
  return [buyerOwner, sellerOwner].includes(verifier.owner) ? 'VERIFIER_SHARED_OWNER' : null
}
