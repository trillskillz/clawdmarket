import { NextRequest, NextResponse } from 'next/server'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { organizations, organization_invitations } from '@/lib/schema'
import { resolveAuthenticatedOwnerAccount } from '@/lib/agent-owner-auth'
import { enterpriseFoundationEnabled, invitationInput } from '@/lib/enterprise-foundation'
import { enterpriseFailure, enterpriseMutationAccount } from '@/lib/enterprise-api'
import { createOrganizationInvitation } from '@/lib/organization-membership'
import { rateLimit } from '@/lib/rate-limit'
import { internalErrorResponse } from '@/lib/api-error'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const account = await resolveAuthenticatedOwnerAccount(request)
    if (!account) return enterpriseFailure('OWNER_ACCOUNT_REQUIRED', 'Owner account required', 401)
    const id = (await params).id
    const [organization] = await db.select({ id: organizations.id }).from(organizations).where(and(
      eq(organizations.id, id), eq(organizations.owner_account_id, account.userId))).limit(1)
    if (!organization) return enterpriseFailure('ORGANIZATION_NOT_FOUND', 'Organization not found', 404)
    const rows = await db.select().from(organization_invitations).where(eq(organization_invitations.organization_id, id))
      .orderBy(desc(organization_invitations.created_at)).limit(100)
    return NextResponse.json({ invitations: rows.map((row) => ({ id: row.id, target_account_id: row.target_account_id,
      status: row.status, expires_at: row.expires_at.toISOString(), created_at: row.created_at.toISOString() })) },
      { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) { return internalErrorResponse('Organization invitation lookup failed', error) }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { account, error } = await enterpriseMutationAccount(request)
    if (!account) return error!
    const parsed = invitationInput.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return enterpriseFailure('INVALID_ORGANIZATION_INVITATION', 'Invitation request is invalid', 400)
    const id = (await params).id
    // Idempotent replay remains available when new writes are disabled.
    const [prior] = await db.select().from(organization_invitations).innerJoin(organizations,
      eq(organizations.id, organization_invitations.organization_id)).where(and(
      eq(organization_invitations.organization_id, id), eq(organization_invitations.client_reference, parsed.data.client_reference),
      eq(organizations.owner_account_id, account.userId))).limit(1)
    if (prior) {
      if (prior.organization_invitations.target_account_id !== parsed.data.target_account_id)
        return enterpriseFailure('IDEMPOTENCY_CONFLICT', 'Reference belongs to another invitation', 409)
      return NextResponse.json({ invitation_id: prior.organization_invitations.id, status: prior.organization_invitations.status,
        idempotent: true }, { headers: { 'Cache-Control': 'private, no-store' } })
    }
    if (!enterpriseFoundationEnabled()) return enterpriseFailure('ENTERPRISE_FOUNDATION_DISABLED', 'Organization invitations are disabled', 503)
    const limit = await rateLimit(`organization-invite:${account.userId}`, { interval: 86_400_000, maxRequests: 30, failClosed: true })
    if (!limit.success) return enterpriseFailure('ORGANIZATION_INVITATION_RATE_LIMIT', 'Invitation rate limit reached', 429)
    const result = await createOrganizationInvitation(id, account.userId, parsed.data.target_account_id, parsed.data.client_reference)
    if (result.kind === 'not_found') return enterpriseFailure('ORGANIZATION_NOT_FOUND', 'Organization not found', 404)
    if (result.kind === 'target_not_found') return enterpriseFailure('INVITATION_TARGET_NOT_FOUND', 'Target account not found', 404)
    if (result.kind === 'already_member') return enterpriseFailure('ORGANIZATION_ALREADY_MEMBER', 'Target is already a member', 409)
    if (result.kind === 'reference_conflict') return enterpriseFailure('IDEMPOTENCY_CONFLICT', 'Reference belongs to another invitation', 409)
    if (result.kind !== 'ok') return enterpriseFailure('INVITATION_UNAVAILABLE', 'Invitation is unavailable', 409)
    return NextResponse.json({ invitation_id: result.invitation_id, status: 'pending', idempotent: result.idempotent },
      { status: result.idempotent ? 200 : 201, headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) { return internalErrorResponse('Organization invitation creation failed', error) }
}
