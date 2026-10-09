import { test, expect } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

test('public reputation and marketplace ranking recheck buyer ownership and backing across worker processes', async ({ page, request }) => {
  const execute = promisify(execFile)
  const fixture = (mode: string, state?: unknown) => execute(process.execPath, ['--conditions=react-server', '--import', 'tsx', 'e2e/fixtures/reputation.ts', mode, JSON.stringify(state ?? null)], { env: { ...process.env }, timeout: 20000 })
  const state = JSON.parse((await fixture('seed')).stdout)
  const profile = async () => {
    const response = await request.get(`/api/agents/${state.good}`)
    expect(response.status()).toBe(200)
    return response.json()
  }
  const original = await profile()
  expect(original.rating_count).toBe(1); expect(original.avg_rating).toBe(2)
  expect(original.trust_components.distinctBuyerCount).toBe(1)
  expect(original.ratings).toHaveLength(1)
  for (const sort of ['recommended', 'trust_desc']) {
    const result = await (await request.get(`/api/listings?search=${state.tag}&payment_ready=true&sort=${sort}&limit=1`)).json()
    expect(result.total).toBe(2); expect(result.listings[0].agent_id).toBe(state.good)
    expect(result.listings[0].seller_rating_count).toBe(1)
  }
  await page.goto(`/registry/${state.good}`)
  await expect(page.getByRole('heading', { name: state.name, exact: true })).toBeVisible()
  await expect(page.getByText(/Confidence describes history breadth/)).toBeVisible()
  await fixture('unlink', state)
  const independentAccounts = await profile()
  expect(independentAccounts.rating_count).toBe(2); expect(independentAccounts.avg_rating).toBe(3)
  expect(independentAccounts.trust_confidence).toBe('low')
  const trust = await (await request.get(`/api/agents/${state.good}/trust`)).json()
  expect(trust.evidence.buyer_independence).toBe('not_verified')
  expect(trust.evidence.measured_quality_score).toBeNull()
  for (const id of [state.buyer, state.alias]) expect(JSON.stringify(trust)).not.toContain(id)
  await fixture('invalidate', state)
  const invalidated = await profile()
  expect(invalidated.rating_count).toBe(0); expect(invalidated.completed_trades).toBe(0)
  expect(invalidated.total_volume).toBe(0)
  expect(invalidated.ratings).toEqual([])
  for (const path of [`/api/agents/list?search=${state.name}`, `/api/agents/search?q=${state.name}`]) {
    const directory = await (await request.get(path)).json()
    expect(directory.agents[0].rating_count).toBe(0)
  }
  await page.reload()
  await expect(page.getByText('No verified reviews yet.')).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  const manifest = await (await request.get('/.well-known/clawdmarket.json')).json()
  expect(manifest.marketplace_reputation.confidence_scope).toBe('marketplace_history_breadth')
  await page.goto('/marketplace')
  await expect(page.getByLabel('PAYMENT READINESS')).toHaveValue('ready')
})
