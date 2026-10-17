export const AGENT_ONLINE_WINDOW_SECONDS = 180
export const AGENT_ACTIVITY_WRITE_INTERVAL_SECONDS = 60

export type AgentAvailability = 'online' | 'offline' | 'unknown' | 'inactive'
export type WorkerState = 'available' | 'busy' | 'stopped'
export const AGENT_WORKER_LEASE_SECONDS = 180

function lastSeenMilliseconds(value: unknown): number | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime()

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1000 : value
  }

  if (typeof value !== 'string' || !value.trim()) return null
  const numeric = Number(value)
  if (Number.isFinite(numeric)) return numeric < 10_000_000_000 ? numeric * 1000 : numeric
  const parsed = new Date(value).getTime()
  return Number.isNaN(parsed) ? null : parsed
}

export function getAgentAvailability(
  status: unknown,
  lastSeenAt: unknown,
  nowMilliseconds = Date.now(),
): AgentAvailability {
  if (status !== 'active') return 'inactive'
  const seenAt = lastSeenMilliseconds(lastSeenAt)
  if (seenAt === null) return 'unknown'
  return seenAt >= nowMilliseconds - (AGENT_ONLINE_WINDOW_SECONDS * 1000) ? 'online' : 'offline'
}

/** Explicit authenticated worker reports only. Ordinary API use and fleet cron
 * never create a worker lease. A self-report does not prove output quality. */
export function agentWorkerPresence(status: unknown, state: unknown, lastSeenAt: unknown, now = Date.now()) {
  const seen = lastSeenMilliseconds(lastSeenAt)
  const valid = state === 'available' || state === 'busy' || state === 'stopped'
  const fresh = seen !== null && seen <= now + 1000 && seen > now - AGENT_WORKER_LEASE_SECONDS * 1000
  const availability = status !== 'active' ? 'inactive' : !valid || seen === null ? 'never_checked_in'
    : state === 'stopped' ? 'stopped' : !fresh ? 'offline' : state
  return {
    state: availability,
    available: availability === 'never_checked_in' ? null : availability === 'available',
    last_heartbeat_at: seen === null ? null : new Date(seen).toISOString(),
    lease_expires_at: seen === null || state === 'stopped' ? null : new Date(seen + AGENT_WORKER_LEASE_SECONDS * 1000).toISOString(),
    lease_seconds: AGENT_WORKER_LEASE_SECONDS,
    source: 'authenticated_worker_self_report' as const,
  }
}
