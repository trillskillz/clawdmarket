import 'server-only'
import { eq, sql } from 'drizzle-orm'
import { db } from './db'
import { route_controls, route_control_events } from './schema'
import { inspectRouteAdmissionHealth } from './route-admission-health.mjs'
import { withKeyedWriteLock } from './service-reservation-lock'

type Source = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]
const key = 'new_routes'
const staleSeconds = 900
const recoverySeconds = 120, recoveryChecks = 3, sampleGapSeconds = 30
const reasons = new Set(['OPERATOR_PAUSE', 'FINANCIAL_UNCERTAINTY', 'MONITOR_FAILURE'])
export class RouteControlError extends Error {
  constructor(public code: string, public status = 409) { super(code) }
}

export async function getRouteControl(source: Source = db) {
  const [row] = await source.select().from(route_controls).where(eq(route_controls.key, key)).limit(1)
  const environment = process.env.CLAWDMARKET_ROUTE_EXECUTION_PAUSED === 'true'
  const monitorStale = process.env.VERCEL_ENV === 'production' && (!row?.last_checked_at || row.last_checked_at.getTime() > Date.now() || Date.now() - row.last_checked_at.getTime() > staleSeconds * 1000)
  return { paused: environment || !!row?.paused || monitorStale, database_paused: !!row?.paused,
    reason_code: environment ? 'ENVIRONMENT_PAUSE' : row?.paused ? reasons.has(row.reason_code || '') ? row!.reason_code : 'FINANCIAL_UNCERTAINTY' : monitorStale ? 'MONITOR_STALE' : null,
    automatic_reopen: true, healthy_check_count: row?.healthy_check_count || 0, healthy_since_at: row?.healthy_since_at?.toISOString() || null,
    recovery_minimum_seconds: recoverySeconds, recovery_required_checks: recoveryChecks,
    revision: row?.revision || 0, last_checked_at: row?.last_checked_at?.toISOString() || null,
    source: environment ? 'environment' as const : monitorStale ? 'monitor' as const : 'database' as const }
}

/** Called in the reservation/claim transaction, never as a guard on proof/refund/payout recovery. */
export async function routeAdmissionFailure(source: Source = db) {
  try { return (await getRouteControl(source)).paused ? 'ROUTE_EXECUTION_PAUSED' : null }
  catch { return 'ROUTE_EXECUTION_PAUSED' } // Missing controls cannot grant new authority.
}

/** Fixed audit queries remain on this source, including inside pause/resume transactions. */
export async function inspectRouteFinancialHealth(source: Source = db) {
  return inspectRouteAdmissionHealth({ execute: async (query: string) => ({ rows: await source.all(sql.raw(query)) }) })
}

async function writeControl(source: Source, input: { paused: boolean; reason: string; actor: string | null; automaticResume?: boolean }, checkedAt?: Date, progress?: { healthy_since_at: Date | null; healthy_sampled_at: Date | null; healthy_check_count: number }) {
  const [prior] = await source.select().from(route_controls).where(eq(route_controls.key, key)).limit(1)
  const changed = input.actor !== null || !!prior?.paused !== input.paused || (input.paused && prior?.reason_code !== input.reason)
  const revision = (prior?.revision || 0) + (changed ? 1 : 0), now = new Date()
  const values = { paused: input.paused ? 1 : 0, reason_code: input.paused ? input.reason : null, revision,
    last_checked_at: checkedAt || prior?.last_checked_at || null, updated_at: now,
    ...(progress || { healthy_since_at: null, healthy_sampled_at: null, healthy_check_count: 0 }) }
  await source.insert(route_controls).values({ key, ...values }).onConflictDoUpdate({ target: route_controls.key, set: values })
  if (changed) await source.insert(route_control_events).values({ control_key: key, paused: values.paused, reason_code: input.paused ? input.reason : input.automaticResume ? 'AUTOMATIC_HEALTHY_RESUME' : 'OPERATOR_RESUME',
    revision, actor_user_id: input.actor, created_at: now })
  return getRouteControl(source)
}

