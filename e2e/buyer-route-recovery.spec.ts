import { test, expect, type APIRequestContext } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createPublicClient, createWalletClient, erc20Abi, http, type Address } from 'viem'
import { mainnet } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { evmPaymentProofMessage } from '../lib/evm-payment-message.mjs'
test.setTimeout(90_000)
async function setup(request: APIRequestContext) {
  const id = crypto.randomUUID()
  const fixture = (mode: string, service?: string) => promisify(execFile)(process.execPath,
    ['--conditions=react-server','--import','tsx','e2e/fixtures/buyer-route-recovery.ts',mode,id,...(service ? [service] : [])],
    { env: { ...process.env, JWT_SECRET: process.env.JWT_SECRET || 'clawdmarket-playwright-jwt-secret' }, timeout: 20_000 })
  const accounts = JSON.parse((await fixture('setup')).stdout), headers = { Authorization: `Bearer ${accounts.buyerKey}` }
  async function plan() {
    const response = await request.post('/api/routes/plan', { headers, data: { client_reference: `buyer-ui-${crypto.randomUUID()}`,
      objective: 'Review this original private repository for buyer recovery', input: { private_text: 'BUYER_ROUTE_PRIVATE_INPUT' }, required_capabilities: ['code-review'],
      max_budget: { amount: '2.00', currency: 'USD' }, deadline_seconds: 300,
      payment_policy: { allowed_rails: ['evm'] }, provider_requirements: { approved_providers: [accounts.seller] }, retry_policy: { max_attempts: 2 } } })
    expect(response.status()).toBe(201); return (await response.json()).route
  }
  const route = await plan(), path = `/api/routes/${route.id}`
  const execute = async (target = path) => { const response = await request.post(target + '/execute', { headers }); expect(response.status()).toBe(201); return response.json() }
  return { ...accounts, route, path, fixture, headers, plan, execute }
}

test('buyer cancels the original plan once, recovers a lost committed response, and clears private access on account change', async ({ request, page, context }) => {
  const f = await setup(request)
  await context.addCookies([{ name: 'auth-token', value: f.buyerKey, url: 'http://localhost:3000' }, { name: 'csrf-token', value: 'route-recovery-csrf', url: 'http://localhost:3000' }])
  await page.goto('/dashboard?tab=route-recovery'); await page.getByLabel('Route ID').fill(f.route.id)
  await page.getByRole('link', { name: 'Open original route' }).click()
  const main = page.locator('main'), cancel = main.getByRole('button', { name: 'Cancel original unpaid reservation' })
  await expect(cancel).toBeDisabled(); await expect(main.getByText('No original checkout is recorded.', { exact: false })).toBeVisible()
  await main.getByText('Exact saved inputs, policies and provider choices', { exact: true }).click()
  await expect(main.getByText('BUYER_ROUTE_PRIVATE_INPUT', { exact: false })).toBeVisible()
  expect((await context.request.delete(f.path, { data: { expected_service_order_id: null } })).status()).toBe(403)
  let deletes = 0
  await page.route('**' + f.path, async route => {
    if (route.request().method() !== 'DELETE') return route.continue()
    deletes += 1; expect(route.request().postDataJSON()).toEqual({ expected_service_order_id: null })
    const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort('failed')
  })
  await main.getByRole('checkbox').check(); await cancel.focus(); await page.keyboard.press('Enter')
  await expect(main.getByRole('alert')).toContainText('response was lost'); expect(deletes).toBe(1)
  await expect(main.getByRole('heading', { name: 'Original route', exact: true })).toHaveCount(0)
  await page.unroute('**' + f.path); await main.getByRole('button', { name: 'Refresh original state' }).click()
  await expect(main.getByText(`Route ${f.route.id} · cancelled`, { exact: true })).toBeVisible(); await expect(cancel).toHaveCount(0)
  const replay = await request.delete(f.path, { headers: f.headers, data: { expected_service_order_id: null } }); expect(replay.status()).toBe(200); expect((await replay.json()).idempotent).toBe(true)
  expect(JSON.parse((await f.fixture('counts')).stdout)).toEqual({ orders: 0, trades: 0, capacity: 0 })
  await context.addCookies([{ name: 'auth-token', value: f.outsiderKey, url: 'http://localhost:3000' }])
  await main.getByRole('button', { name: 'Refresh original state' }).click()
  await expect(main.getByRole('alert')).toContainText('original buyer account'); await expect(main).not.toContainText('BUYER_ROUTE_PRIVATE_INPUT')
  await context.addCookies([{ name: 'auth-token', value: f.buyerKey, url: 'http://localhost:3000' }]); await page.reload()
  await expect(main.getByText(`Route ${f.route.id} · cancelled`, { exact: true })).toBeVisible()
  const registered = await request.post('/api/agents/register', { headers: { 'x-forwarded-for': `2001:db8:${(Date.now()%65535).toString(16)}::ba5` }, data: { name: `Route UI owned agent ${crypto.randomUUID().slice(0,8)}`, activation_mode: 'autonomous' } })
  expect(registered.status()).toBe(201); const agent = (await registered.json()).agent
  await f.fixture('link-agent',agent.id)
  const agentPlan = await request.post('/api/routes/plan', { headers: {Authorization:`Bearer ${agent.api_key}`}, data: {client_reference:`owned-route-${crypto.randomUUID()}`,objective:'Private agent route remains agent-owned',input:{private:'AGENT_ROUTE_PRIVATE_INPUT'},required_capabilities:['code-review'],max_budget:{amount:'1.00',currency:'USD'}} })
  expect(agentPlan.status()).toBe(201)
  const agentRouteId = (await agentPlan.json()).route.id
  await page.goto(`/routes/${agentRouteId}`)
  await expect(main.getByRole('alert')).toContainText('original buyer account'); await expect(main).not.toContainText('AGENT_ROUTE_PRIVATE_INPUT')
  await page.goto(`/routes/${agentRouteId}/review`)
  await expect(main.getByRole('alert')).toContainText('original buyer account'); await expect(main).not.toContainText('AGENT_ROUTE_PRIVATE_INPUT')
  await page.goto(`/routes/${f.route.id}`); await expect(main.getByText(`Route ${f.route.id} · cancelled`, { exact: true })).toBeVisible()
  await context.clearCookies(); await main.getByRole('button', { name: 'Refresh original state' }).click()
  await expect(main.getByRole('alert')).toContainText('original buyer account'); await expect(main.getByRole('heading', { name: 'Original route', exact: true })).toHaveCount(0)
})

