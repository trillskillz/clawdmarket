import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { validateCsrf } from '@/lib/csrf'
import { ArtifactError, readBoundedJson } from '@/lib/private-artifacts'
import { BuyerPaymentClaimError, claimBuyerEvmPayment } from '@/lib/buyer-payment-claim'
import { internalErrorResponse } from '@/lib/api-error'

export const dynamic = 'force-dynamic'
const input = z.object({ intent_id: z.string().uuid(), mandate_id: z.string().uuid(),
  serialized_transaction: z.string().regex(/^0x(?:[a-fA-F0-9]{2}){1,4096}$/), payer_signature: z.string().regex(/^0x[a-fA-F0-9]{130}$/),
}).strict()
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Authorization, Cookie' } })
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const principal = await resolveRequestPrincipal(request)
  if (!principal) return json({ error: 'Unauthorized' }, 401)
  if (principal.usesCookieAuth && !validateCsrf(request)) return json({ error: 'CSRF validation failed' }, 403)
  try {
    const parsed = input.safeParse(await readBoundedJson(request, 10_240))
    if (!parsed.success) return json({ error: 'Invalid exact transaction claim', code: 'BUYER_PAYMENT_CLAIM_INVALID' }, 400)
    return json(await claimBuyerEvmPayment((await params).id, principal.userId, parsed.data))
  } catch (error) {
    if (error instanceof BuyerPaymentClaimError) return json({ error: error.code, code: error.code, send_allowed: false }, error.status)
    if (error instanceof ArtifactError) return json({ error: error.code, code: error.code }, error.status)
    return internalErrorResponse('Buyer transaction claim failed', error)
  }
}
