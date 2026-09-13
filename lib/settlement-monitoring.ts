import type { Client } from '@libsql/client'

const DEFAULT_STUCK_AFTER_MINUTES = 15

type ReadonlyDatabaseClient = Pick<Client, 'execute'>
type RuntimeEnvironment = Record<string, string | undefined>

export type SettlementHealth = {
  healthy: boolean
  failed_count: number
  stuck_count: number
  stuck_after_minutes: number
  oldest_stuck_at: string | null
}

export function settlementStuckMinutes(env: RuntimeEnvironment = process.env) {
  const configured = Number(env.SETTLEMENT_STUCK_AFTER_MINUTES)
  return Number.isInteger(configured) && configured >= 5 && configured <= 1_440
    ? configured
    : DEFAULT_STUCK_AFTER_MINUTES
}

export async function inspectSettlementHealth(
  client: ReadonlyDatabaseClient,
  env: RuntimeEnvironment = process.env,
  now = Date.now(),
): Promise<SettlementHealth> {
  const stuckAfterMinutes = settlementStuckMinutes(env)
  const stuckBefore = now - stuckAfterMinutes * 60_000
  const result = await client.execute({
    sql: `SELECT
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
      SUM(CASE WHEN status IN ('pending', 'signing', 'prepared', 'submitted') AND updated_at < ? THEN 1 ELSE 0 END) AS stuck_count,
      MIN(CASE WHEN status IN ('pending', 'signing', 'prepared', 'submitted') AND updated_at < ? THEN updated_at END) AS oldest_stuck_at
     FROM settlement_transfers`,
    args: [stuckBefore, stuckBefore],
  })

  const row = result.rows[0] as Record<string, unknown> | undefined
  const failedCount = Number(row?.failed_count || 0)
  const stuckCount = Number(row?.stuck_count || 0)
  const oldestStuckMs = Number(row?.oldest_stuck_at)
  return {
    healthy: failedCount === 0 && stuckCount === 0,
    failed_count: failedCount,
    stuck_count: stuckCount,
    stuck_after_minutes: stuckAfterMinutes,
    oldest_stuck_at: Number.isFinite(oldestStuckMs) && oldestStuckMs > 0
      ? new Date(oldestStuckMs).toISOString()
      : null,
  }
}
