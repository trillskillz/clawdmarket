import { NextRequest, NextResponse } from 'next/server'
import { enterpriseFoundationEnabled } from '@/lib/enterprise-foundation'
import { enterpriseFailure, enterpriseMutationAccount } from '@/lib/enterprise-api'
import { revokeOrganizationMembership } from '@/lib/organization-membership'
import { internalErrorResponse } from '@/lib/api-error'

export const dynamic = 'force-dynamic'

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string, accountId: string }> }) {
  try {
    const { account, error } = await enterpriseMutationAccount(request)
    if (!account) return error!
    if (!enterpriseFoundationEnabled()) return enterpriseFailure('ENTERPRISE_FOUNDATION_DISABLED', 'Membership revocation is disabled', 503)
    const { id, accountId } = await params
    const result = await revokeOrganizationMembership(id, account.userId, accountId)
    if (result.kind === 'not_found') return enterpriseFailure('MEMBERSHIP_NOT_FOUND', 'Membership not found', 404)
    if (result.kind !== 'ok') return enterpriseFailure('MEMBERSHIP_UNAVAILABLE', 'Membership is unavailable', 409)
    return NextResponse.json({ account_id: accountId, status: 'revoked', idempotent: result.idempotent },
      { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) { return internalErrorResponse('Organization membership revocation failed', error) }
}
