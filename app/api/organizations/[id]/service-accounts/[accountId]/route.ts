import { NextRequest, NextResponse } from 'next/server'
import { enterpriseMutationAccount, enterpriseFailure } from '@/lib/enterprise-api'
import { revokeOrganizationServiceAccount, serviceAccountDto } from '@/lib/organization-service-accounts'
import { internalErrorResponse } from '@/lib/api-error'

export const dynamic = 'force-dynamic'

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string, accountId: string }> }) {
  try {
    const { account, error } = await enterpriseMutationAccount(request)
    if (error || !account) return error
    const { id, accountId } = await params
    const result = await revokeOrganizationServiceAccount(id, account.userId, accountId)
    if (result.kind === 'not_found') return enterpriseFailure('SERVICE_ACCOUNT_NOT_FOUND', 'Service account not found', 404)
    if (result.kind === 'conflict') return enterpriseFailure('SERVICE_ACCOUNT_CONFLICT', 'Service account state changed', 409)
    return NextResponse.json({ service_account: serviceAccountDto(result.row), idempotent: result.idempotent },
      { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) { return internalErrorResponse('Organization service account revocation failed', error) }
}
