import { NextRequest, NextResponse } from 'next/server'
import { and, eq, desc } from 'drizzle-orm'
import { db } from '@/lib/db'
import { agent_owners, organizations, organization_agent_assignments, organization_audit_events } from '@/lib/schema'
import { resolveAuthenticatedOwnerAccount } from '@/lib/agent-owner-auth'
import { organizationDto } from '@/lib/enterprise-foundation'
import { internalErrorResponse } from '@/lib/api-error'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const owner = await resolveAuthenticatedOwnerAccount(request)
    if (!owner) return NextResponse.json({ success: false, error_code: 'OWNER_ACCOUNT_REQUIRED', message: 'Owner account required', retryable: false, state: 'no_funds_moved' }, { status: 401 })
    const [organization] = await db.select().from(organizations).where(and(
      eq(organizations.id, (await params).id), eq(organizations.owner_account_id, owner.userId))).limit(1)
    if (!organization) return NextResponse.json({ success: false, error_code: 'ORGANIZATION_NOT_FOUND', message: 'Organization not found', retryable: false, state: 'no_funds_moved' }, { status: 404 })
    const [assignments, audit] = await Promise.all([
      db.select({ agent_id: organization_agent_assignments.agent_id, cost_center: organization_agent_assignments.cost_center,
        assigned_at: organization_agent_assignments.assigned_at }).from(organization_agent_assignments)
        .innerJoin(agent_owners, and(eq(agent_owners.agentId, organization_agent_assignments.agent_id),
          eq(agent_owners.userId, owner.userId)))
        .where(eq(organization_agent_assignments.organization_id, organization.id)).limit(200),
      db.select({ id: organization_audit_events.id, action: organization_audit_events.action,
        agent_id: organization_audit_events.agent_id, cost_center: organization_audit_events.cost_center,
        created_at: organization_audit_events.created_at }).from(organization_audit_events)
        .where(eq(organization_audit_events.organization_id, organization.id)).orderBy(desc(organization_audit_events.created_at)).limit(100),
    ])
    return NextResponse.json({ organization: organizationDto(organization), assignments: assignments.map((row) => ({
      agent_id: row.agent_id, cost_center: row.cost_center, assigned_at: row.assigned_at.toISOString(),
    })), audit: audit.map((row) => ({ ...row, created_at: row.created_at.toISOString() })) },
    { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) { return internalErrorResponse('Organization inspection failed', error) }
}
