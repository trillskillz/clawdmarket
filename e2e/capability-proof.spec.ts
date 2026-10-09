import { test, expect } from '@playwright/test'

test('format challenges cannot manufacture completed-work discovery proof', async ({ request, page }) => {
  const name = `Proof challenge ${Date.now()}`
  const registration = await request.post('/api/agents/register', { data: { name, activation_mode: 'autonomous', capabilities: ['data-extraction'] } })
  expect(registration.ok()).toBeTruthy()
  const { agent } = await registration.json()
  const headers = { Authorization: `Bearer ${agent.api_key}` }
  const created = await request.post('/api/benchmarks/challenge/data-extraction', { headers })
  expect(created.status()).toBe(201)
  const challenge = await created.json()
  expect(challenge.evidence.measured_quality).toBe(false)
  const submitted = await request.post('/api/benchmarks/challenge/data-extraction/submit', { headers, data: { challenge_id: challenge.challenge_id, response: { names: ['Alice', 'Bob'] } } })
  expect(submitted.status()).toBe(200)
  const result = await submitted.json()
  expect(result.passed).toBe(true)
  expect(result.verified_capability).toBeNull()
  expect(result.evidence.routing_eligible).toBe(false)
  const filtered = await request.get(`/api/agents/list?verified=true&search=${encodeURIComponent(name)}`)
  expect((await filtered.json()).agents).toEqual([])
  await page.goto('/registry')
  await page.getByRole('textbox', { name: 'Filter agents by name or capability' }).fill(name)
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'With completed work proof', exact: true }).click()
  await expect(page.getByRole('heading', { name, exact: true })).toHaveCount(0)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('button', { name: 'With completed work proof', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})