async function transaction<T>(run: (source: Source) => Promise<T>) {
  return withKeyedWriteLock('route-admission-control', async () => {
    for (let attempt = 0; ; attempt++) {
      try { return await db.transaction(run) } catch (error) {
        let cause: unknown = error, busy = false
        for (let depth = 0; depth < 6 && cause && typeof cause === 'object'; depth++) {
          const entry = cause as { code?: string; message?: string; cause?: unknown }
          busy ||= entry.code === 'SQLITE_BUSY' || /SQLITE_BUSY|database is locked/i.test(entry.message || ''); cause = entry.cause
        }
        if (!busy || attempt >= 5) throw error
        await new Promise((done) => setTimeout(done, 20 * 2 ** attempt))
      }
    }
  })
}

/** User-authorized automatic reopening requires independent healthy samples and a stable recovery window. */
export async function monitorRouteAdmission() {
  try {
    return await transaction(async (source) => {
      const financial = await inspectRouteFinancialHealth(source)
      const [prior] = await source.select().from(route_controls).where(eq(route_controls.key, key)).limit(1)
      const now = new Date()
      const continuous = !!prior?.healthy_since_at && !!prior.healthy_sampled_at && !!prior.last_checked_at
        && now.getTime() - prior.last_checked_at.getTime() <= staleSeconds * 1000
        && prior.last_checked_at <= now && prior.healthy_since_at <= now && prior.healthy_sampled_at <= now
      const healthySince = financial.healthy ? continuous ? prior!.healthy_since_at! : now : null
      const sampleDue = financial.healthy && (!continuous || now.getTime() - prior!.healthy_sampled_at!.getTime() >= sampleGapSeconds * 1000)
      const healthyCount = financial.healthy ? (continuous ? prior!.healthy_check_count : 0) + (sampleDue ? 1 : 0) : 0
      const previousHold = !!prior?.paused || (process.env.VERCEL_ENV === 'production' && (!prior?.last_checked_at || prior.last_checked_at > now || now.getTime() - prior.last_checked_at.getTime() > staleSeconds * 1000))
      const reopen = financial.healthy && previousHold && healthyCount >= recoveryChecks && !!healthySince
        && now.getTime() - healthySince.getTime() >= recoverySeconds * 1000
      const control = await writeControl(source, { paused: !financial.healthy || (previousHold && !reopen),
        reason: prior?.paused ? prior.reason_code || 'FINANCIAL_UNCERTAINTY' : 'FINANCIAL_UNCERTAINTY', actor: null, automaticResume: reopen }, now,
        { healthy_since_at: healthySince, healthy_sampled_at: financial.healthy ? sampleDue ? now : prior!.healthy_sampled_at : null, healthy_check_count: healthyCount })
      return { control, financial }
    })
  } catch {
    // Inspection failure is a routing hold; ordinary reconciliation workers still continue.
    try { await transaction((source) => writeControl(source, { paused: true, reason: 'MONITOR_FAILURE', actor: null })) } catch { /* Missing/unavailable controls fail closed at admission reads. */ }
    return { control: { paused: true, reason_code: 'MONITOR_FAILURE' }, financial: { healthy: false, alerts: [{ code: 'ROUTE_MONITOR_UNAVAILABLE', count: 1, severity: 'critical' as const }] } }
  }
}

export async function setRouteControl(input: { paused: boolean; expectedRevision: number; actorUserId: string }) {
  if (!input.paused && process.env.CLAWDMARKET_ROUTE_EXECUTION_PAUSED === 'true') throw new RouteControlError('ENVIRONMENT_ROUTE_PAUSE')
  return transaction(async (source) => {
    const current = await getRouteControl(source)
    if (current.revision !== input.expectedRevision) throw new RouteControlError('ROUTE_CONTROL_REVISION_CHANGED')
    if (input.paused) return { control: await writeControl(source, { paused: true, reason: 'OPERATOR_PAUSE', actor: input.actorUserId }), financial: null }
    const financial = await inspectRouteFinancialHealth(source)
    if (!input.paused && !financial.healthy) throw new RouteControlError('ROUTE_FINANCIAL_UNCERTAINTY')
    return { control: await writeControl(source, { paused: input.paused, reason: 'OPERATOR_PAUSE', actor: input.actorUserId }, financial.healthy ? new Date() : undefined), financial }
  })
}
