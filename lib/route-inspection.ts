import 'server-only'
import { and, eq } from 'drizzle-orm'
import { db } from './db'
import { route_plans } from './schema'
import { routePlanDto } from './route-planning'
import { listRouteAttempts } from './route-attempts'
import { linkedRoutePaymentExposure } from './route-payment-exposure'

/** Shared buyer-owned snapshot for REST and read-only A2A inspection. */
export async function inspectOwnedRoute(routeId: string, buyerId: string) {
  const [plan] = await db.select().from(route_plans).where(and(eq(route_plans.id, routeId), eq(route_plans.buyer_id, buyerId))).limit(1)
  if (!plan) return null
  return {
    route: routePlanDto(plan),
    attempts: await listRouteAttempts(plan.id),
    payment_exposure: plan.service_order_id ? await linkedRoutePaymentExposure(plan.service_order_id) : null,
  }
}
