import { test, expect } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

test('a closed backed cycle removes registry proof while agents remain discoverable and graph identities stay private', async ({ page, request }) => {
  const suffix = crypto.randomUUID().replaceAll('-', '')
  const agents = []
  for (let i = 0; i < 3; i++) {
    const response = await request.post('/api/agents/register', { headers: { 'x-forwarded-for': `2001:db8:${(Date.now() % 65536).toString(16)}::${i + 110}` },
      data: { name: `cycle${i}${suffix}`, activation_mode: 'autonomous', capabilities: ['code-review'] } })
    expect(response.status()).toBe(201)
    agents.push((await response.json()).agent)
  }
  const execute = promisify(execFile), ids = agents.map(({ id }) => id), target = agents[1]
  const fixture = (mode: string) => execute(process.execPath, ['--conditions=react-server', '--import', 'tsx', 'e2e/fixtures/capability-cycle.ts', mode, JSON.stringify(ids)], { env: { ...process.env }, timeout: 20000 })
  await fixture('open')
  const publicProof = async () => {
    const listed = await (await request.get(`/api/agents/list?verified=true&search=${target.name}&limit=1`)).json()
    const searched = await (await request.get(`/api/agents/search?verified=true&q=${target.name}&limit=1`)).json()
    expect(listed.total).toBe(listed.agents.length); expect(searched.total).toBe(listed.total)
    return listed.total
  }
  expect(await publicProof()).toBe(1)
  await page.goto('/registry')
  await page.getByRole('textbox', { name: 'Filter agents by name or capability' }).fill(target.name)
  await page.getByRole('button', { name: 'With completed work proof', exact: true }).click()
  await expect(page.getByRole('heading', { name: target.name, exact: true })).toBeVisible()
  expect(JSON.parse((await fixture('close')).stdout).settled).toBe(true)
  expect(await publicProof()).toBe(0)
  const profile = await (await request.get(`/api/agents/${target.id}/trust`)).json()
  expect(profile.capability_performance).toEqual([])
  for (const id of [agents[0].id, agents[2].id]) expect(JSON.stringify(profile)).not.toContain(id)
  const manifest = await (await request.get('/.well-known/clawdmarket.json')).json()
  expect(manifest.capability_evidence.circular_trade_policy.max_cycle_length).toBe(4)
  expect(manifest.capability_evidence.independence).toBe('not_verified')
  await page.reload()
  await page.getByRole('textbox', { name: 'Filter agents by name or capability' }).fill(target.name)
  await page.getByRole('button', { name: 'With completed work proof', exact: true }).click()
  await expect(page.getByRole('heading', { name: target.name, exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'With completed work proof', exact: true }).click()
  await expect(page.getByRole('heading', { name: target.name, exact: true })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})
