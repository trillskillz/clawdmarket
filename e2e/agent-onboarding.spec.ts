import { expect, test } from '@playwright/test'

test.describe('registered-agent onboarding', () => {
  test('a human can activate an owner-claim registration in the browser', async ({ page, request }) => {
    const ownerEmail = `owner.${Date.now()}@example.test`
    const ownerPassword = 'Password123!'
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

    const accountRegistration = await page.request.post('/api/auth/register', {
      headers: { 'x-forwarded-for': `2001:db8:${(Date.now() % 65536).toString(16)}::92` },
      data: { email: ownerEmail, password: ownerPassword, name: 'Claim Owner', role: 'human' },
    })
    expect(accountRegistration.status()).toBe(201)
    const login = await page.request.post('/api/auth/login', {
      headers: { 'x-forwarded-for': `2001:db8:${(Date.now() % 65536).toString(16)}::93` },
      data: { email: ownerEmail, password: ownerPassword },
    })
    expect(login.ok()).toBeTruthy()

    await page.goto(new URL(registered.agent.claim_url).pathname)
    await expect(page.getByRole('heading', { name: 'Claim Your Agent' })).toBeVisible()
    await expect(page.getByLabel('Administrative contact email')).toHaveValue(ownerEmail)
    await expect(page.getByLabel('Administrative contact email')).toBeEditable({ editable: false })
    await page.getByRole('button', { name: 'Claim This Agent' }).click()
    await expect(page.getByRole('heading', { name: 'Agent Claimed!' })).toBeVisible()
    await expect(page.getByText(/linked for credential recovery and guarded ownership transfer/)).toBeVisible()

    const ownership = await page.request.get('/api/agents/ownership')
    expect(ownership.ok()).toBeTruthy()
    const ownedAgents = (await ownership.json()).owned_agents
    expect(ownedAgents.some((agent: { agent_id: string }) => agent.agent_id === registered.agent.id)).toBe(true)

    await page.goto('/dashboard?tab=wallet')
    const agentPayout = `0x${'72'.repeat(20)}`
    await page.getByLabel(`${registered.agent.name} payout address`).fill(agentPayout)
    await page.getByRole('button', { name: 'Save agent payout wallet' }).click()
    await expect(page.getByText('Agent payout wallet saved.')).toBeVisible()
    const savedPayout = await page.request.get(`/api/payments/payout-address?agent_id=${encodeURIComponent(registered.agent.id)}`)
    expect(savedPayout.ok()).toBeTruthy()
    expect((await savedPayout.json()).address).toBe(agentPayout)

    const status = await request.get('/api/agents/status', {
      headers: { 'X-Agent-API-Key': registered.agent.api_key },
    })
    expect(status.status()).toBe(200)
    expect((await status.json()).status).toBe('claimed')
  })
})
