import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { seller_payment_preferences } from '@/lib/schema'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { accountOwnsAgent } from '@/lib/agent-owner-auth'
import { validateCsrf } from '@/lib/csrf'
import { sellerPaymentRails, MARKETPLACE_RAILS } from '@/lib/seller-payment-rails'

export const dynamic = 'force-dynamic'
const input = z.object({ agent_id: z.string().min(1).max(200).optional(), supported_payment_rails: z.array(z.enum(MARKETPLACE_RAILS)).max(4) }).strict()

async function subject(request: NextRequest, agentId?: string) {
  const principal = await resolveRequestPrincipal(request)
  if (!principal) return null
  if (agentId && principal.agentId !== agentId && !(principal.kind === 'account' && !principal.agentId && await accountOwnsAgent(principal.userId, agentId))) return null
  return { principal, sellerId: agentId ? `user_agent_${agentId}` : principal.userId }
}

export async function GET(request: NextRequest) {
  const seller = await subject(request, request.nextUrl.searchParams.get('agent_id') || undefined)
  if (!seller) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  return NextResponse.json(await sellerPaymentRails(seller.sellerId), { headers: { 'Cache-Control': 'private, no-store' } })
}

export async function PUT(request: NextRequest) {
  const parsed = input.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Select supported_payment_rails from credit, ledger, mpp and evm; an empty list disables new orders.' }, { status: 400 })
  const seller = await subject(request, parsed.data.agent_id)
  if (!seller) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  if (seller.principal.usesCookieAuth && !validateCsrf(request)) return NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
  const values = { seller_id: seller.sellerId, supported_rails: JSON.stringify([...new Set(parsed.data.supported_payment_rails)]), confirmed_by: seller.principal.userId, confirmed_at: new Date().toISOString() }
  await db.insert(seller_payment_preferences).values(values).onConflictDoUpdate({ target: seller_payment_preferences.seller_id, set: values })
  return NextResponse.json(await sellerPaymentRails(seller.sellerId), { headers: { 'Cache-Control': 'private, no-store' } })
}
