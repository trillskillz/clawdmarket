import { NextRequest, NextResponse } from 'next/server'
import { eq, desc, and } from 'drizzle-orm'
import { db } from '@/lib/db'
import { organizations, organization_audit_events } from '@/lib/schema'
import { resolveAuthenticatedOwnerAccount } from '@/lib/agent-owner-auth'
import { validateCsrf } from '@/lib/csrf'
import { organizationDto, organizationInput, enterpriseFoundationEnabled } from '@/lib/enterprise-foundation'
import { internalErrorResponse } from '@/lib/api-error'
import { rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

function failure(error_code: string, message: string, status: number) {
  return NextResponse.json({ success: false, error_code, message, retryable: false, state: 'no_funds_moved' },
    { status, headers: { 'Cache-Control': 'private, no-store' } })
}

export async function GET(request: NextRequest) {
  try {
    const owner = await resolveAuthenticatedOwnerAccount(request)
    if (!owner) return failure('OWNER_ACCOUNT_REQUIRED', 'Owner account required', 401)
    const rows = await db.select().from(organizations).where(eq(organizations.owner_account_id, owner.userId))
      .orderBy(desc(organizations.created_at)).limit(100)
    return NextResponse.json({ organizations: rows.map(organizationDto) }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) { return internalErrorResponse('Organization lookup failed', error) }
}

export async function POST(request: NextRequest) {
  try {
    const owner = await resolveAuthenticatedOwnerAccount(request)
    if (!owner) return failure('OWNER_ACCOUNT_REQUIRED', 'Owner account required', 401)
    if (owner.usesCookieAuth && !validateCsrf(request)) return failure('CSRF_REJECTED', 'CSRF validation failed', 403)
    const parsed = organizationInput.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return failure('INVALID_ORGANIZATION', 'Organization request is invalid', 400)
    const { name, client_reference } = parsed.data
    const existing = async () => (await db.select().from(organizations).where(and(
      eq(organizations.owner_account_id, owner.userId), eq(organizations.client_reference, client_reference))).limit(1))[0]
    const replay = async () => {
      const row = await existing()
      if (!row) return null
      if (row.name !== name) return failure('IDEMPOTENCY_CONFLICT', 'Reference belongs to a different organization', 409)
      return NextResponse.json({ organization: organizationDto(row), idempotent: true }, { headers: { 'Cache-Control': 'private, no-store' } })
    }
    const prior = await replay()
    if (prior) return prior
    if (!enterpriseFoundationEnabled()) return failure('ENTERPRISE_FOUNDATION_DISABLED', 'Organization creation is disabled', 503)
    const limit = await rateLimit(`organization-create:${owner.userId}`, { interval: 86_400_000, maxRequests: 20, failClosed: true })
    if (!limit.success) return failure('ORGANIZATION_RATE_LIMIT', 'Organization creation rate limit reached', 429)
    try {
      const row = await db.transaction(async (tx) => {
        const now = new Date()
        const [created] = await tx.insert(organizations).values({ id: crypto.randomUUID(), owner_account_id: owner.userId,
          client_reference, name, created_at: now, updated_at: now }).returning()
        await tx.insert(organization_audit_events).values({ id: crypto.randomUUID(), organization_id: created.id,
          actor_account_id: owner.userId, action: 'created', created_at: now })
        return created
      })
      return NextResponse.json({ organization: organizationDto(row), idempotent: false }, { status: 201, headers: { 'Cache-Control': 'private, no-store' } })
    } catch (error) {
      const raced = await replay()
      if (raced) return raced
      throw error
    }
  } catch (error) { return internalErrorResponse('Organization creation failed', error) }
}
