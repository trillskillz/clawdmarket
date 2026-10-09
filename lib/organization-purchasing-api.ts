import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveAuthenticatedOwnerAccount } from './agent-owner-auth'
import { enterpriseMutationAccount, enterpriseFailure } from './enterprise-api'
import { readBoundedJson, ArtifactError } from './private-artifacts'
import { PurchasingError } from './organization-purchasing'
import { internalErrorResponse } from './api-error'
import { rateLimit } from './rate-limit'

export const purchasingHeaders = { 'Cache-Control': 'private, no-store', Vary: 'Authorization, Cookie', 'X-Content-Type-Options': 'nosniff' }
export const purchasingResult = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: purchasingHeaders })
export async function purchasingApi(request: NextRequest, mutation: boolean, run: (actor: string) => Promise<NextResponse>) {
  try {
    const result = mutation ? await enterpriseMutationAccount(request) : { account: await resolveAuthenticatedOwnerAccount(request), error: null }
    if (result.error) { Object.entries(purchasingHeaders).forEach(([key, value]) => result.error!.headers.set(key, value)); return result.error }
    if (!result.account) return purchasingResult({ error_code: 'ACCOUNT_REQUIRED' }, 401)
    if (mutation) {
      const limit = await rateLimit(`organization-purchasing:${result.account.userId}`, { interval: 86400_000, maxRequests: 100, failClosed: true })
      if (!limit.success) return purchasingResult({ error_code: 'PURCHASING_RATE_LIMIT' }, 429)
    }
    return await run(result.account.userId)
  } catch (error) {
    if (error instanceof PurchasingError || error instanceof ArtifactError) return purchasingResult({ success: false, error_code: error.code,
      retryable: error.status === 503, state: 'no_funds_moved' }, error.status)
    if (error instanceof z.ZodError) return purchasingResult({ success: false, error_code: 'INVALID_PURCHASING_REQUEST' }, 400)
    const response = internalErrorResponse('Organization purchasing request failed', error)
    Object.entries(purchasingHeaders).forEach(([key, value]) => response.headers.set(key, value)); return response
  }
}
export async function purchasingBody<T extends z.ZodType>(request: NextRequest, schema: T) {
  return schema.parse(await readBoundedJson(request, 16384))
}
// Keep older callers' enterprise failure semantics private too.
export { enterpriseFailure }
