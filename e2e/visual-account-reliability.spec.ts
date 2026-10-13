import { expect, test, type Page } from '@playwright/test'
import { sign } from 'jsonwebtoken'

const user = { id: 'visual-owner', name: 'Visual owner', email: 'visual@example.invalid', role: 'human' }
const partner = { id: 'visual-partner', name: `IndependentProvider${'Protocol'.repeat(9)}`, role: 'agent' }
const agentName = `ReviewProvider${'Capability'.repeat(8)}`
const credential = `cmk_${'0123456789abcdef'.repeat(4)}` // Public dummy fixture; never an actual credential.
const ratingError = `Rating could not be saved: ${'Unavailable'.repeat(12)}`
const trades = [
  { id: 'visual-delivery', listing_title: `PrivateReport${'Analysis'.repeat(9)}`, buyer_id: partner.id, buyer_name: partner.name, seller_id: user.id, amount: 100, fee: 5, status: 'escrow_held', payment_rail: 'credit', created_at: '2026-10-13T00:00:00Z' },
  { id: 'visual-rating', listing_title: 'Completed review', buyer_id: user.id, buyer_name: user.name, seller_id: partner.id, amount: 100, fee: 5, status: 'completed', payment_rail: 'credit', rated_by_caller: false, created_at: '2026-10-13T00:00:00Z' },
]

async function mockAccount(page: Page) {
  const token = sign({ userId: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET || 'clawdmarket-playwright-jwt-secret', { expiresIn: '1h' })
  await page.context().addCookies([{ name: 'auth-token', value: token, url: 'http://localhost:3000', httpOnly: true }])
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort())
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    let json: unknown = {}, status = 200
    if (path === '/api/auth/me') json = { authenticated: true, user }
    else if (path.startsWith('/api/admin/')) { status = 403; json = { error: 'Forbidden' } }
    else if (path === '/api/listings') json = { listings: [], total: 0 }
    else if (path === '/api/trades') json = { trades, total: trades.length }
    else if (path === '/api/ratings') {
      expect(route.request().method()).toBe('POST')
      expect(route.request().postDataJSON()).toEqual({ trade_id: 'visual-rating', score: 3, comment: '' })
      status = 503; json = { error: ratingError }
    }
    else if (path === '/api/contracts') json = { contracts: [], total: 0 }
    else if (path === '/api/auth/api-keys') json = { keys: [] }
    else if (path === '/api/webhooks') json = { webhooks: [] }
    else if (path === '/api/wallet') json = { balance: 0, escrow: 0, available: 0, transactions: [] }
    else if (path === '/api/wallet/deposits') {
      expect(route.request().method()).toBe('GET')
      json = { deposits: [] }
    }
    else if (path === '/api/analytics/summary') json = { range_days: 7, trade_by_status: { completed: 2, pending: 1, disputed: 0 }, listing_funnel: { active: 1, sold: 2, expired: 0, total: 3 }, api_key_summary: { total: 0, recently_used: 0, never_used: 0 }, analytics_events: { total: 2, by_type: { trade_completed: 2 }, trend: [{ date: '2026-10-13', count: 2 }] } }
    else if (path === '/api/claim') json = { agent_id: 'visual-agent', name: agentName, description: 'An independently operated provider with a bounded service contract.', capabilities: [`code-review-${'scope'.repeat(12)}`], already_claimed: false, created_at: '2026-10-13T00:00:00Z' }
    else if (path === '/api/agents/ownership/transfers/accept') {
      expect(route.request().method()).toBe('POST')
      expect(route.request().postDataJSON()).toEqual({ token: 'visual-transfer-only' })
      json = { agent_id: `agent_${'1234567890abcdef'.repeat(4)}`, credential: { api_key: credential } }
    } else if (path === '/api/messages') json = [partner]
    else if (path === `/api/messages/${partner.id}`) json = [{ id: 'visual-message', sender_id: user.id, receiver_id: partner.id, encrypted_content: 'dummy', nonce: 'dummy', created_at: '2026-10-13T12:34:00Z', content: JSON.stringify({ type: 'task_complete', trade_id: 'visual-delivery', summary: `Original completed report: ${'A'.repeat(100)}`, delivery_url: 'https://example.invalid/report' }) }]
    else if (path === '/api/payments/config') json = { account_credit_enabled: false, accepted_tokens: [] }
    else if (path === '/api/payments/payout-address') json = { address: null, owned_agents: [{ agent_id: 'visual-owned-agent', name: agentName, status: 'active', address: null }] }
    else { status = 404; json = { error: 'Not part of the visual fixture' } }
    await route.fulfill({ status, json })
  })
}

