import { test, expect } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ClawdMarketClient, ClawdMarketApiError } from '../sdk/typescript/src/index'

const execFileAsync = promisify(execFile)

test('both repository clients recover their original route through the actual authenticated app', async ({ request, page, baseURL }) => {
  const registered = await request.post('/api/agents/register', { data: { name: `SDK recovery ${Date.now()}`, activation_mode: 'autonomous' } })
  expect(registered.ok()).toBeTruthy()
  const registration = await registered.json()
  const key = registration.agent.api_key
  expect(typeof key).toBe('string')
  const client = new ClawdMarketClient({ apiKey: key, baseUrl: baseURL })
  const input = { client_reference: `sdk-ts-${Date.now()}`, objective: 'Review this isolated fixture for authentication issues', required_capabilities: ['security-analysis'], max_budget: { amount: '1.00', currency: 'USD' as const } }
  const planned = await client.planRoute(input)
  const replayed = await client.planRoute(input)
  expect(replayed.route.id).toBe(planned.route.id)
  expect(replayed.idempotent).toBe(true)
  expect((await client.getRoute(planned.route.id)).route.state).toBe('planned')
  expect((await client.listWebhooks()).webhooks).toEqual([])
  expect((await client.getWebhookDeliveries()).deliveries).toEqual([])
  await client.cancelRoute(planned.route.id)
  expect((await client.getRoute(planned.route.id)).route.state).toBe('cancelled')
  await expect(client.getBuyerMppPaymentIntent('00000000-0000-4000-8000-000000000999')).rejects.toBeInstanceOf(ClawdMarketApiError)

  const python = `
import os, json
from clawdmarket import ClawdMarketClient, ClawdMarketApiError
market = ClawdMarketClient(os.environ['CLAWDMARKET_TEST_KEY'], os.environ['CLAWDMARKET_TEST_ORIGIN'])
request = {'client_reference': os.environ['CLAWDMARKET_TEST_REFERENCE'], 'objective': 'Review this isolated Python recovery fixture', 'required_capabilities': ['security-analysis'], 'max_budget': {'amount': '1.00', 'currency': 'USD'}}
planned = market.plan_route(request)
replayed = market.plan_route(request)
assert replayed['idempotent'] and replayed['route']['id'] == planned['route']['id']
assert market.get_route(planned['route']['id'])['route']['state'] == 'planned'
assert market.list_webhooks()['webhooks'] == []
assert market.get_webhook_deliveries()['deliveries'] == []
market.cancel_route(planned['route']['id'])
assert market.get_route(planned['route']['id'])['route']['state'] == 'cancelled'
try:
    market.get_buyer_evm_payment_intent('00000000-0000-4000-8000-000000000999')
    raise AssertionError('Missing trade unexpectedly succeeded')
except ClawdMarketApiError as error:
    assert error.status == 404 and error.funds_state == 'unknown'
print(json.dumps({'original_reference_recovered': True, 'cancelled_without_checkout': True}))
`
  const result = await execFileAsync('python3', ['-c', python], { timeout: 30_000, env: { ...process.env,
    PYTHONPATH: `${process.cwd()}/sdk/python`, PYTHONDONTWRITEBYTECODE: '1',
    CLAWDMARKET_TEST_KEY: key, CLAWDMARKET_TEST_ORIGIN: baseURL!, CLAWDMARKET_TEST_REFERENCE: `sdk-python-${Date.now()}` } })
  expect(JSON.parse(result.stdout)).toEqual({ original_reference_recovered: true, cancelled_without_checkout: true })
  await page.goto('/proof')
  await expect(page.getByRole('heading', { name: 'Payment proofs', exact: true })).toBeVisible()
})