test('a competing checkout cannot become the reviewed cancellation target; stale or unavailable inspection blocks commands', async ({ request, page, context }) => {
  const f = await setup(request)
  await context.addCookies([{ name: 'auth-token', value: f.buyerKey, url: 'http://localhost:3000' }, { name: 'csrf-token', value: 'route-recovery-csrf', url: 'http://localhost:3000' }])
  await page.goto(`/routes/${f.route.id}`); const main = page.locator('main'), cancel = main.getByRole('button', { name: 'Cancel original unpaid reservation' })
  await main.getByRole('checkbox').check()
  const original = await f.execute()
  await cancel.click(); await expect(main.getByRole('alert')).toContainText('original checkout changed')
  const unchanged = await request.get(f.path, { headers: f.headers }); expect((await unchanged.json()).route.service_order_id).toBe(original.order.id)
  expect(JSON.parse((await f.fixture('counts')).stdout)).toEqual({ orders: 1, trades: 1, capacity: 1 })
  await main.getByRole('button', { name: 'Refresh original state' }).click(); await expect(cancel).toBeDisabled()
  await page.clock.install(); await page.clock.fastForward(65_000); await expect(main.getByRole('alert')).toContainText('Inspection expired')
  await expect(cancel).toBeDisabled(); await page.clock.setSystemTime(new Date())
  let mutations = 0
  page.on('request', incoming => { if (incoming.url().includes(f.path) && incoming.method() === 'DELETE') mutations += 1 })
  await page.route('**' + f.path + '/retry', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"diagnostic":"PRIVATE_BUYER_DIAGNOSTIC"}' }))
  await main.getByRole('button', { name: 'Refresh original state' }).click(); await expect(main.getByRole('alert')).toContainText('inspection is unavailable')
  await expect(cancel).toHaveCount(0); await expect(main).not.toContainText('PRIVATE_BUYER_DIAGNOSTIC'); expect(mutations).toBe(0)
  await page.unroute('**' + f.path + '/retry'); await main.getByRole('button', { name: 'Refresh original state' }).click()
  await main.getByRole('checkbox').check(); await cancel.click(); await expect(main.getByRole('status')).toContainText('Original unpaid reservation cancelled')
  await expect(main.getByText('Payment exposure: late payment possible', { exact: true })).toBeVisible()
  expect(JSON.parse((await f.fixture('counts')).stdout)).toEqual({ orders: 1, trades: 1, capacity: 0 })
})

