import { and, eq } from 'drizzle-orm'
import { db } from './db'
import { route_attempts } from './schema'

export async function beginRouteAttempt(routeId: string, attemptNumber: number, serviceId: string) {
  await db.insert(route_attempts).values({ id: crypto.randomUUID(), route_id: routeId,
    attempt_number: attemptNumber, service_id: serviceId, state: 'checking' }).onConflictDoNothing()
  const [attempt] = await db.select().from(route_attempts).where(and(eq(route_attempts.route_id, routeId), eq(route_attempts.attempt_number, attemptNumber))).limit(1)
  if (!attempt || attempt.service_id !== serviceId) throw new Error('ROUTE_ATTEMPT_SNAPSHOT_CONFLICT')
  return attempt
}

export async function markRouteAttemptIneligible(routeId: string, attemptNumber: number, failureCode: string) {
  await db.update(route_attempts).set({ state: 'ineligible', failure_code: failureCode, updated_at: new Date() })
    .where(and(eq(route_attempts.route_id, routeId), eq(route_attempts.attempt_number, attemptNumber), eq(route_attempts.state, 'checking')))
}

export async function listRouteAttempts(routeId: string) {
  const rows = await db.select().from(route_attempts).where(eq(route_attempts.route_id, routeId)).orderBy(route_attempts.attempt_number)
  return rows.map(({ id, attempt_number, service_id, state, failure_code, service_order_id, created_at, updated_at }) => ({
    id, attempt_number, service_id, state, failure_code, service_order_id, created_at, updated_at,
  }))
}
