import { and, eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { authenticateRequest } from '@/lib/auth'
import { db } from '@/lib/db'
import { agent_owners, agents, users } from '@/lib/schema'

export type AuthenticatedOwnerAccount = {
  userId: string
  email: string
  role: 'human' | 'agent'
  walletAddress: string | null
  usesCookieAuth: boolean
}

export function walletAddressFromAccountEmail(email: string) {
  const normalized = email.toLowerCase()
  const match = normalized.match(/^wallet_(0x[a-f0-9]{40})@wallet\.local$/)
  return match?.[1] || null
}

export async function resolveAuthenticatedOwnerAccount(
  request: NextRequest,
): Promise<AuthenticatedOwnerAccount | null> {
  const authorization = request.headers.get('authorization')
  const cookieToken = request.cookies.get('auth-token')?.value
  const headerAuth = authorization ? await authenticateRequest(authorization) : null
  const cookieAuth = !headerAuth && cookieToken
    ? await authenticateRequest(`Bearer ${cookieToken}`)
    : null
  const auth = headerAuth || cookieAuth
  if (!auth || auth.userId.startsWith('user_agent_')) return null

  const [user] = await db.select({
    id: users.id,
    email: users.email,
    role: users.role,
  }).from(users).where(eq(users.id, auth.userId)).limit(1)
  if (!user) return null
  return {
    userId: user.id,
    email: user.email.toLowerCase(),
    role: user.role,
    walletAddress: walletAddressFromAccountEmail(user.email),
    usesCookieAuth: Boolean(cookieAuth),
  }
}

export async function accountOwnsAgent(userId: string, agentId: string) {
  const [ownership] = await db.select({ agentId: agent_owners.agentId })
    .from(agent_owners)
    .where(and(eq(agent_owners.agentId, agentId), eq(agent_owners.userId, userId)))
    .limit(1)
  return Boolean(ownership)
}

export async function ownerLinkIdentityMatchesAgent(
  account: AuthenticatedOwnerAccount,
  agentId: string,
) {
  const [agent] = await db.select({
    ownerAddress: agents.owner_address,
    ownerEmail: agents.owner_email,
  }).from(agents).where(eq(agents.id, agentId)).limit(1)
  if (!agent) return { kind: 'not_found' as const }

  const declaredWallet = agent.ownerAddress.trim().toLowerCase()
  const declaredEmail = agent.ownerEmail?.trim().toLowerCase() || ''
  if (declaredWallet) {
    return account.walletAddress === declaredWallet
      ? { kind: 'match' as const }
      : { kind: 'mismatch' as const, required: 'wallet' as const }
  }
  if (declaredEmail) {
    return account.email === declaredEmail
      ? { kind: 'match' as const }
      : { kind: 'mismatch' as const, required: 'email' as const }
  }
  return { kind: 'match' as const }
}
