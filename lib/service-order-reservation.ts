import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import type { z } from 'zod'
import { db } from '@/lib/db'
import { listings, route_plans, service_definitions, service_orders, trades } from '@/lib/schema'
import type { RequestPrincipal } from '@/lib/request-principal'
import { serviceOrderInput } from '@/lib/service-definitions'
import { selectMarketplaceRail } from '@/lib/payment-rail-selection'
import { getPaymentReadiness } from '@/lib/payment-config'
import { requireNewPaymentsOpen } from '@/lib/payment-control'
import { payoutAddressForUser } from '@/lib/external-settlement'
import { isPublicMarketplaceSeller } from '@/lib/listing-visibility'
import { createLedgerTrade, ensureAdminFeeRecipient } from '@/lib/settlement'
import { enforceAgentSpendPolicy } from '@/lib/agent-spend-policy'
import { expireTradePayment } from '@/lib/trade-funding'
import { withServiceReservationLock } from '@/lib/service-reservation-lock'
import { referenceFleetPaidServicePublicationLocked } from '@/lib/reference-fleet-control'
import { reusableServiceWritesEnabled } from '@/lib/routing-feature-flags'

export class ServiceOrderReservationError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 409, public readonly retryable = false) {
    super(message)
  }
}

type OrderRequest = z.output<typeof serviceOrderInput>
type ReservationArgs = { serviceId: string; principal: RequestPrincipal; request: OrderRequest; routeId?: string; externalOnly?: boolean }

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

export async function existingServiceOrder(reference: string) {
  const [order] = await db.select().from(service_orders).where(eq(service_orders.client_reference, reference)).limit(1)
  if (!order) return null
  const [trade] = await db.select().from(trades).where(eq(trades.id, order.trade_id)).limit(1)
  return trade ? { order, trade } : null
}

function sameRequest(prior: NonNullable<Awaited<ReturnType<typeof existingServiceOrder>>>, args: ReservationArgs) {
  const { request, principal, serviceId } = args
  return prior.order.buyer_id === principal.userId && prior.order.service_id === serviceId
    && prior.order.objective === request.objective && prior.order.input_json === JSON.stringify(request.input)
    && (request.payment_rail === 'auto' || prior.order.payment_rail === request.payment_rail)
    && (request.expected_price === undefined || prior.order.price_minor === request.expected_price)
    && (!args.externalOnly || prior.order.payment_rail !== 'ledger')
}

async function replay(args: ReservationArgs) {
  const prior = await existingServiceOrder(args.request.client_reference)
  if (!prior) return null
  if (!sameRequest(prior, args)) throw new ServiceOrderReservationError('IDEMPOTENCY_CONFLICT', 'Reference belongs to another order or rail')
  if (args.routeId) {
    const [plan] = await db.select({ service_order_id: route_plans.service_order_id }).from(route_plans).where(eq(route_plans.id, args.routeId)).limit(1)
    if (plan?.service_order_id !== prior.order.id) throw new ServiceOrderReservationError('IDEMPOTENCY_CONFLICT', 'Reference is not linked to this route')
  }
  return { ...prior, idempotent: true }
}

