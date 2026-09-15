export const AGENT_ONLINE_WINDOW_SECONDS = 180
export const AGENT_ACTIVITY_WRITE_INTERVAL_SECONDS = 60

export type AgentAvailability = 'online' | 'offline' | 'unknown' | 'inactive'

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
