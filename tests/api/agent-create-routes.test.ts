import test from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { POST as postListing } from '@/app/api/listings/route'
import { POST as postTask } from '@/app/api/tasks/route'
import { db } from '@/lib/db'

const client = (db as any).$client

async function ensureSchema() {
  await client.execute({
    sql: `CREATE TABLE IF NOT EXISTS agents (
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      description text NOT NULL,
      capabilities text NOT NULL,
      endpoint text NOT NULL,
      owner_address text NOT NULL,
      api_key text NOT NULL,
      status text NOT NULL DEFAULT 'active',
      created_at integer NOT NULL
    )`,
    args: [],
  })
  await client.execute('ALTER TABLE agents ADD COLUMN api_key TEXT').catch(() => {})

  await client.execute({
    sql: `CREATE TABLE IF NOT EXISTS users (
      id text PRIMARY KEY NOT NULL,
      email text NOT NULL,
      password_hash text NOT NULL,
      name text NOT NULL,
      role text NOT NULL DEFAULT 'human',
      created_at integer NOT NULL
    )`,
    args: [],
  })

  await client.execute({
    sql: `CREATE TABLE IF NOT EXISTS api_keys (
      id text PRIMARY KEY NOT NULL,
      user_id text NOT NULL,
      key_hash text NOT NULL,
      key_prefix text NOT NULL,
      name text NOT NULL,
      last_used integer,
      created_at integer NOT NULL
    )`,
    args: [],
  })

  await client.execute({
    sql: `CREATE TABLE IF NOT EXISTS listings (
      id text PRIMARY KEY NOT NULL,
      seller_id text NOT NULL,
      category text NOT NULL,
      title text NOT NULL,
      description text NOT NULL,
      price_bankr real NOT NULL,
      status text NOT NULL DEFAULT 'active',
      created_at integer NOT NULL
    )`,
    args: [],
  })

  await client.execute({
    sql: `CREATE TABLE IF NOT EXISTS tasks (
      id text PRIMARY KEY NOT NULL,
      poster_agent_id text NOT NULL,
      title text NOT NULL,
      description text NOT NULL,
      required_capabilities text NOT NULL DEFAULT '[]',
      budget_usd real NOT NULL,
      deadline_at text,
      status text NOT NULL DEFAULT 'open',
      assigned_agent_id text,
      winning_bid_id text,
      task_type text NOT NULL DEFAULT 'general',
      subject_agent_id text,
      benchmark_id text,
      created_at text NOT NULL DEFAULT (datetime('now')),
      expires_at text NOT NULL DEFAULT (datetime('now', '+7 days'))
    )`,
    args: [],
  })
}

async function cleanup(agentId: string, apiKey: string) {
  await client.execute({ sql: `DELETE FROM tasks WHERE poster_agent_id IN (?, 'anonymous')`, args: [agentId] }).catch(() => {})
  await client.execute({ sql: `DELETE FROM listings WHERE seller_id = ?`, args: [`user_agent_${agentId}`] }).catch(() => {})
  await client.execute({ sql: `DELETE FROM users WHERE id = ?`, args: [`user_agent_${agentId}`] }).catch(() => {})
  await client.execute({ sql: `DELETE FROM agents WHERE id = ? OR api_key = ?`, args: [agentId, apiKey] }).catch(() => {})
}

async function seedAgent(agentId: string, apiKey: string) {
  await cleanup(agentId, apiKey)
  await client.execute({
    sql: `INSERT INTO agents (
      id, name, description, capabilities, endpoint, owner_address, api_key, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      agentId,
      'Agent Create Routes Test',
      'Test agent for authenticated write routes.',
      JSON.stringify(['api-integration', 'web-research']),
      'https://agent.example.test',
      'test-owner',
      apiKey,
      'active',
      Date.now(),
    ],
  })
}

function jsonRequest(path: string, body: any, apiKey?: string) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

test('POST /api/listings accepts a registered-agent API key and creates a service listing', async (t) => {
  await ensureSchema()
  const suffix = crypto.randomUUID()
  const agentId = `agent_create_${suffix}`
  const apiKey = `clawd_create_${suffix}`
  t.after(() => cleanup(agentId, apiKey))
  await seedAgent(agentId, apiKey)

  const res = await postListing(jsonRequest('/api/listings', {
    category: 'analysis',
    title: 'Agent Route Test Service',
    description: 'Authenticated registered-agent service listing created by the route test.',
    price_bankr: 0.25,
  }, apiKey))

  assert.equal(res.status, 201)
  const body = await res.json()
  assert.equal(body.seller_agent_id, agentId)
  assert.equal(body.listing.seller_id, `user_agent_${agentId}`)

  const userResult = await client.execute({
    sql: `SELECT id, role FROM users WHERE id = ? LIMIT 1`,
    args: [`user_agent_${agentId}`],
  })
  assert.equal(userResult.rows[0].role, 'agent')
})

test('POST /api/listings rejects an invalid registered-agent API key', async () => {
  await ensureSchema()
  const res = await postListing(jsonRequest('/api/listings', {
    category: 'analysis',
    title: 'Invalid Agent Service',
    description: 'This should not create a listing because the key is invalid.',
    price_bankr: 0.25,
  }, 'clawd_invalid_agent_key'))

  assert.equal(res.status, 401)
})

test('POST /api/tasks accepts a registered-agent API key and records poster_agent_id', async (t) => {
  await ensureSchema()
  const suffix = crypto.randomUUID()
  const agentId = `agent_create_${suffix}`
  const apiKey = `clawd_create_${suffix}`
  t.after(() => cleanup(agentId, apiKey))
  await seedAgent(agentId, apiKey)

  const res = await postTask(jsonRequest('/api/tasks', {
    title: 'Authenticated route test task',
    description: 'Task created by a registered agent API key in the route test.',
    required_capabilities: ['api-integration'],
    budget_usd: 0.25,
  }, apiKey))

  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.ok, true)
  assert.equal(body.poster_agent_id, agentId)

  const taskResult = await client.execute({
    sql: `SELECT poster_agent_id FROM tasks WHERE id = ? LIMIT 1`,
    args: [body.task_id],
  })
  assert.equal(taskResult.rows[0].poster_agent_id, agentId)
})

test('POST /api/tasks does not create anonymous tasks without auth or payment', async () => {
  await ensureSchema()

  const res = await postTask(jsonRequest('/api/tasks', {
    title: 'No-auth route test task',
    description: 'This request has no auth and should not become anonymous.',
    required_capabilities: ['api-integration'],
    budget_usd: 0.25,
  }))

  assert.equal(res.status, 402)
  const body = await res.json()
  assert.equal(body.error, 'payment_required')
})
