import { NextRequest, NextResponse } from 'next/server'
import { isAddress } from 'viem'
import { eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { agents, payout_addresses } from '@/lib/schema'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import type { RequestPrincipal } from '@/lib/request-principal'
import { accountOwnsAgent } from '@/lib/agent-owner-auth'
import { listOwnedAgents } from '@/lib/agent-ownership'
import { ensureSyntheticAgentUser } from '@/lib/registered-agent-auth'
import { validateCsrf } from '@/lib/csrf'
import { payoutAddressForUser, recordPayoutAddress } from '@/lib/external-settlement'

export const dynamic = 'force-dynamic'

async function payoutSubject(principal: RequestPrincipal, agentId: unknown) {
  if (agentId == null) return { userId: principal.userId, agentId: null, name: null }
  if (typeof agentId !== 'string' || !agentId || agentId.length > 200) return null
  if (principal.agentId === agentId) return { userId: principal.userId, agentId, name: null }
  if (principal.kind !== 'account' || principal.agentId || !await accountOwnsAgent(principal.userId, agentId)) return null
  const [agent] = await db.select({ name: agents.name, archivedAt: agents.archivedAt })
    .from(agents).where(eq(agents.id, agentId)).limit(1)
  if (!agent || agent.archivedAt) return null
  return { userId: `user_agent_${agentId}`, agentId, name: agent.name }
}

export async function GET(request: NextRequest) {
  const principal = await resolveRequestPrincipal(request)
  if (!principal) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const requestedAgentId = request.nextUrl.searchParams.get('agent_id')
  const subject = await payoutSubject(principal, requestedAgentId)
  if (!subject) return NextResponse.json({ error: 'Not authorized to manage this agent payout' }, { status: 403 })
  const address = await payoutAddressForUser(subject.userId)
  if (requestedAgentId || principal.kind !== 'account' || principal.agentId) {
    return NextResponse.json({ address, ...(subject.agentId ? { agent_id: subject.agentId } : {}) }, { headers: { 'Cache-Control': 'private, no-store' } })
  }
  const owned = await listOwnedAgents(principal.userId)
  const sellerIds = owned.map((agent) => `user_agent_${agent.agent_id}`)
  const configured = sellerIds.length
    ? await db.select({ userId: payout_addresses.user_id, address: payout_addresses.address })
      .from(payout_addresses).where(inArray(payout_addresses.user_id, sellerIds))
    : []
  const byUserId = new Map(configured.map((row) => [row.userId, row.address]))
  const ownedAgents = owned.map((agent) => {
    const saved = byUserId.get(`user_agent_${agent.agent_id}`)
    return {
      agent_id: agent.agent_id,
      name: agent.name,
      status: agent.status,
      address: saved && isAddress(saved) ? saved : agent.owner_address && isAddress(String(agent.owner_address)) ? agent.owner_address : null,
    }
  })
  return NextResponse.json({ address, owned_agents: ownedAgents }, { headers: { 'Cache-Control': 'private, no-store' } })
}

export async function PUT(request: NextRequest) {
  const principal = await resolveRequestPrincipal(request)
  if (!principal) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (principal.usesCookieAuth && !validateCsrf(request)) return NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
  const body = await request.json().catch(() => null)
  const subject = await payoutSubject(principal, body?.agent_id)
  if (!subject) return NextResponse.json({ error: 'Not authorized to manage this agent payout' }, { status: 403 })
  const address = String(body?.address || '').trim()
  if (!isAddress(address)) return NextResponse.json({ error: 'A valid EVM payout address is required' }, { status: 400 })
  if (subject.agentId && subject.name) {
    await ensureSyntheticAgentUser({ agentId: subject.agentId, name: subject.name, syntheticUserId: subject.userId })
  }
  await recordPayoutAddress(subject.userId, address)
  return NextResponse.json({ ok: true, address: address.toLowerCase(), ...(subject.agentId ? { agent_id: subject.agentId } : {}) }, { headers: { 'Cache-Control': 'private, no-store' } })
}
