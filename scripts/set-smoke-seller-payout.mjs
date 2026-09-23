import { getAddress } from 'viem'

// One-time destination explicitly supplied by the owner for the smoke seller.
const targetAddress = getAddress('0x89D8f773a0F59A429B71610B31c5d9c85Ca39E5d')
const baseUrl = new URL(process.env.BASE_URL || 'https://www.clawdmkt.com').origin
const email = process.env.SMOKE_EMAIL || ''
const password = process.env.SMOKE_PASSWORD || ''

if (!['https://clawdmkt.com', 'https://www.clawdmkt.com'].includes(baseUrl)) {
  throw new Error('Smoke seller payout configuration only permits a canonical clawdmkt.com origin')
}
if (!email || !password) throw new Error('SMOKE_EMAIL and SMOKE_PASSWORD are required')

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, { ...options, cache: 'no-store' })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}: ${body?.error || 'unknown error'}`)
  return body
}

const login = await request('/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
})
if (!login?.token) throw new Error('Smoke seller login did not return a bearer token')
const headers = { Authorization: `Bearer ${login.token}`, 'Content-Type': 'application/json' }
const before = await request('/api/payments/payout-address', { headers })
if (before.address) {
  if (getAddress(before.address) !== targetAddress) {
    throw new Error('Smoke seller already has a different payout address; refusing to replace it')
  }
  console.log(`Smoke seller payout address is already ${targetAddress}`)
  process.exit(0)
}

const saved = await request('/api/payments/payout-address', {
  method: 'PUT', headers, body: JSON.stringify({ address: targetAddress }),
})
if (getAddress(saved.address) !== targetAddress) throw new Error('Payout write did not return the expected address')
const after = await request('/api/payments/payout-address', { headers })
if (getAddress(after.address) !== targetAddress) throw new Error('Payout read-back did not match the expected address')
console.log(`Smoke seller payout address configured and verified: ${targetAddress}`)
