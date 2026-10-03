import { SignJWT } from 'jose'
import { expect, test } from '@playwright/test'
import { privateKeyToAccount } from 'viem/accounts'

const payer = privateKeyToAccount(`0x${'11'.repeat(32)}`).address
const token = `0x${'44'.repeat(20)}`
const treasury = `0x${'22'.repeat(20)}`
const hash = `0x${'66'.repeat(32)}`

for (const width of [1440, 390]) {
  test(`account credit shows connected balances and recovers a lost wallet response at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    const auth = await new SignJWT({ userId: 'credit-browser-user', role: 'human' }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(new TextEncoder().encode(process.env.JWT_SECRET || 'clawdmarket-playwright-jwt-secret'))
    await page.context().addCookies([{ name: 'auth-token', value: auth, url: 'http://localhost:3000' }])
    await page.addInitScript(({ payer, hash }) => {
      let connected = localStorage.getItem('fixture-connected') === 'true'
      const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
      const provider = {
        request: async ({ method }: { method: string }) => {
          if (method === 'wallet_requestPermissions') { connected = true; localStorage.setItem('fixture-connected', 'true'); return [{ caveats: [{ value: [payer] }] }] }
          if (method === 'eth_requestAccounts') { connected = true; localStorage.setItem('fixture-connected', 'true'); return [payer] }
          if (method === 'eth_accounts') return connected ? [payer] : []
          if (method === 'eth_chainId') return '0x2105'
          if (method === 'eth_sendTransaction' || method === 'wallet_sendTransaction') {
            const count = Number(localStorage.getItem('fixture-send-count') || '0') + 1
            localStorage.setItem('fixture-send-count', String(count)); localStorage.setItem('fixture-sent-hash', hash)
            throw new Error('Transport disconnected after transaction submission')
          }
          if (method === 'personal_sign') return `0x${'11'.repeat(65)}`
          if (method === 'eth_getTransactionCount') return '0x0'
          if (method === 'eth_estimateGas') return '0x10000'
          if (method === 'eth_gasPrice') return '0x1'
          if (method === 'wallet_getCapabilities') return {}
          throw new Error(`Unexpected fixture request ${method}`)
        },
        on(event: string, handler: (...args: unknown[]) => void) { const set = listeners.get(event) || new Set(); set.add(handler); listeners.set(event, set) },
        removeListener(event: string, handler: (...args: unknown[]) => void) { listeners.get(event)?.delete(handler) },
      }
      const detail = { info: { icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>', name: 'Credit Wallet', rdns: 'test.credit', uuid: '350670db-19fa-4704-a166-e52e178b59d2' }, provider }
      window.addEventListener('eip6963:requestProvider', () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail })))
    }, { payer, hash })
    let deposit: Record<string, unknown> | null = null
    let available = 0, confirmations = 0, intents = 0
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url()), method = route.request().method()
      let body: unknown = {}, status = 200
      if (url.pathname === '/api/auth/me') body = { authenticated: true, user: { id: 'credit-browser-user', name: 'Credit Buyer', role: 'human', email: 'credit@test.invalid' } }
      else if (url.pathname.startsWith('/api/admin/')) { status = 403; body = { error: 'Forbidden' } }
      else if (url.pathname === '/api/wallet') body = { account_id: 'credit-browser-user', balance: available, available, escrow: 0, transactions: [], credit_activity: [] }
      else if (url.pathname === '/api/payments/config') body = { account_credit_enabled: true, new_payments_paused: false, ledger_enabled: false, erc20_configured: true, accepted_tokens: [{ chain_id: 8453, token_address: token, symbol: 'USDC', decimals: 6 }] }
      else if (url.pathname === '/api/payments/payout-address') body = { address: payer, owned_agents: [] }
      else if (url.pathname === '/api/wallet/balances') body = { address: payer, balances: [{ chain_id: 8453, chain_name: 'Base', symbol: 'USDC', status: 'available', amount: '12.345678', native_balance_wei: '1000000000000000' }] }
      else if (url.pathname === '/api/wallet/deposits' && method === 'POST') {
        intents++; const input = route.request().postDataJSON()
        deposit = { id: 'deposit-browser-fixture', user_id: 'credit-browser-user', client_reference: input.client_reference, payer: payer.toLowerCase(), amount_minor: input.amount_minor, treasury, token, chain_id: 8453, created: true, state: 'pending', token_amount: '1000000', tx_hash: null, expires_at: new Date(Date.now() + 600000).toISOString() }
        body = { deposit }
      } else if (url.pathname === '/api/wallet/deposits' && method === 'PUT') {
        confirmations++; const input = route.request().postDataJSON(); expect(input.tx_hash).toBe(hash); expect(input.id).toBe('deposit-browser-fixture')
        available = 1; deposit = { ...deposit, state: 'confirmed', tx_hash: hash }; body = { deposit }
      } else if (url.pathname === '/api/wallet/deposits') body = { deposits: deposit ? [{ ...deposit, created: false }] : [] }
      else if (url.pathname === '/api/listings') body = { listings: [], total: 0 }
      else if (url.pathname === '/api/trades') body = { trades: [], total: 0 }
      else if (url.pathname === '/api/contracts') body = { contracts: [], total: 0 }
      else if (url.pathname === '/api/auth/api-keys') body = { keys: [] }
      else if (url.pathname === '/api/webhooks') body = { webhooks: [] }
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    })
    await page.goto('/dashboard?tab=wallet')
    await expect(page.getByRole('heading', { name: 'Account balance and wallets' })).toBeVisible()
    await page.getByRole('button', { name: 'Connect Credit Wallet' }).click()
    await expect(page.getByText(/Base: 12.345678 USDC/)).toBeVisible()
    await page.getByRole('button', { name: 'Deposit Base USDC' }).click()
    await expect(page.getByRole('button', { name: 'Recover deposit' })).toBeVisible()
    await expect.poll(() => page.evaluate(() => localStorage.getItem('fixture-send-count'))).toBe('1')
    await expect(page.getByRole('button', { name: 'Recover deposit' })).toBeEnabled()
    await page.reload()
    const connect = page.getByRole('button', { name: 'Connect Credit Wallet' })
    await expect(page.getByText(/Base: 12.345678 USDC/).or(connect)).toBeVisible()
    if (await connect.isVisible()) await connect.click()
    await expect(page.getByRole('button', { name: 'Recover deposit' })).toBeVisible()
    await page.getByRole('textbox', { name: 'Original transaction hash' }).fill(hash)
    await page.getByRole('button', { name: 'Recover deposit' }).click()
    await expect(page.getByText('Available $1.00 · Held $0.00', { exact: true })).toBeVisible()
    expect(intents).toBe(1); expect(confirmations).toBe(1)
    await expect.poll(() => page.evaluate(() => localStorage.getItem('fixture-send-count'))).toBe('1')
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  })
}
