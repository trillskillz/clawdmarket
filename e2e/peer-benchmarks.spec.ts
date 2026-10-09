import { test, expect } from '@playwright/test'

test('peer benchmark recovery preserves evaluator authority and keeps test material private', async ({ request, page }) => {
  const suffix = Date.now()
  let registrationIndex = 1
  const register = async (name: string) => {
    const response = await request.post('/api/agents/register', {
      headers: { 'x-forwarded-for': `2001:db8:${(suffix % 65536).toString(16)}::${registrationIndex++}` },
      data: { name, activation_mode: 'autonomous', capabilities: ['data-analysis'] },
    })
    expect(response.status()).toBe(201)
    return (await response.json()).agent
  }
  const target = await register(`Peer target ${suffix}`)
  const evaluator = await register(`Peer evaluator ${suffix}`)
  const stranger = await register(`Peer stranger ${suffix}`)
  const auth = (agent: { api_key: string }) => ({ Authorization: `Bearer ${agent.api_key}` })
  const body = { agent_id: target.id, capability: 'analysis', test_input: 'PRIVATE_BROWSER_BENCHMARK_INPUT', client_reference: crypto.randomUUID() }
  const created = await request.post('/api/benchmarks', { headers: auth(evaluator), data: body })
  expect(created.status()).toBe(201)
  const original = await created.json()
  const replay = await request.post('/api/benchmarks', { headers: auth(evaluator), data: body })
  expect(replay.status()).toBe(200)
  expect((await replay.json()).benchmark_id).toBe(original.benchmark_id)
  const path = `/api/benchmarks/${original.benchmark_id}`
  expect((await request.get(path)).status()).toBe(404)
  expect((await request.get(path, { headers: auth(stranger) })).status()).toBe(404)
  const privateRead = await request.get(path, { headers: auth(target) })
  expect(privateRead.status()).toBe(200)
  expect(privateRead.headers()['cache-control']).toContain('private')
  expect(privateRead.headers()['cache-control']).toContain('no-store')
  expect((await privateRead.json()).benchmark.testInput).toBe(body.test_input)
  expect((await request.post(`${path}/score`, { headers: auth(stranger), data: { score: 100 } })).status()).toBe(404)
  const scored = await request.post(`${path}/score`, { headers: auth(evaluator), data: { score: 100, test_output: 'PRIVATE_BROWSER_OUTPUT', notes: 'PRIVATE_BROWSER_NOTES' } })
  expect(scored.status()).toBe(200)
  expect((await scored.json()).evidence.measured_quality_score).toBeNull()
  const publicRead = await request.get(`/api/benchmarks?agent_id=${target.id}`)
  const summary = await publicRead.json()
  expect(summary.benchmarks[0].score).toBe(100)
  expect(summary.benchmarks[0].evidence.independence).toBe('not_verified')
  expect(JSON.stringify(summary)).not.toContain('PRIVATE_BROWSER')
  const profile = await (await request.get(`/api/agents/${target.id}`)).json()
  expect(profile.benchmark_score).toBeNull()
  expect(profile.benchmark_evidence.measured_quality_score).toBeNull()
  await page.goto(`/registry/${target.id}`)
  await expect(page.getByRole('heading', { name: target.name, exact: true })).toBeVisible()
  await expect(page.getByText('Measured improvement.', { exact: true })).toHaveCount(0)
})
