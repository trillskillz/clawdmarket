import 'server-only'
import { eq } from 'drizzle-orm'
import { db } from './db'
import { route_funding_steps, route_retry_funding_steps } from './schema'

export type RouteFundingSource = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]
export async function findTradeFundingStep(source: RouteFundingSource, tradeId: string) {
  const original = await source.select().from(route_funding_steps).where(eq(route_funding_steps.trade_id, tradeId)).limit(1)
  const retry = await source.select().from(route_retry_funding_steps).where(eq(route_retry_funding_steps.trade_id, tradeId)).limit(1)
  if (original.length && retry.length) throw new Error('ROUTE_FUNDING_STEP_INVARIANT')
  return original[0] || retry[0] || null
}
export async function listRouteFundingSteps(source: RouteFundingSource, routeId: string) {
  const original = await source.select().from(route_funding_steps).where(eq(route_funding_steps.route_id, routeId))
  const retry = await source.select().from(route_retry_funding_steps).where(eq(route_retry_funding_steps.route_id, routeId)).orderBy(route_retry_funding_steps.created_at)
  return [...original, ...retry]
}
export async function updateTradeFundingStep(source: RouteFundingSource, tradeId: string, state: 'funded' | 'rejected') {
  const fields = { state, updated_at: new Date() }
  await source.update(route_funding_steps).set(fields).where(eq(route_funding_steps.trade_id, tradeId))
  await source.update(route_retry_funding_steps).set(fields).where(eq(route_retry_funding_steps.trade_id, tradeId))
}
