import { test, expect } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

test('built app enforces owner department ceilings and keeps original attribution after agent reassignment', async ({ request, page }) => {
  const registered = await request.post('/api/agents/register', { headers: { 'x-forwarded-for': `2001:db8:${(Date.now() % 65535).toString(16)}::b53` },
    data: { name: `Department HTTP ${crypto.randomUUID().slice(0, 8)}`, activation_mode: 'autonomous', capabilities: ['code-review'] } })
  expect(registered.status()).toBe(201)
  const agent = (await registered.json()).agent
  const fixture = (mode: string) => promisify(execFile)(process.execPath, ['--conditions=react-server', '--import', 'tsx', 'e2e/fixtures/workflow-approval.ts', mode, agent.id],
    { env: { ...process.env, JWT_SECRET: process.env.JWT_SECRET || 'clawdmarket-playwright-jwt-secret' }, timeout: 20000 })
  const owner = JSON.parse((await fixture('owners')).stdout), provider = JSON.parse((await fixture('service')).stdout)
  const ownerHeaders = { Authorization: `Bearer ${owner.owner_key}` }, buyerHeaders = { Authorization: `Bearer ${agent.api_key}` }
  const created = await request.post('/api/organizations', { headers: ownerHeaders, data: { client_reference: crypto.randomUUID(), name: 'Private department controls' } })
  expect(created.status()).toBe(201)
  const id = (await created.json()).organization.id, teams: string[] = []
  for (const slug of ['engineering', 'research']) {
    const team = await request.post(`/api/organizations/${id}/teams`, { headers: ownerHeaders, data: { slug, name: slug } })
    expect(team.status()).toBe(201); teams.push((await team.json()).team.id)
  }
  const assign = (team_id: string) => request.put(`/api/organizations/${id}/agents`, { headers: ownerHeaders,
    data: { agent_id: agent.id, team_id, cost_center: team_id === teams[0] ? 'ENGINEERING' : 'RESEARCH' } })
  expect((await assign(teams[0])).status()).toBe(200)
  const path = `/api/organizations/${id}/teams/${teams[0]}/budget`, body = { expected_version: 0, max_per_execution: '1.00', max_daily: '1.00', max_monthly: '3.00' }
  expect((await request.put(path, { headers: buyerHeaders, data: body })).status()).toBe(401)
  expect((await request.get(path, { headers: { Authorization: `Bearer ${owner.outsider_key}` } })).status()).toBe(404)
  const saved = await request.put(path, { headers: ownerHeaders, data: body }); expect(saved.status()).toBe(200)
  expect((await saved.json()).budget.version).toBe(1)
  const order = { client_reference: crypto.randomUUID(), objective: 'Privately review code within the department allowance', input: {}, payment_rail: 'evm', max_total: '1.00' }
  const first = await request.post(`/api/services/${provider.service}/orders`, { headers: buyerHeaders, data: order })
  expect(first.status(), await first.text()).toBe(201)
  const original = await first.json()
  const blocked = await request.post(`/api/services/${provider.service}/orders`, { headers: buyerHeaders, data: { ...order, client_reference: crypto.randomUUID() } })
  expect(blocked.status()).toBe(409); expect((await blocked.json()).error_code).toBe('TEAM_DAILY_LIMIT')
  const replay = await request.post(`/api/services/${provider.service}/orders`, { headers: buyerHeaders, data: order })
  expect(replay.status()).toBe(200); expect((await replay.json()).trade.id).toBe(original.trade.id)
  expect((await request.delete(`/api/organizations/${id}/agents`, { headers: ownerHeaders, data: { agent_id: agent.id } })).status()).toBe(200)
  expect((await assign(teams[1])).status()).toBe(200)
  await page.goto('/activity')
  const report = await page.evaluate(async ({ path, key }) => {
    const response = await fetch(path, { headers: { Authorization: `Bearer ${key}` } })
    return { status: response.status, cache: response.headers.get('cache-control'), value: await response.json() }
  }, { path, key: owner.owner_key })
  expect(report.status).toBe(200); expect(report.cache).toContain('private, no-store')
  expect(report.value.usage.reserved_or_spent_today).toBe('1.00')
  const newTeam = await request.get(`/api/organizations/${id}/teams/${teams[1]}/budget`, { headers: ownerHeaders })
  expect((await newTeam.json()).usage.reserved_or_spent_today).toBe('0.00')
  expect(JSON.parse((await fixture('counts')).stdout)).toEqual({ approvals: 0, orders: 1, trades: 1 })
})
