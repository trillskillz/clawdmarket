import { NextRequest, NextResponse } from 'next/server'
import { and, eq, isNull } from 'drizzle-orm'
import { isAddress, parseUnits } from 'viem'
import { db } from '@/lib/db'
import { evm_payment_intents, trades } from '@/lib/schema'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { validateCsrf } from '@/lib/csrf'
import { findAcceptedToken, getPaymentReadiness } from '@/lib/payment-config'
import { walletAuthOrigin } from '@/lib/wallet-auth'
import { PAYMENT_TX_HASH } from '@/lib/evm-payment-proof'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ id: string }> }
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

async function authorize(request: NextRequest, context: Context) {
  const principal = await resolveRequestPrincipal(request)
  if (!principal) return { error: json({ error: 'Unauthorized' }, 401) }
  if (request.method !== 'GET' && principal.usesCookieAuth && !validateCsrf(request)) return { error: json({ error: 'CSRF validation failed' }, 403) }
  const { id } = await context.params
  const [trade] = await db.select().from(trades).where(eq(trades.id, id)).limit(1)
  if (!trade) return { error: json({ error: 'Trade not found' }, 404) }
  if (trade.buyer_id !== principal.userId) return { error: json({ error: 'Forbidden' }, 403) }
  if (trade.payment_rail !== 'evm') return { error: json({ error: 'Trade does not use EVM settlement' }, 409) }
  return { trade }
}

export async function GET(request: NextRequest, context: Context) {
  const auth = await authorize(request, context)
  if (auth.error) return auth.error
  const [intent] = await db.select().from(evm_payment_intents).where(eq(evm_payment_intents.trade_id, auth.trade.id)).limit(1)
  return json({ intent: intent || null, trade: { status: auth.trade.status, payout_status: auth.trade.payout_status } })
}

export async function POST(request: NextRequest, context: Context) {
  const auth = await authorize(request, context)
  if (auth.error) return auth.error
  const body = await request.json().catch(() => null)
  const chainId = Number(body?.chain_id)
  if (!Number.isSafeInteger(chainId) || !isAddress(body?.token_address || '') || !isAddress(body?.payer_address || '')) {
    return json({ error: 'chain_id, token_address, and payer_address are required' }, 400)
  }
  const [existing] = await db.select().from(evm_payment_intents).where(eq(evm_payment_intents.trade_id, auth.trade.id)).limit(1)
  // Returning an existing intent NEVER grants permission to send again.
  if (existing) return json({ intent: existing, created: false })
  const recoveryHash = typeof body?.recovery_tx_hash === 'string' ? body.recovery_tx_hash.toLowerCase() : null
  if (recoveryHash && !PAYMENT_TX_HASH.test(recoveryHash)) return json({ error: 'A valid recovery transaction hash is required' }, 400)
  const readiness = getPaymentReadiness()
  const token = findAcceptedToken(chainId, body.token_address)
  if (!readiness.evm.enabled || !readiness.evm.treasury || !token) return json({ error: 'Payment rail/token unavailable' }, 503)
  const trade = auth.trade
  const sendAllowed = !recoveryHash && trade.status === 'pending' && Boolean(trade.payment_due_at) && Date.parse(trade.payment_due_at!) > Date.now()
  if (!sendAllowed && !(recoveryHash && ['pending', 'cancelled'].includes(trade.status))) {
    return json({ error: 'This reservation is closed. Do not send payment.', code: 'CHECKOUT_CLOSED' }, 409)
  }
  const tokenAmount = parseUnits((trade.total_cost / token.fixedUsdPrice).toFixed(token.decimals), token.decimals)
  if (tokenAmount <= 0n) return json({ error: 'Payment amount rounds to zero' }, 400)
  const [created] = await db.insert(evm_payment_intents).values({
    trade_id: trade.id, buyer_id: trade.buyer_id, origin: walletAuthOrigin(request.nextUrl.origin),
    payer_address: body.payer_address.toLowerCase(), chain_id: token.chainId,
    token_address: token.address.toLowerCase(), treasury_address: readiness.evm.treasury.toLowerCase(),
    token_amount: tokenAmount.toString(), token_decimals: token.decimals, token_symbol: token.symbol,
    token_usd_price: token.fixedUsdPrice, amount_usd: trade.total_cost, expires_at: trade.payment_due_at || trade.created_at.toISOString(),
    // Older checkout clients could have sent before intent records existed.
    // A recovery-only intent never grants a second send.
    ...(recoveryHash ? { created_at: trade.created_at } : {}),
  }).onConflictDoNothing({ target: evm_payment_intents.trade_id }).returning()
  const [intent] = created ? [created] : await db.select().from(evm_payment_intents).where(eq(evm_payment_intents.trade_id, trade.id)).limit(1)
  return json({ intent, created: Boolean(created && sendAllowed) }, created && sendAllowed ? 201 : 200)
}

// Only clients with a definite wallet rejection should use this. A timeout or
// disconnect is an unknown broadcast outcome and must retain the reservation.
export async function DELETE(request: NextRequest, context: Context) {
  const auth = await authorize(request, context)
  if (auth.error) return auth.error
  const body = await request.json().catch(() => null)
  if (body?.reason !== 'wallet_rejected' || typeof body.intent_id !== 'string') return json({ error: 'An explicit wallet rejection is required' }, 400)
  const removed = await db.delete(evm_payment_intents).where(and(
    eq(evm_payment_intents.trade_id, auth.trade.id), eq(evm_payment_intents.id, body.intent_id), isNull(evm_payment_intents.tx_hash),
  )).returning({ id: evm_payment_intents.id })
  return json({ released: removed.length === 1 })
}