/** Reserves capacity and creates an order in one transaction. External rails remain unpaid. */
export async function reserveServiceOrder(args: ReservationArgs) {
  const { serviceId: id, principal, request, routeId, externalOnly } = args
  const reference = request.client_reference
  const prior = await replay(args)
  if (prior) return prior
  if (!reusableServiceWritesEnabled()) throw new ServiceOrderReservationError('REUSABLE_SERVICES_DISABLED', 'Reusable service orders are not enabled', 503, true)
  try {
    const [service] = await db.select().from(service_definitions).where(eq(service_definitions.id, id)).limit(1)
    if (!service || service.status !== 'active' || !await isPublicMarketplaceSeller(service.seller_id)) throw new ServiceOrderReservationError('SERVICE_UNAVAILABLE', 'Service is not active')
    if (service.seller_id === principal.userId) throw new ServiceOrderReservationError('SELF_PURCHASE', 'A seller cannot order its own service')
    if (service.seller_id.startsWith('user_agent_') && await referenceFleetPaidServicePublicationLocked(service.seller_id.slice('user_agent_'.length))) {
      throw new ServiceOrderReservationError('REFERENCE_FLEET_PAID_SERVICES_LOCKED', 'Managed reference agents cannot sell paid services')
    }
    if (request.expected_price !== undefined && service.price_minor !== request.expected_price) throw new ServiceOrderReservationError('SERVICE_PRICE_CHANGED', 'Service price changed; re-plan before retrying')
    await requireNewPaymentsOpen()
    const expired = await db.select({ trade: trades }).from(service_orders)
      .innerJoin(trades, eq(service_orders.trade_id, trades.id))
      .where(and(eq(service_orders.service_id, id), eq(trades.status, 'pending'), sql`${trades.payment_due_at} <= ${new Date().toISOString()}`))
      .limit(1_000)
    for (const { trade } of expired) await expireTradePayment(trade)
    const feeMinor = Math.round(service.price_minor * 0.05)
    const totalMinor = service.price_minor + feeMinor
    if (request.max_total !== undefined && totalMinor > request.max_total) throw new ServiceOrderReservationError('BUDGET_EXCEEDED', 'Current total exceeds max_total')
    const readiness = getPaymentReadiness()
    const sellerPayout = await payoutAddressForUser(service.seller_id)
    const rail = selectMarketplaceRail(request.payment_rail, readiness, Boolean(sellerPayout))
    if (!rail || externalOnly && rail === 'ledger') throw new ServiceOrderReservationError(sellerPayout ? 'PAYMENT_RAIL_UNAVAILABLE' : 'SELLER_PAYOUT_REQUIRED', 'No eligible external payment rail for this seller')
    const feeRecipient = rail === 'ledger' ? await ensureAdminFeeRecipient() : null
    const reserveOnce = () => db.transaction(async (tx) => {
      const now = new Date()
      if (routeId) {
        const [plan] = await tx.select().from(route_plans).where(and(eq(route_plans.id, routeId), eq(route_plans.buyer_id, principal.userId))).limit(1)
        if (!plan || plan.state !== 'reserving' || plan.service_order_id) throw new ServiceOrderReservationError('ROUTE_STATE_CHANGED', 'Route is no longer available for reservation')
        if (plan.expires_at <= now) throw new ServiceOrderReservationError('ROUTE_PLAN_EXPIRED', 'Route plan expired before execution', 410)
        if (totalMinor > plan.max_budget_minor) throw new ServiceOrderReservationError('BUDGET_EXCEEDED', 'Current total exceeds route budget')
      }
      const [claimed] = await tx.update(service_definitions)
        .set({ active_orders: sql`${service_definitions.active_orders} + 1`, updated_at: now })
        .where(and(eq(service_definitions.id, id), eq(service_definitions.status, 'active'),
          eq(service_definitions.price_minor, service.price_minor),
          sql`${service_definitions.active_orders} < ${service_definitions.max_concurrency}`))
        .returning({ id: service_definitions.id })
      if (!claimed) throw new ServiceOrderReservationError('SERVICE_CAPACITY_OR_PRICE_CHANGED', 'Service capacity or price changed; re-plan before retrying')
      const spendContext = { sellerId: service.seller_id, capabilities: JSON.parse(service.capabilities) as string[], paymentRail: rail, verificationMethods: (JSON.parse(service.verification_policy) as { methods?: string[] }).methods || ['buyer_review'] }
      if (principal.agentId) await enforceAgentSpendPolicy(tx, { agentId: principal.agentId, buyerId: principal.userId, totalCost: totalMinor / 100, ...spendContext })
      const [listing] = await tx.insert(listings).values({ seller_id: service.seller_id, category: 'skills', title: service.title,
        description: service.description, price_bankr: service.price_minor / 100, status: rail === 'ledger' ? 'active' : 'sold' }).returning()
      const trade = rail === 'ledger'
        ? await createLedgerTrade(tx, listing, principal.userId, feeRecipient!, { agentId: principal.agentId, clientReference: reference, spendContext })
        : (await tx.insert(trades).values({
            listing_id: listing.id, buyer_id: principal.userId, seller_id: service.seller_id,
            amount: service.price_minor / 100, fee: feeMinor / 100,
            item_price: service.price_minor / 100, platform_fee: feeMinor / 100,
            total_cost: totalMinor / 100, seller_amount: service.price_minor / 100, dev_amount: feeMinor / 100,
            dev_wallet: rail === 'mpp' ? readiness.mpp.feeRecipient : readiness.evm.feeRecipient,
            payout_status: 'pending', payment_rail: rail, client_reference: reference,
            payment_due_at: new Date(Date.now() + 30 * 60_000).toISOString(), status: 'pending',
            auto_confirm_at: new Date(Date.now() + (30 * 60 + 259200) * 1000).toISOString(),
          }).returning())[0]
      const [order] = await tx.insert(service_orders).values({
        id: crypto.randomUUID(), service_id: id, listing_id: listing.id, trade_id: trade.id,
        buyer_id: principal.userId, client_reference: reference, objective: request.objective,
        input_json: JSON.stringify(request.input), price_minor: service.price_minor,
        payment_rail: rail, state: rail === 'ledger' ? 'funded' : 'awaiting_funding',
      }).returning()
      if (routeId) {
        const [linked] = await tx.update(route_plans).set({ state: 'awaiting_funding', service_order_id: order.id, updated_at: now })
          .where(and(eq(route_plans.id, routeId), eq(route_plans.buyer_id, principal.userId), eq(route_plans.state, 'reserving'), sql`${route_plans.service_order_id} IS NULL`)).returning({ id: route_plans.id })
        if (!linked) throw new ServiceOrderReservationError('ROUTE_STATE_CHANGED', 'Route changed while reserving')
      }
      return { order, trade, idempotent: false }
    })
    return await withServiceReservationLock(id, async () => {
      for (let attempt = 0; attempt < 6; attempt += 1) {
        try { return await reserveOnce() }
        catch (error) {
          if (!sqliteBusy(error) || attempt === 5) throw error
          await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** attempt))
        }
      }
      throw new ServiceOrderReservationError('SERVICE_RESERVATION_UNAVAILABLE', 'Service reservation unavailable', 503, true)
    })
  } catch (error) {
    const raced = await replay(args)
    if (raced) return raced
    if (referenceConflict(error)) throw new ServiceOrderReservationError('IDEMPOTENCY_CONFLICT', 'Reference belongs to another trade')
    throw error
  }
}