async function expectFits(page: Page) {
  await page.evaluate(() => document.fonts.ready)
  const actual = await page.evaluate(() => {
    const outside: string[] = [], small: string[] = []
    for (const element of document.querySelectorAll('body *')) {
      const bounds = element.getBoundingClientRect(), style = getComputedStyle(element)
      if (!bounds.width || !bounds.height || style.display === 'none' || style.visibility === 'hidden') continue
      const ownText = [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('').trim()
      if (!/[a-z]{2}/i.test(ownText)) continue
      if (parseFloat(style.fontSize) < 12) small.push(`${ownText.slice(0, 40)}: ${style.fontSize}`)
      if (bounds.left < -1 || bounds.right > innerWidth + 1) outside.push(ownText.slice(0, 40))
    }
    return { overflow: document.documentElement.scrollWidth - innerWidth, outside, small }
  })
  expect.soft(actual.overflow, 'document must fit the viewport').toBeLessThanOrEqual(1)
  expect.soft(actual.outside, 'meaningful text must stay within the viewport').toEqual([])
  expect.soft(actual.small, 'status and explanatory text must be readable').toEqual([])
}

for (const width of [320, 390, 1440]) {
  test(`claim, ownership and account text fit long values at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await mockAccount(page)
    await page.goto('/claim/visual-claim-only')
    await expect(page.getByRole('heading', { name: 'Claim Your Agent' })).toBeVisible()
    const email = page.getByLabel('Administrative contact email')
    await expect(email).toHaveValue(user.email)
    const appearance = await email.evaluate(element => {
      const title = document.querySelector('h1')!, primary = document.querySelector('button[type="submit"]')!
      return { size: parseFloat(getComputedStyle(element).fontSize), heading: getComputedStyle(title).fontFamily, background: getComputedStyle(primary).backgroundColor, color: getComputedStyle(primary).color }
    })
    expect.soft(appearance.size).toBeGreaterThanOrEqual(16)
    expect.soft(appearance.heading).toContain('Space Grotesk')
    expect.soft(appearance.background).toBe('rgb(255, 92, 53)')
    expect.soft(appearance.color).toBe('rgb(8, 10, 9)')
    await email.focus()
    expect.soft(parseFloat(await email.evaluate(element => getComputedStyle(element).outlineWidth))).toBeGreaterThanOrEqual(2)
    await expectFits(page)
    await testInfo.attach(`claim-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })

    await page.goto('/ownership/accept?token=visual-transfer-only')
    await page.getByRole('button', { name: 'Accept and rotate credentials' }).click()
    await expect(page.locator('code')).toHaveText(credential)
    await expectFits(page)
    await testInfo.attach(`ownership-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })

    await page.goto(`/dashboard/messages?partner=${partner.id}`)
    await expect(page.getByText('✓ Delivery submitted', { exact: true })).toBeVisible()
    await expectFits(page)
    const ownLink = page.getByRole('link', { name: 'Open deliverable' })
    expect.soft(await ownLink.evaluate(element => getComputedStyle(element).color)).toBe('rgb(8, 10, 9)')
    await testInfo.attach(`messages-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })

    await page.goto('/dashboard?tab=trades')
    await expect(page.getByText(trades[0].listing_title)).toBeVisible()
    await expectFits(page)
    if (width < 720) {
      const navigation = page.locator('main nav button')
      for (const button of await navigation.all()) expect.soft((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    }
    await page.goto('/dashboard?tab=wallet')
    const selector = page.getByRole('region', { name: 'Agent account credit', exact: true }).getByRole('combobox')
    await expect(selector.getByRole('option', { name: agentName, exact: true })).toBeAttached()
    await selector.selectOption('visual-owned-agent')
    const selectorBounds = (await selector.boundingBox())!, labelBounds = (await selector.locator('..').boundingBox())!
    expect.soft(selectorBounds.x + selectorBounds.width, 'owned-agent selector must fit its label with a long name').toBeLessThanOrEqual(labelBounds.x + labelBounds.width + 1)
    await expectFits(page)
    await testInfo.attach(`wallet-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
  })

  test(`delivery, rating and avatar dialogs fit a short viewport at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 480 })
    await mockAccount(page)
    await page.goto('/dashboard?tab=trades')
    for (const [opener, title, action] of [
      ['Submit delivery', 'Submit completed work', 'Submit for buyer review'],
      ['Rate counterparty', 'Rate this Agent', 'Submit Review'],
    ]) {
      await page.getByRole('button', { name: opener, exact: true }).click()
      const dialog = page.getByRole('dialog', { name: title })
      await expect(dialog).toBeVisible()
      const bounds = await dialog.boundingBox()
      expect.soft(bounds!.x, 'dialog must retain a viewport gutter').toBeGreaterThanOrEqual(15)
      expect.soft(bounds!.width).toBeLessThanOrEqual(width - 30)
      expect.soft(bounds!.y).toBeGreaterThanOrEqual(15)
      expect.soft(bounds!.y + bounds!.height).toBeLessThanOrEqual(465)
      expect.soft(parseFloat(await dialog.evaluate(element => getComputedStyle(element).paddingLeft)), 'utility padding must survive the global reset').toBeGreaterThanOrEqual(20)
      expect.soft(await dialog.getByRole('heading', { name: title }).evaluate(element => getComputedStyle(element).fontFamily)).toContain('Space Grotesk')
      expect.soft(await page.evaluate(() => document.elementFromPoint(5, 5)?.closest('header') === null), 'dialog backdrop must cover fixed navigation').toBe(true)
      await expectFits(page)
      const close = dialog.getByRole('button', { name: /Close .*dialog/ })
      expect.soft((await close.boundingBox())!.width).toBeGreaterThanOrEqual(44)
      await dialog.getByRole('button', { name: action, exact: true }).scrollIntoViewIfNeeded()
      await expect(dialog.getByRole('button', { name: action, exact: true })).toBeInViewport()
      await testInfo.attach(`${opener}-${width}`, { body: await page.screenshot(), contentType: 'image/png' })
      if (opener === 'Rate counterparty') {
        await dialog.getByRole('button', { name: 'Rate 3 stars', exact: true }).click()
        await dialog.getByRole('button', { name: action, exact: true }).click()
        const alert = page.getByRole('alert').filter({ hasText: ratingError })
        await expect(alert).toHaveText(`❌ ${ratingError}`)
        await expect(dialog).toBeVisible()
        await expectFits(page)
        const alertBounds = (await alert.boundingBox())!
        expect.soft(await page.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('[role="alert"]')), { x: alertBounds.x + alertBounds.width / 2, y: alertBounds.y + alertBounds.height / 2 }), 'failed review feedback must appear above its open dialog').toBe(true)
        await testInfo.attach(`rating-error-${width}`, { body: await page.screenshot(), contentType: 'image/png' })
      }
      await close.click()
      await expect(dialog).toHaveCount(0)
    }
    await page.goto('/dashboard?tab=profile')
    await page.getByRole('button', { name: 'Open Avatar Picker' }).click()
    const avatars = page.getByRole('dialog', { name: 'Choose an Avatar' })
    await expect(avatars).toBeVisible()
    await expectFits(page)
    const bounds = await avatars.boundingBox()
    expect.soft(bounds!.x).toBeGreaterThanOrEqual(15)
    expect.soft(parseFloat(await avatars.evaluate(element => getComputedStyle(element).paddingLeft))).toBeGreaterThanOrEqual(20)
    expect.soft(await avatars.getByRole('heading').evaluate(element => getComputedStyle(element).fontFamily)).toContain('Space Grotesk')
    expect.soft(bounds!.y + bounds!.height).toBeLessThanOrEqual(465)
    for (const image of await avatars.getByAltText('avatar preset').all()) {
      const imageBounds = await image.boundingBox(), buttonBounds = await image.locator('..').boundingBox()
      expect.soft(imageBounds!.x + imageBounds!.width).toBeLessThanOrEqual(buttonBounds!.x + buttonBounds!.width + 1)
    }
    await avatars.getByRole('button', { name: 'Close avatar dialog' }).click()
    await expect(avatars).toHaveCount(0)
  })
}
