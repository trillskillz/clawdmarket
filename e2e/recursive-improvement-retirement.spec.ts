import { expect, test } from '@playwright/test'

test('retired APIs and contracts reject replacement commands without changing normal registration', async ({ request }) => {
  const registration = await request.post('/api/agents/register', {
    headers: { 'x-forwarded-for': '2001:db8:113::1' },
    data: { name: 'Retired replacement', parent_version_id: 'historical-agent' },
  })
  expect(registration.status()).toBe(410)
  expect((await registration.json()).error).toBe('recursive_improvement_removed')
  expect((await request.get('/api/agents/historical-agent/lineage')).status()).toBe(410)
  for (const metric of ['trainer', 'velocity']) expect((await request.get(`/api/leaderboard?metric=${metric}`)).status()).toBe(410)
  const stats = await (await request.get('/api/stats')).json()
  expect(stats.self_improvement_supported).toBe(false)
  expect(stats.versioning_supported).toBe(false)
  const paths = (await (await request.get('/api/docs')).json()).paths
  const properties = paths['/api/agents/register'].post.requestBody.content['application/json'].schema.properties
  for (const retired of ['parent_version_id', 'change_description', 'improvement_task_id']) expect(properties).not.toHaveProperty(retired)
  const capabilities = JSON.stringify(await (await request.get('/api/capabilities')).json())
  expect(capabilities).not.toContain('agent-improvement')
})

for (const width of [1440, 390]) {
  test(`current pages omit recursive panels and actions even with legacy profile data at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await page.route('**/api/agents/retirement-legacy', route => route.fulfill({ json: {
      id: 'retirement-legacy', name: 'Legacy profile', status: 'active', profile_kind: 'registered_agent',
      capabilities: ['code-review'], active_listings: [], ratings: [], recent_trades: [],
      benchmark_score: 88, velocity_score: 100, improvement_count: 50, total_improvement_delta: 900,
      improvements: [{ id: 'legacy', to_version: 99, delta: 900, change_description: 'RETIRED_REPLACEMENT_PANEL' }],
    } }))
    await page.goto('/registry/retirement-legacy')
    await expect(page.getByRole('heading', { name: 'Legacy profile', exact: true })).toBeVisible()
    await expect(page.getByText('Reported improvement.', { exact: true })).toHaveCount(0)
    await expect(page.getByText('RETIRED_REPLACEMENT_PANEL')).toHaveCount(0)
    await page.goto('/observe')
    await expect(page.getByRole('log', { name: 'Live activity feed' })).toBeVisible()
    await expect(page.getByText('RECURSIVE IMPROVEMENT', { exact: true })).toHaveCount(0)
    await page.goto('/taskboard')
    await expect(page.getByText('Improvement task', { exact: true })).toHaveCount(0)
    await expect(page.locator('option[value="self_improvement"]')).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  })
}
