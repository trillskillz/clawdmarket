import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { organizations, organization_teams, organization_agent_assignments, organization_audit_events } from '@/lib/schema'
import { resolveAuthenticatedOwnerAccount } from '@/lib/agent-owner-auth'
import { validateCsrf } from '@/lib/csrf'
import { enterpriseFoundationEnabled, teamDto } from '@/lib/enterprise-foundation'
import { internalErrorResponse } from '@/lib/api-error'

export const dynamic = 'force-dynamic'

function failure(error_code: string, message: string, status: number) {
  return NextResponse.json({ success: false, error_code, message, retryable: false, state: 'no_funds_moved' },
    { status, headers: { 'Cache-Control': 'private, no-store' } })
}

/** The only lifecycle transition is active → archived, after all assignments are removed. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string, teamId: string }> }) {
  try {
    const owner = await resolveAuthenticatedOwnerAccount(request)
    if (!owner) return failure('OWNER_ACCOUNT_REQUIRED', 'Owner account required', 401)
    if (owner.usesCookieAuth && !validateCsrf(request)) return failure('CSRF_REJECTED', 'CSRF validation failed', 403)
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || body.status !== 'archived')
      return failure('INVALID_TEAM_TRANSITION', 'Only status archived is supported', 400)
    const { id, teamId } = await params
    const [organization] = await db.select({ id: organizations.id }).from(organizations).where(and(
      eq(organizations.id, id), eq(organizations.owner_account_id, owner.userId))).limit(1)
    if (!organization) return failure('ORGANIZATION_NOT_FOUND', 'Organization not found', 404)
    const find = async () => (await db.select().from(organization_teams).where(and(
      eq(organization_teams.id, teamId), eq(organization_teams.organization_id, id))).limit(1))[0]
    const existing = await find()
    if (!existing) return failure('TEAM_NOT_FOUND', 'Team not found', 404)
    if (existing.status === 'archived') return NextResponse.json({ team: teamDto(existing), idempotent: true }, { headers: { 'Cache-Control': 'private, no-store' } })
    if (!enterpriseFoundationEnabled()) return failure('ENTERPRISE_FOUNDATION_DISABLED', 'Organization team writes are disabled', 503)
    const result = await db.transaction(async (tx) => {
      const [assigned] = await tx.select({ agent_id: organization_agent_assignments.agent_id }).from(organization_agent_assignments)
        .where(eq(organization_agent_assignments.team_id, teamId)).limit(1)
      if (assigned) return null
      const now = new Date()
      const [updated] = await tx.update(organization_teams).set({ status: 'archived', updated_at: now }).where(and(
        eq(organization_teams.id, teamId), eq(organization_teams.organization_id, id), eq(organization_teams.status, 'active'))).returning()
      if (updated) await tx.insert(organization_audit_events).values({ id: crypto.randomUUID(), organization_id: id,
        actor_account_id: owner.userId, action: 'team_archived', team_id: teamId, created_at: now })
      return updated
    })
    if (!result) {
      const latest = await find()
      if (latest?.status === 'archived') return NextResponse.json({ team: teamDto(latest), idempotent: true }, { headers: { 'Cache-Control': 'private, no-store' } })
      return failure('TEAM_HAS_ASSIGNMENTS', 'Remove team assignments before archiving', 409)
    }
    return NextResponse.json({ team: teamDto(result), idempotent: false }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) { return internalErrorResponse('Organization team archive failed', error) }
}
