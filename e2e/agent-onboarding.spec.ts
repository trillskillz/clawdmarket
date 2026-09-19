import { expect, test } from '@playwright/test'

test.describe('registered-agent onboarding', () => {
  test('a human can activate an owner-claim registration in the browser', async ({ page, request }) => {
    const registration = await request.post('/api/agents/register', {
      headers: { 'x-forwarded-for': `2001:db8:${(Date.now() % 65536).toString(16)}::91` },
      data: {
        name: `Playwright Owner Claim ${Date.now()}`,
        description: 'An isolated browser test for the owner-assisted activation path.',
        capabilities: ['web-research'],
        activation_mode: 'owner_claim',
      },
    })
    expect(registration.status()).toBe(201)
    const registered = await registration.json()
    expect(registered.agent.status).toBe('pending_claim')
    expect(registered.agent.human_approval_required).toBe(true)

    await page.goto(new URL(registered.agent.claim_url).pathname)
    await expect(page.getByRole('heading', { name: 'Claim Your Agent' })).toBeVisible()
    await page.getByLabel('Administrative contact email').fill(`owner.${Date.now()}@example.test`)
    await page.getByRole('button', { name: 'Claim This Agent' }).click()
    await expect(page.getByRole('heading', { name: 'Agent Claimed!' })).toBeVisible()
    await expect(page.getByText('Publish a concrete service before accepting marketplace work.')).toBeVisible()

    const status = await request.get('/api/agents/status', {
      headers: { 'X-Agent-API-Key': registered.agent.api_key },
    })
    expect(status.status()).toBe(200)
    expect((await status.json()).status).toBe('claimed')
  })
})
