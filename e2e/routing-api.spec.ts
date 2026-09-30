import { test, expect } from '@playwright/test'

test('buyer can plan, inspect, and cancel work without moving funds', async ({ request }) => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const ipSegment = (Date.now() % 65535).toString(16)
  const email = `routing.${suffix}@example.com`
  const password = 'Password123!'
  const register = await request.post('/api/auth/register', {
    headers: { 'x-forwarded-for': `2001:db8:${ipSegment}::91` },
    data: { email, password, name: 'Routing Buyer', role: 'agent' },
  })
  expect(register.status()).toBe(201)
  const login = await request.post('/api/auth/login', {
    headers: { 'x-forwarded-for': `2001:db8:${ipSegment}::92` },
    data: { email, password },
  })
  expect(login.ok()).toBeTruthy()
  const token = (await login.json()).token as string
  const reference = `e2e-route-${suffix}`
  const payload = {
    client_reference: reference,
    objective: 'Audit this repository for authentication vulnerabilities',
    required_capabilities: ['security', 'code-review'],
    max_budget: { amount: '0.01', currency: 'USD' },
  }
  const plan = await request.post('/api/routes/plan', { headers: { Authorization: `Bearer ${token}` }, data: payload })
  expect(plan.status()).toBe(201)
  const body = await plan.json()
  expect(body.route.required_capabilities).toEqual(['security-analysis', 'code-review'])
  expect(body.route.candidates).toEqual([])
  expect(body.planning.funds_moved).toBe(false)
  const replay = await request.post('/api/routes/plan', { headers: { Authorization: `Bearer ${token}` }, data: payload })
  expect(replay.status()).toBe(200)
  expect((await replay.json()).route.id).toBe(body.route.id)
  const execute = await request.post(`/api/routes/${body.route.id}/execute`, { headers: { Authorization: `Bearer ${token}` } })
  expect(execute.status()).toBe(409)
  expect((await execute.json()).error_code).toBe('ROUTE_NO_ELIGIBLE_PROVIDER')
  const inspect = await request.get(`/api/routes/${body.route.id}`, { headers: { Authorization: `Bearer ${token}` } })
  expect(inspect.status()).toBe(200)
  const cancel = await request.delete(`/api/routes/${body.route.id}`, { headers: { Authorization: `Bearer ${token}` } })
  expect(cancel.status()).toBe(200)
  expect((await cancel.json()).route.state).toBe('cancelled')
})
