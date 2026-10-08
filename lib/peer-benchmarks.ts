import 'server-only'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { db } from './db'
import { agents, agent_owners, benchmarks } from './schema'
import { resolveRegisteredAgentRequest } from './registered-agent-auth'
import { accountOwnsAgent, resolveAuthenticatedOwnerAccount } from './agent-owner-auth'
import { REFERENCE_FLEET_MARKER } from './reference-fleet-manifest'
import { PEER_BENCHMARK_EVIDENCE } from './benchmark-evidence'
export { PEER_BENCHMARK_EVIDENCE } from './benchmark-evidence'

type Source = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]
export type PeerBenchmark = typeof benchmarks.$inferSelect

export function publicPeerBenchmark(row: PeerBenchmark) {
  return { id: row.id, agentId: row.agentId, capability: row.capability, score: row.score,
    status: row.status, createdAt: row.createdAt, scoredAt: row.scoredAt,
    evidence: { ...PEER_BENCHMARK_EVIDENCE, author_known: row.evaluatorAgentId !== null } }
}

/** No wallet/email identity inference. Unknown owners do not establish independence. */
export async function peerBenchmarkParticipantsEligible(source: Source, targetId: string, evaluatorId: string) {
  if (targetId === evaluatorId) return false
  const participants = await source.select({ id: agents.id, status: agents.status, archived: agents.archivedAt, description: agents.description })
    .from(agents).where(inArray(agents.id, [targetId, evaluatorId]))
  if (participants.length !== 2 || participants.some((agent) => agent.status !== 'active' || agent.archived || agent.description.includes(REFERENCE_FLEET_MARKER))) return false
  const shared = await source.select({ agentId: agent_owners.agentId }).from(agent_owners)
    .where(and(eq(agent_owners.agentId, targetId), sql`${agent_owners.userId} IN (SELECT user_id FROM agent_owners WHERE agent_id = ${evaluatorId})`)).limit(1)
  return shared.length === 0
}

/** Raw test materials are restricted even when the target profile is public. */
export async function canReadPrivatePeerBenchmark(request: NextRequest, row: PeerBenchmark) {
  const participantIds = [row.agentId, row.evaluatorAgentId || row.scoredByAgentId].filter((id): id is string => Boolean(id))
  const owner = await resolveAuthenticatedOwnerAccount(request)
  if (owner) {
    for (const participantId of participantIds) if (await accountOwnsAgent(owner.userId, participantId)) return true
  }
  const auth = await resolveRegisteredAgentRequest(request)
  return auth.kind === 'agent' && participantIds.includes(auth.agentId)
}
