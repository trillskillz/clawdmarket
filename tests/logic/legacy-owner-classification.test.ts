import test from 'node:test'
import assert from 'node:assert/strict'
import { createClient } from '@libsql/client'
import { inspectLegacyOwnerValues } from '../../lib/legacy-owner-classification.mjs'

test('legacy owner inventory partitions stored values without emitting any value', async () => {
  const client = createClient({ url: ':memory:' })
  const values = [
    '', ' ', 'owner@example.invalid', `0x${'a'.repeat(40)}`, `0x${'g'.repeat(40)}`,
    'https://provider.invalid/owner', '550e8400-e29b-41d4-a716-446655440000',
    'user_agent_123', 'agent:demo', 'anonymous', 'opaque-value-with-a-medium-length', 'x'.repeat(80),
    'userXagentX123', `0x${'A'.repeat(40)}`,
  ]
  try {
    await client.execute('CREATE TABLE agents (id TEXT PRIMARY KEY, owner_address TEXT NOT NULL, owner_email TEXT)')
    await client.execute('CREATE TABLE agent_owners (agent_id TEXT PRIMARY KEY)')
    await client.batch(values.map((value, index) => ({ sql: 'INSERT INTO agents (id, owner_address) VALUES (?, ?)', args: [`agent-${index}`, value] })))
    await client.execute("UPDATE agents SET owner_email = 'OWNER@example.invalid' WHERE id = 'agent-2'")
    await client.execute("INSERT INTO agent_owners (agent_id) VALUES ('agent-2'), ('agent-3'), ('agent-9')")
    const inventory = await inspectLegacyOwnerValues(client)
    assert.deepEqual(inventory, {
      total: 14, blank: 2, email_like: 1, evm_address: 2, url_like: 1, uuid_like: 1,
      agent_reference_like: 2, malformed_wallet_like: 1, opaque_short: 2, opaque_medium: 1, opaque_long: 1,
      evm_address_collision_groups: 1, evm_address_agents_in_collision: 2,
      linked_owner_by_category: {
        blank: 0, email_like: 1, evm_address: 1, url_like: 0, uuid_like: 0,
        agent_reference_like: 0, malformed_wallet_like: 0, opaque_short: 1,
        opaque_medium: 0, opaque_long: 0,
      },
      email_like_owner_email_matches: 1,
    })
    const serialized = JSON.stringify(inventory)
    for (const value of values.filter(Boolean)) assert.equal(serialized.includes(value), false)
  } finally { client.close() }
})
