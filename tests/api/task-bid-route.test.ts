import test from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/tasks/[id]/bid/route'
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

 await client.execute({
  sql: `CREATE TABLE IF NOT EXISTS bids (
   id text PRIMARY KEY NOT NULL,
   task_id text NOT NULL,
   bidder_agent_id text NOT NULL,
   price_usd real NOT NULL,
   message text,
   eta_seconds integer,
   status text NOT NULL DEFAULT 'pending',
   created_at text NOT NULL DEFAULT (datetime('now'))
  )`,
  args: [],
 })
}

async function cleanup(ids: { agentId?: string, apiKey?: string, taskId?: string }) {
 if (ids.taskId) {
  await client.execute({ sql: `DELETE FROM bids WHERE task_id = ?`, args: [ids.taskId] }).catch(() => {})
  await client.execute({ sql: `DELETE FROM tasks WHERE id = ?`, args: [ids.taskId] }).catch(() => {})
 }
 if (ids.agentId || ids.apiKey) {
  await client.execute({
   sql: `DELETE FROM agents WHERE id = ? OR api_key = ?`,
   args: [ids.agentId || '', ids.apiKey || ''],
  }).catch(() => {})
 }
}

async function seedAgentAndTask(agentId: string, apiKey: string, taskId: string) {
 await cleanup({ agentId, apiKey, taskId })
 await client.execute({
  sql: `INSERT INTO agents (
   id, name, description, capabilities, endpoint, owner_address, api_key, status, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  args: [
   agentId,
   'Bid Test Agent',
   'Test agent for authenticated task bidding.',
   JSON.stringify(['web-research']),
   'https://agent.example.test',
   'test-owner',
   apiKey,
   'active',
   Date.now(),
  ],
 })
 await client.execute({
  sql: `INSERT INTO tasks (
   id, poster_agent_id, title, description, required_capabilities,
   budget_usd, task_type, status, created_at, expires_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now', '+1 day'))`,
  args: [
   taskId,
   'agent_task_owner',
   'Authenticated bid regression task',
   'Regression task for agent API key bidding.',
   JSON.stringify(['web-research']),
   0.25,
   'general',
   'open',
  ],
 })
}

function bidRequest(taskId: string, body: any, apiKey?: string) {
 return new NextRequest(`http://localhost/api/tasks/${taskId}/bid`, {
  method: 'POST',
  headers: {
   'content-type': 'application/json',
   ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
  },
  body: JSON.stringify(body),
 })
}

test('POST /api/tasks/:id/bid creates a bid for the authenticated agent API key', async (t) => {
 await ensureSchema()
 const suffix = crypto.randomUUID()
 const agentId = `agent_bid_${suffix}`
 const apiKey = `clawd_bid_${suffix}`
 const taskId = `task_bid_${suffix}`
 t.after(() => cleanup({ agentId, apiKey, taskId }))
 await seedAgentAndTask(agentId, apiKey, taskId)

 const res = await POST(
  bidRequest(taskId, { price_usd: 0.2, message: 'Ready to research.', eta_seconds: 5400 }, apiKey),
  { params: Promise.resolve({ id: taskId }) }
 )
 assert.equal(res.status, 200)

 const body = await res.json()
 assert.equal(body.ok, true)
 assert.equal(body.bidder_agent_id, agentId)

 const result = await client.execute({
  sql: `SELECT bidder_agent_id, price_usd, message, eta_seconds FROM bids WHERE id = ? LIMIT 1`,
  args: [body.bid_id],
 })
 const bid = result.rows[0]
 assert.equal(bid.bidder_agent_id, agentId)
 assert.equal(bid.price_usd, 0.2)
 assert.equal(bid.message, 'Ready to research.')
 assert.equal(bid.eta_seconds, 5400)
})

test('POST /api/tasks/:id/bid rejects an invalid agent API key', async (t) => {
 await ensureSchema()
 const suffix = crypto.randomUUID()
 const agentId = `agent_bid_${suffix}`
 const apiKey = `clawd_bid_${suffix}`
 const taskId = `task_bid_${suffix}`
 t.after(() => cleanup({ agentId, apiKey, taskId }))
 await seedAgentAndTask(agentId, apiKey, taskId)

 const res = await POST(
  bidRequest(taskId, { price_usd: 0.2 }, 'clawd_invalid_key'),
  { params: Promise.resolve({ id: taskId }) }
 )

 assert.equal(res.status, 401)
 const body = await res.json()
 assert.equal(body.error, 'unauthorized')
})

test('POST /api/tasks/:id/bid does not create anonymous bids without auth or payment', async (t) => {
 await ensureSchema()
 const suffix = crypto.randomUUID()
 const agentId = `agent_bid_${suffix}`
 const apiKey = `clawd_bid_${suffix}`
 const taskId = `task_bid_${suffix}`
 t.after(() => cleanup({ agentId, apiKey, taskId }))
 await seedAgentAndTask(agentId, apiKey, taskId)

 const res = await POST(
  bidRequest(taskId, { price_usd: 0.2, message: 'No auth should not bid.' }),
  { params: Promise.resolve({ id: taskId }) }
 )

 assert.equal(res.status, 402)
 const body = await res.json()
 assert.equal(body.error, 'payment_required')

 const result = await client.execute({
  sql: `SELECT COUNT(*) AS count FROM bids WHERE task_id = ? AND bidder_agent_id = 'anonymous'`,
  args: [taskId],
 })
 assert.equal(Number(result.rows[0].count), 0)
})
