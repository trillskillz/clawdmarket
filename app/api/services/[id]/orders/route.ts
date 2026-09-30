import { NextRequest, NextResponse } from 'next/server'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { listings, service_definitions, service_orders, trades } from '@/lib/schema'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { validateCsrf } from '@/lib/csrf'
import { serviceOrderDto, serviceOrderInput } from '@/lib/service-definitions'
import { selectMarketplaceRail } from '@/lib/payment-rail-selection'
import { getPaymentReadiness } from '@/lib/payment-config'
import { NewPaymentsPausedError, requireNewPaymentsOpen } from '@/lib/payment-control'
import { payoutAddressForUser } from '@/lib/external-settlement'
import { isPublicMarketplaceSeller } from '@/lib/listing-visibility'
import { checkoutForTrade } from '@/lib/trade-checkout'
import { createLedgerTrade, ensureAdminFeeRecipient, TradeRaceError } from '@/lib/settlement'
import { enforceAgentSpendPolicy, AgentSpendPolicyError } from '@/lib/agent-spend-policy'
import { internalErrorResponse } from '@/lib/api-error'
import { expireTradePayment } from '@/lib/trade-funding'
import { withServiceReservationLock } from '@/lib/service-reservation-lock'
import { referenceFleetPaidServicePublicationLocked } from '@/lib/reference-fleet-control'
import { reusableServiceWritesEnabled } from '@/lib/routing-feature-flags'

export const dynamic = 'force-dynamic'

function failure(error_code: string, message: string, status: number, retryable = false) {
  return NextResponse.json({ success: false, error_code, message, retryable, state: 'no_funds_moved' }, { status, headers: { 'Cache-Control': 'no-store' } })
}

function sqliteBusy(error: unknown) {
  let current = error
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (typeof current === 'object' && 'message' in current && /SQLITE_BUSY|database is locked/i.test(String(current.message))) return true
    current = typeof current === 'object' && 'cause' in current ? current.cause : null
  }
  return false
}

function referenceConflict(error: unknown) {
  let current = error
  for (let depth = 0; current && depth < 6; depth += 1) {
    if (typeof current === 'object' && 'message' in current && /UNIQUE constraint failed: (trades|service_orders)\.client_reference/i.test(String(current.message))) return true
    current = typeof current === 'object' && 'cause' in current ? current.cause : null
  }
  return false
}

