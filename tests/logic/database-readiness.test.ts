import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createClient, type Client } from '@libsql/client'
import {
  inspectDatabaseSchema,
  REQUIRED_DATABASE_SCHEMA,
} from '../../lib/database-readiness'
import {
  inspectRuntimeConfiguration,
  requiresProductionReadiness,
} from '../../lib/runtime-readiness'

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`
}

async function withDatabase(
  mutateColumns: (table: string, columns: readonly string[]) => readonly string[],
  run: (client: Client) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), 'clawdmarket-readiness-test-'))
  const client = createClient({ url: `file:${join(directory, 'readiness.db')}` })
  try {
    for (const [table, expectedColumns] of Object.entries(REQUIRED_DATABASE_SCHEMA)) {
      const columns = mutateColumns(table, expectedColumns)
      if (columns.length === 0) continue
      const definitions = columns.map((column) => `${quoteIdentifier(column)} TEXT`)
      await client.execute(`CREATE TABLE ${quoteIdentifier(table)} (${definitions.join(', ')})`)
    }
    await run(client)
  } finally {
    client.close()
    await rm(directory, { recursive: true, force: true })
  }
}

test('database readiness accepts the complete critical schema', async () => {
  await withDatabase((_table, columns) => columns, async (client) => {
    const result = await inspectDatabaseSchema(client)
    assert.equal(result.ready, true)
    assert.deepEqual(result.missing_tables, [])
    assert.deepEqual(result.missing_columns, [])
  })
})

test('database readiness reports schema drift without changing the database', async () => {
  await withDatabase(
    (table, columns) => table === 'bids'
      ? columns.filter((column) => column !== 'counter_offer_status')
      : columns,
    async (client) => {
      const before = await client.execute('PRAGMA table_info("bids")')
      const result = await inspectDatabaseSchema(client)
      const after = await client.execute('PRAGMA table_info("bids")')

      assert.equal(result.ready, false)
      assert.deepEqual(result.missing_tables, [])
      assert.deepEqual(result.missing_columns, ['bids.counter_offer_status'])
      assert.equal(after.rows.length, before.rows.length)
    },
  )
})

test('production readiness requires the core runtime configuration', () => {
  const environment = { NODE_ENV: 'production', VERCEL_ENV: 'production' }
  assert.equal(requiresProductionReadiness(environment), true)

  const result = inspectRuntimeConfiguration(environment)
  assert.equal(result.ready, false)
  assert.deepEqual(result.missing, [
    'TURSO_DATABASE_URL',
    'JWT_SECRET',
    'CHAT_ENCRYPTION_KEY',
    'WEBHOOK_SECRET_KEY',
    'AGENT_API_KEY_PEPPER',
    'CRON_SECRET',
  ])
})

test('builds and local development do not enforce deployment readiness', () => {
  assert.equal(requiresProductionReadiness({
    NODE_ENV: 'production',
    VERCEL_ENV: 'production',
    NEXT_PHASE: 'phase-production-build',
  }), false)
  assert.deepEqual(inspectRuntimeConfiguration({ NODE_ENV: 'development' }), {
    ready: true,
    enforced: false,
    missing: [],
  })
})
