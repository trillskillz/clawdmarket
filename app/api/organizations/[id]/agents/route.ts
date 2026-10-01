import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { agent_owners, organizations, organization_teams, organization_agent_assignments, organization_audit_events } from '@/lib/schema'
import { resolveAuthenticatedOwnerAccount } from '@/lib/agent-owner-auth'
import { validateCsrf } from '@/lib/csrf'
import { assignmentInput, enterpriseFoundationEnabled } from '@/lib/enterprise-foundation'
import { internalErrorResponse } from '@/lib/api-error'
import { rateLimit } from '@/lib/rate-limit'
import { retryEnterpriseBusy } from '@/lib/enterprise-api'

export const dynamic = 'force-dynamic'

function failure(error_code: string, message: string, status: number) {
  return NextResponse.json({ success: false, error_code, message, retryable: false, state: 'no_funds_moved' },
    { status, headers: { 'Cache-Control': 'private, no-store' } })
}

async function mutate(request: NextRequest, id: string, operation: 'assign' | 'unassign') {
  try {
    const owner = await resolveAuthenticatedOwnerAccount(request)
    if (!owner) return failure('OWNER_ACCOUNT_REQUIRED', 'Owner account required', 401)
    if (owner.usesCookieAuth && !validateCsrf(request)) return failure('CSRF_REJECTED', 'CSRF validation failed', 403)
    const parsed = (operation === 'assign' ? assignmentInput : assignmentInput.pick({ agent_id: true }))
      .safeParse(await request.json().catch(() => null))
    if (!parsed.success) return failure('INVALID_AGENT_ASSIGNMENT', 'Agent assignment request is invalid', 400)
    if (!enterpriseFoundationEnabled()) return failure('ENTERPRISE_FOUNDATION_DISABLED', 'Organization assignments are disabled', 503)
    const limit = await rateLimit(`organization-agents:${owner.userId}`, { interval: 60_000, maxRequests: 30, failClosed: true })
    if (!limit.success) return failure('ORGANIZATION_RATE_LIMIT', 'Organization assignment rate limit reached', 429)
    const agent_id = parsed.data.agent_id
    const cost_center = 'cost_center' in parsed.data ? parsed.data.cost_center as string : undefined
    const team_id = 'team_id' in parsed.data ? parsed.data.team_id as string | undefined : undefined
    const result = await retryEnterpriseBusy(() => db.transaction(async (tx) => {
      const [organization] = await tx.select({ id: organizations.id }).from(organizations).where(and(
        eq(organizations.id, id), eq(organizations.owner_account_id, owner.userId))).limit(1)
      if (!organization) return 'not_found' as const
      const [ownership] = await tx.select({ agentId: agent_owners.agentId }).from(agent_owners).where(and(
        eq(agent_owners.agentId, agent_id), eq(agent_owners.userId, owner.userId))).limit(1)
      if (!ownership) return 'agent_not_owned' as const
      const [current] = await tx.select().from(organization_agent_assignments)
        .where(eq(organization_agent_assignments.agent_id, agent_id)).limit(1)
      if (operation === 'assign') {
        if (!cost_center) return 'invalid' as const
        if (team_id) {
          const [team] = await tx.select({ id: organization_teams.id }).from(organization_teams).where(and(
            eq(organization_teams.id, team_id), eq(organization_teams.organization_id, id), eq(organization_teams.status, 'active'))).limit(1)
          if (!team) return 'team_not_found' as const
        }
        if (current?.organization_id === id && current.cost_center === cost_center && current.team_id === (team_id || null)) return 'idempotent' as const
        if (current) return 'conflict' as const
        const now = new Date()
        await tx.insert(organization_agent_assignments).values({ agent_id, organization_id: id,
          team_id: team_id || null, cost_center, assigned_at: now, updated_at: now })
        await tx.insert(organization_audit_events).values({ id: crypto.randomUUID(), organization_id: id,
          actor_account_id: owner.userId, action: 'agent_assigned', agent_id, team_id: team_id || null, cost_center, created_at: now })
        return 'changed' as const
      }
      if (!current) return 'idempotent' as const
      if (current.organization_id !== id) return 'not_found' as const
      await tx.delete(organization_agent_assignments).where(and(eq(organization_agent_assignments.agent_id, agent_id),
        eq(organization_agent_assignments.organization_id, id)))
      await tx.insert(organization_audit_events).values({ id: crypto.randomUUID(), organization_id: id,
        actor_account_id: owner.userId, action: 'agent_unassigned', agent_id, team_id: current.team_id,
        cost_center: current.cost_center, created_at: new Date() })
      return 'changed' as const
    }))
    if (result === 'not_found') return failure('ORGANIZATION_NOT_FOUND', 'Organization not found', 404)
    if (result === 'invalid') return failure('INVALID_AGENT_ASSIGNMENT', 'Cost center is required', 400)
    if (result === 'team_not_found') return failure('TEAM_NOT_FOUND', 'Active team not found in organization', 404)
    if (result === 'agent_not_owned') return failure('AGENT_NOT_OWNED', 'Agent is not linked to this account', 403)
    if (result === 'conflict') return failure('AGENT_ASSIGNMENT_CONFLICT', 'Agent already has an organization assignment', 409)
    return NextResponse.json({ agent_id, organization_id: id, assigned: operation === 'assign', idempotent: result === 'idempotent' },
      { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) { return internalErrorResponse('Organization assignment failed', error) }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return mutate(request, (await params).id, 'assign')
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return mutate(request, (await params).id, 'unassign')
}
