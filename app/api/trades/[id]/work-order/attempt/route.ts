import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { validateCsrf } from '@/lib/csrf'
import { internalErrorResponse } from '@/lib/api-error'
import { changeServiceExecutionAttempt, ServiceAttemptError } from '@/lib/service-execution-attempt'
import { providerAcknowledgmentDueAt } from '@/lib/provider-acknowledgment'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization, X-Agent-API-Key, X-ClawdMarket-Agent-Key' }
const bodySchema = z.object({ attempt_id: z.uuid(), action: z.enum(['accept', 'decline', 'heartbeat']) }).strict()

function failure(error_code: string, message: string, status: number) {
  return NextResponse.json({ success: false, error_code, message, retryable: false, state: 'see_trade' }, { status, headers })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const principal = await resolveRequestPrincipal(request)
    if (!principal) return failure('UNAUTHORIZED', 'Authentication required', 401)
    if (principal.usesCookieAuth && !validateCsrf(request)) return failure('CSRF_REJECTED', 'CSRF validation failed', 403)
    const parsed = bodySchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return failure('INVALID_ATTEMPT_ACTION', 'Attempt action is invalid', 400)
    const { id } = await params
    const result = await changeServiceExecutionAttempt(id, principal.userId, parsed.data.attempt_id, parsed.data.action)
    return NextResponse.json({ success: true, attempt: {
      id: result.attempt.id, state: result.attempt.state,
      acknowledgment_due_at: providerAcknowledgmentDueAt(result.attempt).toISOString(),
      accepted_at: result.attempt.accepted_at?.toISOString() || null,
      heartbeat_at: result.attempt.heartbeat_at?.toISOString() || null,
      lease_expires_at: result.attempt.lease_expires_at?.toISOString() || null,
    }, idempotent: result.idempotent, funds_state: 'see_trade' }, { status: result.idempotent ? 200 : 201, headers })
  } catch (error) {
    if (error instanceof ServiceAttemptError) return failure(error.code, error.message, error.status)
    const response = internalErrorResponse('Work attempt transition failed', error)
    for (const [name, value] of Object.entries(headers)) response.headers.set(name, value)
    return response
  }
}