async function existingOrder(reference: string) {
  const [order] = await db.select().from(service_orders).where(eq(service_orders.client_reference, reference)).limit(1)
  if (!order) return null
  const [trade] = await db.select().from(trades).where(eq(trades.id, order.trade_id)).limit(1)
  return trade ? { order, trade } : null
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const principal = await resolveRequestPrincipal(request)
  if (!principal) return failure('UNAUTHORIZED', 'Authentication required', 401)
  if (principal.usesCookieAuth && !validateCsrf(request)) return failure('CSRF_REJECTED', 'CSRF validation failed', 403)
  const parsed = serviceOrderInput.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ success: false, error_code: 'INVALID_ORDER', message: 'Order request is invalid', retryable: false, state: 'no_funds_moved', details: parsed.error.issues }, { status: 400 })
  const { id } = await params
  const { client_reference: reference, objective, input, payment_rail: requestedRail, max_total: maxTotal } = parsed.data

  const prior = await existingOrder(reference)
  if (prior) {
    if (prior.order.buyer_id !== principal.userId || prior.order.service_id !== id || prior.order.objective !== objective || prior.order.input_json !== JSON.stringify(input) || requestedRail !== 'auto' && prior.order.payment_rail !== requestedRail) {
      return failure('IDEMPOTENCY_CONFLICT', 'Reference belongs to another order or rail', 409)
    }
    return NextResponse.json({ order: serviceOrderDto(prior.order), trade: prior.trade, checkout: checkoutForTrade(prior.trade), idempotent: true }, { headers: { 'Cache-Control': 'no-store' } })
  }
  if (!reusableServiceWritesEnabled()) return failure('REUSABLE_SERVICES_DISABLED', 'Reusable service orders are not enabled', 503, true)

  try {
    const [service] = await db.select().from(service_definitions).where(eq(service_definitions.id, id)).limit(1)
    if (!service || service.status !== 'active' || !await isPublicMarketplaceSeller(service.seller_id)) return failure('SERVICE_UNAVAILABLE', 'Service is not active', 409)
    if (service.seller_id === principal.userId) return failure('SELF_PURCHASE', 'A seller cannot order its own service', 409)
    if (service.seller_id.startsWith('user_agent_') && await referenceFleetPaidServicePublicationLocked(service.seller_id.slice('user_agent_'.length))) {
      return failure('REFERENCE_FLEET_PAID_SERVICES_LOCKED', 'Managed reference agents cannot sell paid services', 409)
    }
    await requireNewPaymentsOpen()
    const expired = await db.select({ trade: trades }).from(service_orders)
      .innerJoin(trades, eq(service_orders.trade_id, trades.id))
      .where(and(eq(service_orders.service_id, id), eq(trades.status, 'pending'), sql`${trades.payment_due_at} <= ${new Date().toISOString()}`))
      .limit(1_000)
    for (const { trade } of expired) await expireTradePayment(trade)
    const feeMinor = Math.round(service.price_minor * 0.05)
    const totalMinor = service.price_minor + feeMinor
    if (maxTotal !== undefined && totalMinor > maxTotal) return failure('BUDGET_EXCEEDED', 'Current total exceeds max_total', 409)
    const readiness = getPaymentReadiness()
    const sellerPayout = await payoutAddressForUser(service.seller_id)
    const rail = selectMarketplaceRail(requestedRail, readiness, Boolean(sellerPayout))
    if (!rail) return failure(sellerPayout ? 'PAYMENT_RAIL_UNAVAILABLE' : 'SELLER_PAYOUT_REQUIRED', 'No eligible payment rail for this seller', 409)
    const feeRecipient = rail === 'ledger' ? await ensureAdminFeeRecipient() : null
    const now = new Date()
    const reserveOnce = () => db.transaction(async (tx) => {
      const [claimed] = await tx.update(service_definitions)
        .set({ active_orders: sql`${service_definitions.active_orders} + 1`, updated_at: now })
        .where(and(
          eq(service_definitions.id, id), eq(service_definitions.status, 'active'),
          eq(service_definitions.price_minor, service.price_minor),
          sql`${service_definitions.active_orders} < ${service_definitions.max_concurrency}`,
        ))
        .returning({ id: service_definitions.id })
      if (!claimed) throw new Error('SERVICE_CAPACITY_OR_PRICE_CHANGED')
      if (principal.agentId) await enforceAgentSpendPolicy(tx, { agentId: principal.agentId, buyerId: principal.userId, totalCost: totalMinor / 100 })
      const [listing] = await tx.insert(listings).values({
        seller_id: service.seller_id, category: 'skills', title: service.title,
        description: service.description, price_bankr: service.price_minor / 100,
        status: rail === 'ledger' ? 'active' : 'sold',
      }).returning()
      const reservedTrade = rail === 'ledger'
        ? await createLedgerTrade(tx, listing, principal.userId, feeRecipient!, { agentId: principal.agentId, clientReference: reference })
        : (await tx.insert(trades).values({
            listing_id: listing.id, buyer_id: principal.userId, seller_id: service.seller_id,
            amount: service.price_minor / 100, fee: feeMinor / 100,
            item_price: service.price_minor / 100, platform_fee: feeMinor / 100,
            total_cost: totalMinor / 100, seller_amount: service.price_minor / 100,
            dev_amount: feeMinor / 100,
            dev_wallet: rail === 'mpp' ? readiness.mpp.feeRecipient : readiness.evm.feeRecipient,
            payout_status: 'pending', payment_rail: rail, client_reference: reference,
            payment_due_at: new Date(Date.now() + 30 * 60_000).toISOString(), status: 'pending',
            auto_confirm_at: new Date(Date.now() + (30 * 60 + 259200) * 1000).toISOString(),
          }).returning())[0]
      const [newOrder] = await tx.insert(service_orders).values({
        id: crypto.randomUUID(), service_id: id, listing_id: listing.id,
        trade_id: reservedTrade.id, buyer_id: principal.userId,
        client_reference: reference, objective, input_json: JSON.stringify(input), price_minor: service.price_minor,
        payment_rail: rail, state: rail === 'ledger' ? 'funded' : 'awaiting_funding',
      }).returning()
      return [newOrder, reservedTrade] as const
    })
    const reservation = await withServiceReservationLock(id, async () => {
      for (let attempt = 0; attempt < 6; attempt += 1) {
        try {
          return await reserveOnce()
        } catch (error) {
          if (!sqliteBusy(error) || attempt === 5) throw error
          await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** attempt))
        }
      }
      return null
    })
    if (!reservation) throw new Error('SERVICE_RESERVATION_UNAVAILABLE')
    const [order, trade] = reservation
    return NextResponse.json({ order: serviceOrderDto(order), trade, checkout: checkoutForTrade(trade), idempotent: false }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof NewPaymentsPausedError) return failure(error.code, error.message, error.status, true)
    if (error instanceof AgentSpendPolicyError) return failure(error.code, error.message, 409)
    if (error instanceof TradeRaceError) return failure(error.code, error.message, 409)
    if (error instanceof Error && error.message === 'SERVICE_CAPACITY_OR_PRICE_CHANGED') return failure('SERVICE_CAPACITY_OR_PRICE_CHANGED', 'Service capacity or price changed; re-plan before retrying', 409)
    const raced = await existingOrder(reference)
    if (raced && raced.order.buyer_id === principal.userId && raced.order.service_id === id && raced.order.objective === objective && raced.order.input_json === JSON.stringify(input) && (requestedRail === 'auto' || raced.order.payment_rail === requestedRail)) {
      return NextResponse.json({ order: serviceOrderDto(raced.order), trade: raced.trade, checkout: checkoutForTrade(raced.trade), idempotent: true }, { headers: { 'Cache-Control': 'no-store' } })
    }
    if (raced) return failure('IDEMPOTENCY_CONFLICT', 'Reference belongs to another order', 409)
    if (referenceConflict(error)) return failure('IDEMPOTENCY_CONFLICT', 'Reference belongs to another trade', 409)
    return internalErrorResponse('Service order reservation failed', error)
  }
}
