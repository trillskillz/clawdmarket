import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { validateCsrf } from '@/lib/csrf'
import { ArtifactError, readBoundedJson } from '@/lib/private-artifacts'
import { BuyerMppPaymentError, createBuyerMppIntent, inspectBuyerMppIntent } from '@/lib/buyer-mpp-payment'
import { walletAuthOrigin } from '@/lib/wallet-auth'
import { getRequestOrigin } from '@/lib/request-origin'
import { internalErrorResponse } from '@/lib/api-error'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ id: string }> }
const input = z.object({ buyer_operation_id: z.string().uuid() }).strict()
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Authorization, Cookie' } })
async function handle(request: NextRequest, context: Context) {
  const principal = await resolveRequestPrincipal(request)
  if (!principal) return json({ error: 'Unauthorized' }, 401)
  if (request.method === 'POST' && principal.usesCookieAuth && !validateCsrf(request)) return json({ error: 'CSRF validation failed' }, 403)
  try {
    const { id } = await context.params
    if (request.method === 'GET') return json(await inspectBuyerMppIntent(id, principal.userId))
    const parsed = input.safeParse(await readBoundedJson(request, 256))
    if (!parsed.success) return json({ error: 'Invalid buyer operation', code: 'BUYER_OPERATION_INVALID' }, 400)
    const result = await createBuyerMppIntent(id, principal.userId, parsed.data.buyer_operation_id, walletAuthOrigin(getRequestOrigin(request)))
    return json(result, result.created ? 201 : 200)
  } catch (error) {
    if (error instanceof BuyerMppPaymentError) return json({ error: error.code, code: error.code, send_allowed: false }, error.status)
    if (error instanceof ArtifactError) return json({ error: error.code, code: error.code }, error.status)
    return internalErrorResponse('Buyer MPP intent failed', error)
  }
}
export const GET = handle
export const POST = handle
