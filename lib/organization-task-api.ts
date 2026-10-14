import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveRequestPrincipal } from './request-principal'
import { resolveRegisteredAgentRequest } from './registered-agent-auth'
import { validateCsrf } from './csrf'
import { purchasingHeaders, purchasingResult } from './organization-purchasing-api'
import { PurchasingError } from './organization-purchasing-transaction'
import { ArtifactError } from './private-artifacts'
import { internalErrorResponse } from './api-error'
import { rateLimit } from './rate-limit'
import { BuyerSpendPolicyError } from './buyer-spend-policy'
import { AgentSpendPolicyError } from './agent-spend-policy'
import { RouteMandateError } from './route-payment-mandate'

/** The original assigned buyer checks out. Owner and read credentials gain no task payment scope. */
export async function organizationTaskBuyerApi(request: NextRequest, mutation: boolean, run: (buyerId: string) => Promise<NextResponse>) {
  try {
    const principal = await resolveRequestPrincipal(request)
    if (!principal || principal.kind === 'mpp') return purchasingResult({ error_code: 'TASK_BUYER_REQUIRED' }, 401)
    if (principal.kind === 'registered-agent' && (await resolveRegisteredAgentRequest(request, { requiredScope: 'payments:write' })).kind !== 'agent') {
      return purchasingResult({ error_code: 'TASK_BUYER_REQUIRED' }, 401)
    }
    if (mutation && principal.usesCookieAuth && !validateCsrf(request)) return purchasingResult({ error_code: 'CSRF_REJECTED' }, 403)
    if (mutation) {
      const limit = await rateLimit(`organization-task-checkout:${principal.userId}`, { interval: 86400_000, maxRequests: 100, failClosed: true })
      if (!limit.success) return purchasingResult({ error_code: 'TASK_CHECKOUT_RATE_LIMIT' }, 429)
    }
    return await run(principal.userId)
  } catch (error) {
    if (error instanceof BuyerSpendPolicyError || error instanceof AgentSpendPolicyError || error instanceof RouteMandateError) return purchasingResult({ success: false,
      error_code: error.code, retryable: false, state: 'no_funds_moved' }, 409)
    if (error instanceof PurchasingError || error instanceof ArtifactError) return purchasingResult({ success: false, error_code: error.code,
      retryable: error.status === 503, state: 'no_funds_moved' }, error.status)
    if (error instanceof z.ZodError) return purchasingResult({ success: false, error_code: 'INVALID_TASK_CHECKOUT' }, 400)
    const response = internalErrorResponse('Organization task checkout failed', error)
    Object.entries(purchasingHeaders).forEach(([key, value]) => response.headers.set(key, value))
    return response
  }
}
