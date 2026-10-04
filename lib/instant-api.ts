import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import type { z } from 'zod'
import { resolveRequestPrincipal } from './request-principal'
import { validateCsrf } from './csrf'
import { InstantError } from './instant-execution'
import { CreditError } from './account-credit'
import { BuyerSpendPolicyError } from './buyer-spend-policy'
import { AgentSpendPolicyError } from './agent-spend-policy'
import { internalErrorResponse } from './api-error'
import { rateLimit } from './rate-limit'
import type { RequestPrincipal } from './request-principal'

export const instantResponse = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
export function instantFailure(code: string, status: number) { return instantResponse({ success: false, error_code: code, retryable: status === 503 || status === 429 }, status) }
export async function instantEndpoint(request: NextRequest, work: (principal: RequestPrincipal) => Promise<Response>) {
  try {
    const principal = await resolveRequestPrincipal(request)
    if (!principal) return instantFailure('UNAUTHORIZED', 401)
    if (request.method !== 'GET' && principal.usesCookieAuth && !validateCsrf(request)) return instantFailure('CSRF_REJECTED', 403)
    const rate = await rateLimit(`instant:${principal.userId}`, { maxRequests: 240, interval: 60000, failClosed: true })
    if (!rate.success) return instantFailure('RATE_LIMITED', 429)
    return await work(principal)
  } catch (error) {
    if (error instanceof InstantError || error instanceof CreditError) return instantFailure(error.code, error.status)
    if (error instanceof BuyerSpendPolicyError || error instanceof AgentSpendPolicyError) return instantFailure(error.code, 409)
    return internalErrorResponse('Instant execution failed', error)
  }
}
export async function instantBody<T extends z.ZodType>(request: NextRequest, schema: T): Promise<z.output<T>> {
  const reader = request.body?.getReader()
  const chunks: Uint8Array[] = []; let size = 0
  if (reader) {
    try {
      for (;;) {
        const part = await reader.read(); if (part.done) break
        size += part.value.byteLength
        if (size > 12288) { await reader.cancel(); throw new InstantError('REQUEST_TOO_LARGE', 413) }
        chunks.push(part.value)
      }
    } finally { reader.releaseLock() }
  }
  const text = Buffer.concat(chunks).toString('utf8')
  let input: unknown
  try { input = JSON.parse(text) } catch { throw new InstantError('INVALID_REQUEST', 400) }
  const parsed = schema.safeParse(input)
  if (!parsed.success) throw new InstantError('INVALID_REQUEST', 400)
  return parsed.data
}
