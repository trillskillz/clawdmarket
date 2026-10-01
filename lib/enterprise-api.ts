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

export async function retryEnterpriseBusy<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try { return await operation() }
    catch (error) {
      let current: unknown = error
      let busy = false
      for (let depth = 0; current && depth < 5; depth += 1) {
        if (typeof current === 'object' && 'message' in current && /SQLITE_BUSY|database is locked/i.test(String(current.message))) {
          busy = true; break
        }
        current = typeof current === 'object' && 'cause' in current ? current.cause : null
      }
      if (!busy || attempt === 4) throw error
      await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** attempt))
    }
  }
  throw new Error('enterprise_busy_retry_exhausted')
}
