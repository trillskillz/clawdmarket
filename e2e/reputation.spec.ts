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
  expect(original.reputation_v2.projection_status).toBe('current')
  expect(original.reputation_v2.breadth.observed_buyer_groups).toBe(1)
  expect(original.reputation_v2.satisfaction.mean).toBeCloseTo(3,1)
  expect(original.reputation_v2.delivery.weighted_model_estimate).toBeNull() // Legacy fixture has no verifiable terminal date.
  expect(JSON.stringify(original.ratings)).not.toContain(state.buyer)
  expect(original.ratings).toHaveLength(1)
  for (const sort of ['recommended', 'trust_desc']) {
    const result = await (await request.get(`/api/listings?search=${state.tag}&payment_ready=true&sort=${sort}&limit=1`)).json()
    expect(result.total).toBe(2); expect(result.listings[0].agent_id).toBe(state.good)
    expect(result.listings[0].seller_rating_count).toBe(1)
  }
  await page.goto(`/registry/${state.good}`)
  await expect(page.getByRole('heading', { name: state.name, exact: true })).toBeVisible()
  await expect(page.getByText('Buyer independence is unverified.',{exact:false})).toBeVisible()
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
  await expect(page.getByText('No eligible reviews yet.')).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  const manifest = await (await request.get('/.well-known/clawdmarket.json')).json()
  expect(manifest.marketplace_reputation.confidence_scope).toBe('marketplace_history_breadth')
  await page.goto('/marketplace')
  await expect(page.getByLabel('PAYMENT READINESS')).toHaveValue('ready')
})


test('private review corrects a rejected request, appends a finding and permits the original seller appeal without changing money',async({page,context,request})=>{
 const execute=promisify(execFile),state=JSON.parse((await execute(process.execPath,['--conditions=react-server','--import','tsx','e2e/fixtures/reputation.ts','private-seed'],{env:{...process.env,JWT_SECRET:process.env.JWT_SECRET||'clawdmarket-playwright-jwt-secret'},timeout:20000})).stdout)
 const cookies=(token:string)=>[{name:'auth-token',value:token,url:'http://localhost:3000',httpOnly:true},{name:'csrf-token',value:'local-browser-csrf',url:'http://localhost:3000'}]
 await context.addCookies(cookies(state.adminToken))
 await page.goto(`/trades/${state.trade}/reputation`)
 await expect(page.getByRole('heading',{name:'Administrator decision'})).toBeVisible()
 await page.getByLabel('Responsibility').selectOption('provider')
 await page.getByRole('combobox',{name:'Finding',exact:true}).selectOption('upheld')
 await page.getByRole('button',{name:'Append reviewed decision'}).click()
 await expect(page.locator('main').getByRole('alert')).toHaveText('INVALID_REPUTATION_DECISION') // Invalid provider reason is rejected before a write.
 await page.getByRole('combobox',{name:'Finding',exact:true}).selectOption('upheld')
 await page.getByRole('combobox',{name:'Reason',exact:true}).selectOption('provider_nonperformance')
 await page.getByRole('button',{name:'Append reviewed decision'}).click()
 await expect(page.getByText('upheld · provider',{exact:true})).toBeVisible()
 await context.addCookies(cookies(state.sellerToken));await page.reload()
 await expect(page.getByRole('heading',{name:'Administrator decision'})).toHaveCount(0)
 await page.getByRole('button',{name:'Appeal original finding'}).click()
 await expect(page.getByText('appealed · provider',{exact:true})).toBeVisible()
 const history=await (await request.get(`/api/trades/${state.trade}/reputation`,{headers:{Authorization:`Bearer ${state.sellerToken}`}})).json()
 expect(history.decisions).toHaveLength(2);expect(history.permissions.can_append_decision).toBe(false)
 await page.setViewportSize({width:390,height:844})
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})
