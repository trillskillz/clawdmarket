import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { organizations, organization_teams, organization_audit_events } from '@/lib/schema'
import { resolveAuthenticatedOwnerAccount } from '@/lib/agent-owner-auth'
import { validateCsrf } from '@/lib/csrf'
import { enterpriseFoundationEnabled, loadOrganizationAccess, teamDto, teamInput } from '@/lib/enterprise-foundation'
import { internalErrorResponse } from '@/lib/api-error'
import { rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

function failure(error_code: string, message: string, status: number) {
  return NextResponse.json({ success: false, error_code, message, retryable: false, state: 'no_funds_moved' },
    { status, headers: { 'Cache-Control': 'private, no-store' } })
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const owner = await resolveAuthenticatedOwnerAccount(request)
    if (!owner) return failure('OWNER_ACCOUNT_REQUIRED', 'Owner account required', 401)
    const access = await loadOrganizationAccess((await params).id, owner.userId)
    if (!access) return failure('ORGANIZATION_NOT_FOUND', 'Organization not found', 404)
    const organization = access.organization
    const teams = await db.select().from(organization_teams).where(eq(organization_teams.organization_id, organization.id)).limit(100)
    return NextResponse.json({ teams: teams.map(teamDto) }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) { return internalErrorResponse('Organization team lookup failed', error) }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const owner = await resolveAuthenticatedOwnerAccount(request)
    if (!owner) return failure('OWNER_ACCOUNT_REQUIRED', 'Owner account required', 401)
    if (owner.usesCookieAuth && !validateCsrf(request)) return failure('CSRF_REJECTED', 'CSRF validation failed', 403)
    const parsed = teamInput.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return failure('INVALID_ORGANIZATION_TEAM', 'Team request is invalid', 400)
    const id = (await params).id
    const [organization] = await db.select({ id: organizations.id }).from(organizations).where(and(
      eq(organizations.id, id), eq(organizations.owner_account_id, owner.userId))).limit(1)
    if (!organization) return failure('ORGANIZATION_NOT_FOUND', 'Organization not found', 404)
    const { slug, name } = parsed.data
    const replay = async () => {
      const [prior] = await db.select().from(organization_teams).where(and(eq(organization_teams.organization_id, id), eq(organization_teams.slug, slug))).limit(1)
      if (!prior) return null
      if (prior.name !== name) return failure('TEAM_SLUG_CONFLICT', 'Team slug belongs to a different name', 409)
      return NextResponse.json({ team: teamDto(prior), idempotent: true }, { headers: { 'Cache-Control': 'private, no-store' } })
    }
    const prior = await replay()
    if (prior) return prior
    if (!enterpriseFoundationEnabled()) return failure('ENTERPRISE_FOUNDATION_DISABLED', 'Organization team writes are disabled', 503)
    const limit = await rateLimit(`organization-team:${owner.userId}`, { interval: 86_400_000, maxRequests: 50, failClosed: true })
    if (!limit.success) return failure('ORGANIZATION_RATE_LIMIT', 'Organization team rate limit reached', 429)
    try {
      const row = await db.transaction(async (tx) => {
        const now = new Date()
        const [created] = await tx.insert(organization_teams).values({ id: crypto.randomUUID(), organization_id: id,
          slug, name, status: 'active', created_at: now, updated_at: now }).returning()
        await tx.insert(organization_audit_events).values({ id: crypto.randomUUID(), organization_id: id,
          actor_account_id: owner.userId, action: 'team_created', team_id: created.id, created_at: now })
        return created
      })
      return NextResponse.json({ team: teamDto(row), idempotent: false }, { status: 201, headers: { 'Cache-Control': 'private, no-store' } })
    } catch (error) {
      const raced = await replay()
      if (raced) return raced
      throw error
    }
  } catch (error) { return internalErrorResponse('Organization team creation failed', error) }
}