test('real dummy-chain late payment refunds the original checkout; funded work rejects cancellation and preserves original evidence on desktop/mobile', async ({ request, page, context }) => {
  test.skip(process.env.CLAWDMARKET_TEST_BUYER_ROUTE_CHAIN !== '1', 'Run guarded disposable buyer-route browser launcher for actual chain acceptance')
  const f = await setup(request), account = privateKeyToAccount(`0x${'77'.repeat(32)}`)
  const token = JSON.parse(process.env.EVM_ACCEPTED_TOKENS!)[0], wallet = createWalletClient({ chain: mainnet, account, transport: http(token.rpcUrl) })
  const chain = createPublicClient({ chain: mainnet, transport: http(token.rpcUrl) })
  const balance = () => chain.readContract({ address: token.address as Address, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] })
  const initial = await balance()
  await f.fixture('bump', f.route.candidates[0].service_id)
  const original = await f.execute(), tradePath = `/api/trades/${original.trade.id}/fund/evm`
  const created = await request.post(tradePath + '/intent', { headers: f.headers, data: { chain_id: 1, token_address: token.address, payer_address: account.address } })
  expect(created.status()).toBe(201); const intent = (await created.json()).intent
  const txHash = await wallet.writeContract({ address: token.address, abi: erc20Abi, functionName: 'transfer', args: [intent.treasury_address, BigInt(intent.token_amount)] })
  await chain.waitForTransactionReceipt({ hash: txHash })
  const body = { intent_id: intent.id, chain_id: 1, token_address: token.address, payer_address: account.address, tx_hash: txHash,
    payer_signature: await account.signMessage({ message: evmPaymentProofMessage(intent, txHash) }) }
  await context.addCookies([{ name: 'auth-token', value: f.buyerKey, url: 'http://localhost:3000' }, { name: 'csrf-token', value: 'route-recovery-csrf', url: 'http://localhost:3000' }])
  await page.goto(`/routes/${f.route.id}`); const main = page.locator('main')
  await expect(main.getByRole('heading', { name: 'Attempt 1', exact: true })).toBeVisible(); await expect(main.getByRole('heading', { name: 'Attempt 2', exact: true })).toBeVisible()
  await expect(main.getByText('Payment exposure: payment in flight possible', { exact: true })).toBeVisible()
  let cancellations = 0
  await page.route('**' + f.path, async route => {
    if (route.request().method() !== 'DELETE') return route.continue()
    cancellations += 1; expect(route.request().postDataJSON()).toEqual({expected_service_order_id:original.order.id})
    const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort('failed')
  })
  await main.getByRole('checkbox').check(); await main.getByRole('button', { name: 'Cancel original unpaid reservation' }).click()
  await expect(main.getByRole('alert')).toContainText('response was lost'); expect(cancellations).toBe(1)
  await page.unroute('**' + f.path); await main.getByRole('button', { name: 'Refresh original state' }).click()
  await expect(main.getByText('Payment exposure: late payment possible', { exact: true })).toBeVisible()
  const funded = await request.post(tradePath, { headers: f.headers, data: body }); expect(funded.status()).toBe(200); const refund = await funded.json(); expect(refund.status).toBe('late_payment_refunded')
  expect(await balance()).toBe(initial)
  const replay = await request.post(tradePath, { headers: f.headers, data: body }); expect(replay.status()).toBe(200); expect((await replay.json()).transfers[0].id).toBe(refund.transfers[0].id)
  await main.getByRole('button', { name: 'Refresh original state' }).click()
  await expect(main.getByText('Payment exposure: refunded', { exact: true })).toBeVisible()
  await expect(main.getByText(`Payment hash ${txHash}`, { exact: false })).toBeVisible(); await expect(main.getByText(`Transfer ${refund.transfers[0].id}`, { exact: false })).toBeVisible()
  const secondRoute = await f.plan(), second = await f.execute(`/api/routes/${secondRoute.id}`), secondPath = `/api/trades/${second.trade.id}/fund/evm`
  await page.goto(`/routes/${secondRoute.id}`); await main.getByRole('checkbox').check()
  const secondIntentResponse = await request.post(secondPath + '/intent', { headers: f.headers, data: { chain_id: 1, token_address: token.address, payer_address: account.address } }); expect(secondIntentResponse.status()).toBe(201)
  const secondIntent = (await secondIntentResponse.json()).intent
  const secondHash = await wallet.writeContract({ address: token.address, abi: erc20Abi, functionName: 'transfer', args: [secondIntent.treasury_address, BigInt(secondIntent.token_amount)] })
  await chain.waitForTransactionReceipt({ hash: secondHash })
  const paid = await request.post(secondPath, { headers: f.headers, data: { ...body, intent_id: secondIntent.id, tx_hash: secondHash, payer_signature: await account.signMessage({ message: evmPaymentProofMessage(secondIntent, secondHash) }) } }); expect(paid.status()).toBe(200)
  await main.getByRole('button', { name: 'Cancel original unpaid reservation' }).click(); await expect(main.getByRole('alert')).toContainText('funds were committed')
  await main.getByRole('button', { name: 'Refresh original state' }).click(); await expect(main.getByText('Work phase: funded', { exact: true })).toBeVisible()
  await expect(main.getByRole('button', { name: 'Cancel original unpaid reservation' })).toHaveCount(0)
  await expect(main.getByText(`Payment hash ${secondHash}`, { exact: false })).toBeVisible(); await expect(main.getByText('Capacity held', { exact: true })).toBeVisible()
  await page.evaluate(() => window.scrollTo(0,0)); await page.screenshot({ path: '/tmp/clawdmarket-route-recovery-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => window.scrollTo(0,0))
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: '/tmp/clawdmarket-route-recovery-mobile.png', fullPage: true })
  expect(await balance()).toBe(initial - BigInt(secondIntent.token_amount))
  expect(JSON.parse((await f.fixture('counts')).stdout)).toEqual({ orders: 2, trades: 2, capacity: 1 })
})
