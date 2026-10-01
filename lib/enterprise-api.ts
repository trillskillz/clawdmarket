import { NextRequest, NextResponse } from 'next/server'
import { resolveAuthenticatedOwnerAccount } from '@/lib/agent-owner-auth'
import { validateCsrf } from '@/lib/csrf'

export function enterpriseFailure(error_code: string, message: string, status: number) {
  return NextResponse.json({ success: false, error_code, message, retryable: false, state: 'no_funds_moved' },
    { status, headers: { 'Cache-Control': 'private, no-store' } })
}

export async function enterpriseMutationAccount(request: NextRequest) {
  const account = await resolveAuthenticatedOwnerAccount(request)
  if (!account) return { account: null, error: enterpriseFailure('OWNER_ACCOUNT_REQUIRED', 'Account required', 401) }
  if (account.usesCookieAuth && !validateCsrf(request))
    return { account: null, error: enterpriseFailure('CSRF_REJECTED', 'CSRF validation failed', 403) }
  return { account, error: null }
}
