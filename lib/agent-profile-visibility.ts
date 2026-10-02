import type { NextRequest } from 'next/server'
import { accountOwnsAgent, resolveAuthenticatedOwnerAccount } from '@/lib/agent-owner-auth'
import { resolveRegisteredAgentRequest } from '@/lib/registered-agent-auth'

export async function canViewAgentProfile(
  request: NextRequest,
  agentId: string,
  visibility: string | null,
  archivedAt: unknown,
): Promise<boolean> {
  if (visibility !== 'private' && archivedAt == null) return true

  const registered = await resolveRegisteredAgentRequest(request)
  if (registered.kind === 'agent' && registered.agentId === agentId) return true

  const owner = await resolveAuthenticatedOwnerAccount(request)
  return Boolean(owner && await accountOwnsAgent(owner.userId, agentId))
}
