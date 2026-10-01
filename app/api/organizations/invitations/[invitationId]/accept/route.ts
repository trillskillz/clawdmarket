import { NextRequest, NextResponse } from 'next/server'
import { enterpriseFoundationEnabled } from '@/lib/enterprise-foundation'
import { enterpriseFailure, enterpriseMutationAccount } from '@/lib/enterprise-api'
import { acceptOrganizationInvitation } from '@/lib/organization-membership'
import { internalErrorResponse } from '@/lib/api-error'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: Promise<{ invitationId: string }> }) {
  try {
    const { account, error } = await enterpriseMutationAccount(request)
    if (!account) return error!
    if (!enterpriseFoundationEnabled()) return enterpriseFailure('ENTERPRISE_FOUNDATION_DISABLED', 'Membership acceptance is disabled', 503)
    const result = await acceptOrganizationInvitation((await params).invitationId, account.userId)
    if (result.kind === 'not_found') return enterpriseFailure('INVITATION_NOT_FOUND', 'Invitation not found', 404)
    if (result.kind === 'expired') return enterpriseFailure('INVITATION_EXPIRED', 'Invitation has expired', 410)
    if (result.kind === 'already_member') return enterpriseFailure('ORGANIZATION_ALREADY_MEMBER', 'Account already belongs to the organization', 409)
    if (result.kind !== 'ok') return enterpriseFailure('INVITATION_UNAVAILABLE', 'Invitation is unavailable', 409)
    return NextResponse.json({ invitation_id: result.invitation_id, role: 'viewer', idempotent: result.idempotent,
      authority: 'read_only' }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) { return internalErrorResponse('Organization invitation acceptance failed', error) }
}
