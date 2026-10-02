import 'server-only'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { worker_heartbeats } from '@/lib/schema'

type WorkerEvent = 'started' | 'succeeded' | 'failed'

export async function recordWorkerHeartbeat(workerName: string, event: WorkerEvent, now = new Date()) {
  const field = event === 'started' ? 'last_started_at'
    : event === 'succeeded' ? 'last_succeeded_at' : 'last_failed_at'
  const last_outcome = event === 'started' ? undefined : event === 'succeeded' ? 'success' as const : 'failure' as const
  await db.insert(worker_heartbeats).values({ worker_name: workerName, [field]: now, last_outcome })
    .onConflictDoUpdate({ target: worker_heartbeats.worker_name, set: { [field]: now, ...(last_outcome ? { last_outcome } : {}) } })
}

export async function inspectWorkerHeartbeat(workerName: string, intervalMinutes: number, now = new Date()) {
  const [row] = await db.select().from(worker_heartbeats)
    .where(eq(worker_heartbeats.worker_name, workerName)).limit(1)
  const lastSuccess = row?.last_succeeded_at || null
  const lastFailure = row?.last_failed_at || null
  const stale = !lastSuccess || now.getTime() - lastSuccess.getTime() > intervalMinutes * 3 * 60_000
  const failedSinceSuccess = row?.last_outcome === 'failure'
  return {
    status: !row ? 'never_observed' : failedSinceSuccess ? 'failed' : stale ? 'stale' : 'healthy',
    last_started_at: row?.last_started_at?.toISOString() || null,
    last_succeeded_at: lastSuccess?.toISOString() || null,
    last_failed_at: lastFailure?.toISOString() || null,
  }
}
