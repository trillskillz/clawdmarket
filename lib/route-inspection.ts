import { serviceExecutionContract } from './service-execution-contract'
import 'server-only'
import { and, eq } from 'drizzle-orm'
import { db } from './db'
import { route_plans, service_definitions, service_execution_attempts, service_orders, trades } from './schema'
import { routePlanDto } from './route-planning'
import { listRouteAttempts } from './route-attempts'
import { linkedRoutePaymentExposure } from './route-payment-exposure'
import { routeExecutionTiming } from './route-execution-timing'
import { providerExecutionStatus } from './provider-execution-status'
import { tradeAcceptanceStatus } from './trade-acceptance'

/** Shared buyer-owned snapshot for REST and read-only A2A inspection. */
export async function inspectOwnedRoute(routeId: string, buyerId: string) {
  const [plan] = await db.select().from(route_plans).where(and(eq(route_plans.id, routeId), eq(route_plans.buyer_id, buyerId))).limit(1)
  if (!plan) return null
  let executionTiming = null
  let providerExecution = null
  let acceptance = null
  if (plan.service_order_id) {
    const [linked] = await db.select({ order: service_orders, trade: trades,
      provider_protocol: service_definitions.provider_protocol, attempt: service_execution_attempts }).from(service_orders)
      .innerJoin(trades, eq(trades.id, service_orders.trade_id))
      .innerJoin(service_definitions, eq(service_definitions.id, service_orders.service_id))
      .leftJoin(service_execution_attempts, eq(service_execution_attempts.order_id, service_orders.id))
      .where(eq(service_orders.id, plan.service_order_id)).limit(1)
    if (linked) {
      const now = new Date()
      executionTiming = routeExecutionTiming(plan, linked.order, linked.trade, now)
      providerExecution = providerExecutionStatus(serviceExecutionContract(linked.order, linked).provider_protocol, linked.order, linked.trade, linked.attempt, executionTiming, now)
      acceptance = await tradeAcceptanceStatus(linked.trade.id)
    }
  }
  return {
    route: routePlanDto(plan),
    attempts: await listRouteAttempts(plan.id),
    payment_exposure: plan.service_order_id ? await linkedRoutePaymentExposure(plan.service_order_id) : null,
    execution_timing: executionTiming,
    provider_execution: providerExecution,
    acceptance,
  }
}
