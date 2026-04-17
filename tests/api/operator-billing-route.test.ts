import test from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import jwt from 'jsonwebtoken'

process.env.JWT_SECRET ||= 'operator-billing-test-secret'

test('GET /api/operator/billing summarizes quota usage and overage conversions', async (t) => {
  const [{ GET }, { db }, { ensureAgentUsageEventsTable }] = await Promise.all([
    import('@/app/api/operator/billing/route'),
    import('@/lib/db'),
    import('@/lib/agent-usage-policy'),
  ])
  const client = (db as any).$client
  await ensureAgentUsageEventsTable()
  const originalTaskLimit = process.env.CLAWDMARKET_FREE_AGENT_TASKS_PER_DAY
  process.env.CLAWDMARKET_FREE_AGENT_TASKS_PER_DAY = '1'

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
  await client.execute({
    sql: `CREATE TABLE IF NOT EXISTS tasks (
      id text PRIMARY KEY NOT NULL,
      poster_agent_id text NOT NULL,
      title text NOT NULL,
      description text NOT NULL,
      required_capabilities text NOT NULL DEFAULT '[]',
      budget_usd real NOT NULL,
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
    sql: `CREATE TABLE IF NOT EXISTS operator_settings (
      agent_id text PRIMARY KEY NOT NULL,
      daily_spend_cap real,
      created_at integer NOT NULL DEFAULT (unixepoch())
    )`,
    args: [],
  })

  const wallet = '0x1234567890abcdef1234567890abcdef12345678'
  const suffix = crypto.randomUUID()
  const agentId = `operator_billing_${suffix}`
  const now = new Date().toISOString()

  t.after(async () => {
    if (originalTaskLimit === undefined) {
      delete process.env.CLAWDMARKET_FREE_AGENT_TASKS_PER_DAY
    } else {
      process.env.CLAWDMARKET_FREE_AGENT_TASKS_PER_DAY = originalTaskLimit
    }
    await client.execute({ sql: `DELETE FROM agent_usage_events WHERE agent_id = ?`, args: [agentId] }).catch(() => {})
    await client.execute({ sql: `DELETE FROM bids WHERE bidder_agent_id = ?`, args: [agentId] }).catch(() => {})
    await client.execute({ sql: `DELETE FROM tasks WHERE poster_agent_id = ? OR id = ?`, args: [agentId, `task_${suffix}`] }).catch(() => {})
    await client.execute({ sql: `DELETE FROM listings WHERE seller_id = ?`, args: [`user_agent_${agentId}`] }).catch(() => {})
    await client.execute({ sql: `DELETE FROM operator_settings WHERE agent_id = ?`, args: [agentId] }).catch(() => {})
    await client.execute({ sql: `DELETE FROM agents WHERE id = ?`, args: [agentId] }).catch(() => {})
  })

  await client.execute({
    sql: `INSERT INTO agents (
      id, name, description, capabilities, endpoint, owner_address, api_key, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      agentId,
      'Operator Billing Test Agent',
      'Agent used for operator billing dashboard tests.',
      JSON.stringify(['api-integration']),
      'https://agent.example.test',
      wallet,
      `clawd_operator_billing_${suffix}`,
      'active',
      Date.now(),
    ],
  })
  await client.execute({
    sql: `INSERT INTO tasks (
      id, poster_agent_id, title, description, required_capabilities, budget_usd, created_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [`task_${suffix}`, agentId, 'Billing task', 'Task usage row', '[]', 0.25, now, now],
  })
  await client.execute({
    sql: `INSERT INTO bids (id, task_id, bidder_agent_id, price_usd, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [`bid_${suffix}`, `task_${suffix}`, agentId, 0.2, 'pending', now],
  })
  await client.execute({
    sql: `INSERT INTO listings (id, seller_id, category, title, description, price_bankr, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [`listing_${suffix}`, `user_agent_${agentId}`, 'analysis', 'Billing service', 'Service usage row', 0.1, 'active', Date.now()],
  })
  await client.execute({
    sql: `INSERT INTO agent_usage_events (
      id, agent_id, feature, event_type, route, payer, amount_usd, created_at
    ) VALUES
      (?, ?, 'task_posts', 'overage_challenge', 'POST /api/tasks', null, 0.001, ?),
      (?, ?, 'task_bids', 'overage_challenge', 'POST /api/tasks/:id/bid', null, 0.001, ?),
      (?, ?, 'task_bids', 'paid_conversion', 'POST /api/tasks/:id/bid', '0xpayer', 0.001, ?)`,
    args: [
      `event_challenge_task_${suffix}`, agentId, now,
      `event_challenge_bid_${suffix}`, agentId, now,
      `event_paid_bid_${suffix}`, agentId, now,
    ],
  })
  await client.execute({
    sql: `INSERT INTO operator_settings (agent_id, daily_spend_cap, created_at)
          VALUES (?, ?, unixepoch())`,
    args: [agentId, 0.001],
  })

  const token = jwt.sign(
    { userId: `wallet_user_${suffix}`, email: `wallet_${wallet}@wallet.local`, role: 'human' },
    process.env.JWT_SECRET as string,
    { expiresIn: '1h' },
  )

  const res = await GET(new NextRequest('http://localhost/api/operator/billing', {
    headers: { authorization: `Bearer ${token}` },
  }))

  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.operator_address, wallet)
  assert.equal(body.agent_count, 1)
  assert.equal(body.features.task_posts.used_today, 1)
  assert.equal(body.features.task_posts.free_limit, 1)
  assert.equal(body.features.task_bids.used_today, 1)
  assert.equal(body.features.service_listings.used_today, 1)
  assert.equal(body.overage.attempts_30d, 2)
  assert.equal(body.overage.paid_conversions_30d, 1)
  assert.equal(body.overage.revenue_24h_usd, 0.001)
  assert.equal(body.overage.revenue_30d_usd, 0.001)
  assert.ok(body.alerts.some((alert: any) => alert.code === 'quota_exhausted' && alert.feature === 'task_posts'))
  assert.ok(body.alerts.some((alert: any) => alert.code === 'overage_cap_exceeded'))
  assert.equal(body.trend_7d.length, 7)
  assert.ok(body.trend_7d.some((point: any) => (
    point.overage_attempts === 2 &&
    point.paid_conversions === 1 &&
    point.revenue_usd === 0.001
  )))
  assert.equal(body.agents[0].id, agentId)
  assert.equal(body.agents[0].quota.task_posts.used_today, 1)
  assert.equal(body.agents[0].overage.paid_conversions_30d, 1)
  assert.equal(body.agents[0].settings.daily_spend_cap_usd, 0.001)
  assert.ok(body.agents[0].alerts.length >= 2)

  const csvRes = await GET(new NextRequest('http://localhost/api/operator/billing?format=csv', {
    headers: { authorization: `Bearer ${token}` },
  }))
  assert.equal(csvRes.status, 200)
  assert.match(csvRes.headers.get('content-type') || '', /text\/csv/)
  const csv = await csvRes.text()
  assert.match(csv, /^agent_id,agent_name,status/)
  assert.match(csv, new RegExp(agentId))
  assert.match(csv, /quota_exhausted/)
  assert.match(csv, /overage_cap_exceeded/)
})
