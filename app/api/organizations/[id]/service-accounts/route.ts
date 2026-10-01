import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { organizations, organization_service_accounts } from '@/lib/schema'
import { resolveAuthenticatedOwnerAccount } from '@/lib/agent-owner-auth'
import { enterpriseMutationAccount, enterpriseFailure } from '@/lib/enterprise-api'
import { enterpriseFoundationEnabled } from '@/lib/enterprise-foundation'
import { createOrganizationServiceAccount, serviceAccountDto, serviceAccountInput } from '@/lib/organization-service-accounts'
import { internalErrorResponse } from '@/lib/api-error'
import { rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
const privateHeaders = { 'Cache-Control': 'private, no-store' }

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const owner = await resolveAuthenticatedOwnerAccount(request)
    if (!owner) return enterpriseFailure('OWNER_ACCOUNT_REQUIRED', 'Owner account required', 401)
    const id = (await params).id
    const [organization] = await db.select({ id: organizations.id }).from(organizations).where(and(
      eq(organizations.id, id), eq(organizations.owner_account_id, owner.userId))).limit(1)
    if (!organization) return enterpriseFailure('ORGANIZATION_NOT_FOUND', 'Organization not found', 404)
    const rows = await db.select().from(organization_service_accounts).where(eq(organization_service_accounts.organization_id, id)).limit(100)
    return NextResponse.json({ service_accounts: rows.map(serviceAccountDto) }, { headers: privateHeaders })
  } catch (error) { return internalErrorResponse('Organization service account lookup failed', error) }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { account, error } = await enterpriseMutationAccount(request)
    if (error || !account) return error
    const parsed = serviceAccountInput.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return enterpriseFailure('INVALID_SERVICE_ACCOUNT', 'Service account request is invalid', 400)
    const id = (await params).id
    // The domain operation checks ownership and idempotency inside its transaction.
    if (!enterpriseFoundationEnabled()) return enterpriseFailure('ENTERPRISE_FOUNDATION_DISABLED', 'Service account writes are disabled', 503)
    const limit = await rateLimit(`organization-service-account:${account.userId}`, { interval: 86_400_000, maxRequests: 50, failClosed: true })
    if (!limit.success) return enterpriseFailure('ORGANIZATION_RATE_LIMIT', 'Organization service account rate limit reached', 429)
    const result = await createOrganizationServiceAccount(id, account.userId, parsed.data)
    if (result.kind === 'not_found') return enterpriseFailure('ORGANIZATION_NOT_FOUND', 'Organization not found', 404)
    if (result.kind === 'reference_conflict') return enterpriseFailure('IDEMPOTENCY_CONFLICT', 'Reference belongs to a different service account', 409)
    return NextResponse.json({ service_account: serviceAccountDto(result.row), api_key: result.api_key, idempotent: result.idempotent },
      { status: result.idempotent ? 200 : 201, headers: privateHeaders })
  } catch (error) { return internalErrorResponse('Organization service account creation failed', error) }
}
