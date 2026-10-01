import { NextRequest, NextResponse } from 'next/server'
import { enterpriseFoundationEnabled } from '@/lib/enterprise-foundation'
import { enterpriseFailure, enterpriseMutationAccount } from '@/lib/enterprise-api'
import { cancelOrganizationInvitation } from '@/lib/organization-membership'
import { internalErrorResponse } from '@/lib/api-error'

export const dynamic = 'force-dynamic'

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string, invitationId: string }> }) {
  try {
    const { account, error } = await enterpriseMutationAccount(request)
    if (!account) return error!
    if (!enterpriseFoundationEnabled()) return enterpriseFailure('ENTERPRISE_FOUNDATION_DISABLED', 'Invitation cancellation is disabled', 503)
    const { id, invitationId } = await params
    const result = await cancelOrganizationInvitation(id, account.userId, invitationId)
    if (result.kind === 'not_found') return enterpriseFailure('INVITATION_NOT_FOUND', 'Invitation not found', 404)
    if (result.kind !== 'ok') return enterpriseFailure('INVITATION_UNAVAILABLE', 'Invitation is unavailable', 409)
    return NextResponse.json({ invitation_id: invitationId, status: 'cancelled', idempotent: result.idempotent },
      { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) { return internalErrorResponse('Organization invitation cancellation failed', error) }
}
