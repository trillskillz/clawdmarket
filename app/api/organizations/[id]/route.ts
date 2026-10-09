import { NextRequest, NextResponse } from 'next/server'
import { and, eq, desc } from 'drizzle-orm'
import { db } from '@/lib/db'
import { agent_owners, organization_agent_assignments, organization_audit_events, organizations } from '@/lib/schema'
import { resolveAuthenticatedOwnerAccount } from '@/lib/agent-owner-auth'
import { loadOrganizationAccess, organizationDto } from '@/lib/enterprise-foundation'
import { internalErrorResponse } from '@/lib/api-error'
import { resolveOrganizationServiceAccount } from '@/lib/organization-service-accounts'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const owner = await resolveAuthenticatedOwnerAccount(request)
    if (!owner) {
      const service = await resolveOrganizationServiceAccount(request)
      if (!service) return NextResponse.json({ success: false, error_code: 'OWNER_ACCOUNT_REQUIRED', message: 'Owner account required', retryable: false, state: 'no_funds_moved' }, { status: 401 })
      const id = (await params).id
      if (id !== service.organizationId) return NextResponse.json({ success: false, error_code: 'ORGANIZATION_NOT_FOUND', message: 'Organization not found', retryable: false, state: 'no_funds_moved' }, { status: 404 })
      const [organization] = await db.select().from(organizations).where(eq(organizations.id, id)).limit(1)
      if (!organization) return NextResponse.json({ success: false, error_code: 'ORGANIZATION_NOT_FOUND', message: 'Organization not found', retryable: false, state: 'no_funds_moved' }, { status: 404 })
      return NextResponse.json({ organization: organizationDto(organization), role: 'service_account' },
        { headers: { 'Cache-Control': 'private, no-store' } })
    }
    const access = await loadOrganizationAccess((await params).id, owner.userId)
    if (!access) return NextResponse.json({ success: false, error_code: 'ORGANIZATION_NOT_FOUND', message: 'Organization not found', retryable: false, state: 'no_funds_moved' }, { status: 404 })
    const { organization } = access
    if (access.role === 'viewer') return NextResponse.json({ organization: organizationDto(organization), role: 'viewer' },
      { headers: { 'Cache-Control': 'private, no-store' } })
    const [assignments, audit] = await Promise.all([
      db.select({ agent_id: organization_agent_assignments.agent_id, team_id: organization_agent_assignments.team_id,
        cost_center: organization_agent_assignments.cost_center,
        assigned_at: organization_agent_assignments.assigned_at }).from(organization_agent_assignments)
        .innerJoin(agent_owners, and(eq(agent_owners.agentId, organization_agent_assignments.agent_id),
          eq(agent_owners.userId, owner.userId)))
        .where(eq(organization_agent_assignments.organization_id, organization.id)).limit(200),
      db.select({ id: organization_audit_events.id, spending_account_id: organization_audit_events.spending_account_id, action: organization_audit_events.action,
        agent_id: organization_audit_events.agent_id, cost_center: organization_audit_events.cost_center,
        team_id: organization_audit_events.team_id,
        created_at: organization_audit_events.created_at }).from(organization_audit_events)
        .where(eq(organization_audit_events.organization_id, organization.id)).orderBy(desc(organization_audit_events.created_at)).limit(100),
    ])
    return NextResponse.json({ organization: organizationDto(organization), role: 'owner', assignments: assignments.map((row) => ({
      agent_id: row.agent_id, team_id: row.team_id, cost_center: row.cost_center, assigned_at: row.assigned_at.toISOString(),
    })), audit: audit.map((row) => ({ ...row, created_at: row.created_at.toISOString() })) },
    { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) { return internalErrorResponse('Organization inspection failed', error) }
}
