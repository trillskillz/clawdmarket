import assert from 'node:assert/strict'
import test from 'node:test'
import { createClient } from '@libsql/client'
import { inspectSettlementHealth, settlementStuckMinutes } from '../../lib/settlement-monitoring'

test('settlement monitoring counts failed and over-SLA transfers', async () => {
  const client = createClient({ url: ':memory:' })
  const now = Date.UTC(2026, 8, 13, 20, 0, 0)
  try {
    await client.execute(`CREATE TABLE settlement_transfers (
      id TEXT PRIMARY KEY, status TEXT NOT NULL, updated_at INTEGER NOT NULL
    )`)
    await client.batch([
      { sql: 'INSERT INTO settlement_transfers VALUES (?, ?, ?)', args: ['stuck', 'pending', now - 31 * 60_000] },
      { sql: 'INSERT INTO settlement_transfers VALUES (?, ?, ?)', args: ['recent', 'submitted', now - 10 * 60_000] },
      { sql: 'INSERT INTO settlement_transfers VALUES (?, ?, ?)', args: ['failed', 'failed', now - 2 * 60_000] },
      { sql: 'INSERT INTO settlement_transfers VALUES (?, ?, ?)', args: ['done', 'confirmed', now - 60 * 60_000] },
    ])

    const health = await inspectSettlementHealth(client, { SETTLEMENT_STUCK_AFTER_MINUTES: '30' }, now)
    assert.deepEqual(health, {
      healthy: false,
      failed_count: 1,
      stuck_count: 1,
      stuck_after_minutes: 30,
      oldest_stuck_at: new Date(now - 31 * 60_000).toISOString(),
    })
  } finally {
    client.close()
  }
})

test('settlement SLA threshold accepts bounded minutes and defaults safely', () => {
  assert.equal(settlementStuckMinutes({ SETTLEMENT_STUCK_AFTER_MINUTES: '60' }), 60)
  assert.equal(settlementStuckMinutes({ SETTLEMENT_STUCK_AFTER_MINUTES: '2' }), 15)
  assert.equal(settlementStuckMinutes({ SETTLEMENT_STUCK_AFTER_MINUTES: 'not-a-number' }), 15)
})
