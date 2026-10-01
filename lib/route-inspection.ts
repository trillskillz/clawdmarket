import 'server-only'
import { and, eq } from 'drizzle-orm'
import { db } from './db'
import { route_plans, service_orders, trades } from './schema'
import { routePlanDto } from './route-planning'
import { listRouteAttempts } from './route-attempts'
import { linkedRoutePaymentExposure } from './route-payment-exposure'
import { routeExecutionTiming } from './route-execution-timing'

/** Shared buyer-owned snapshot for REST and read-only A2A inspection. */
export async function inspectOwnedRoute(routeId: string, buyerId: string) {
  const [plan] = await db.select().from(route_plans).where(and(eq(route_plans.id, routeId), eq(route_plans.buyer_id, buyerId))).limit(1)
  if (!plan) return null
  let executionTiming = null
  if (plan.service_order_id) {
    const [linked] = await db.select({ order: service_orders, trade: trades }).from(service_orders)
      .innerJoin(trades, eq(trades.id, service_orders.trade_id))
      .where(eq(service_orders.id, plan.service_order_id)).limit(1)
    if (linked) executionTiming = routeExecutionTiming(plan, linked.order, linked.trade)
  }
  return {
    route: routePlanDto(plan),
    attempts: await listRouteAttempts(plan.id),
    payment_exposure: plan.service_order_id ? await linkedRoutePaymentExposure(plan.service_order_id) : null,
    execution_timing: executionTiming,
  }
}
