import { privateKeyToAccount } from 'viem/accounts'

const baseUrl = new URL(process.env.BASE_URL || 'https://www.clawdmkt.com').origin
const privateKey = process.env.WALLET_SMOKE_PRIVATE_KEY || ''
if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  throw new Error('WALLET_SMOKE_PRIVATE_KEY must be a 32-byte hex private key')
}

const account = privateKeyToAccount(privateKey)
const nonceResponse = await fetch(`${baseUrl}/api/auth/wallet/nonce`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ address: account.address, chainId: 1 }),
})
if (!nonceResponse.ok) throw new Error(`Wallet challenge returned HTTP ${nonceResponse.status}`)
const challenge = await nonceResponse.json()
if (!challenge.message || !challenge.nonce) throw new Error('Wallet challenge is missing message or nonce')

const baseHost = new URL(baseUrl).hostname
const expectedOrigin = ['clawdmkt.com', 'www.clawdmkt.com'].includes(baseHost)
  ? baseUrl
  : 'https://clawdmkt.com'
if (!String(challenge.message).startsWith(`${expectedOrigin} wants you to sign in with your Ethereum account:`)) {
  throw new Error(`Wallet challenge is not bound to ${expectedOrigin}`)
}
if (!String(challenge.message).includes(`\nURI: ${expectedOrigin}/auth/login\n`)) {
  throw new Error(`Wallet challenge URI is not bound to ${expectedOrigin}`)
}

const signature = await account.signMessage({ message: challenge.message })
const verifyResponse = await fetch(`${baseUrl}/api/auth/wallet/verify`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ address: account.address, signature, nonce: challenge.nonce }),
})
if (!verifyResponse.ok) throw new Error(`Wallet verification returned HTTP ${verifyResponse.status}`)
if (!/\bno-store\b/i.test(verifyResponse.headers.get('cache-control') || '')) {
  throw new Error('Wallet verification response is not protected by Cache-Control: no-store')
}

const authCookies = verifyResponse.headers.getSetCookie()
  .map((cookie) => cookie.split(';', 1)[0])
  .join('; ')
if (!authCookies.includes('auth-token=')) throw new Error('Wallet verification did not create an auth session')

const meResponse = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: authCookies } })
if (!meResponse.ok) throw new Error(`Authenticated wallet session returned HTTP ${meResponse.status}`)
const me = await meResponse.json()
if (me?.user?.wallet?.toLowerCase() !== account.address.toLowerCase()) {
  throw new Error('Authenticated session wallet does not match the signing account')
}

const csrfBypassResponse = await fetch(`${baseUrl}/api/messages`, {
  method: 'POST',
  headers: {
    Authorization: 'Bearer intentionally-invalid',
    'Content-Type': 'application/json',
    Cookie: authCookies,
  },
  body: '{}',
})
if (csrfBypassResponse.status !== 403) {
  throw new Error(`Cookie auth with an invalid bearer header bypassed CSRF: HTTP ${csrfBypassResponse.status}`)
}

const replayResponse = await fetch(`${baseUrl}/api/auth/wallet/verify`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ address: account.address, signature, nonce: challenge.nonce }),
})
if (replayResponse.status !== 401) throw new Error(`Consumed wallet challenge replay returned HTTP ${replayResponse.status}`)

console.log('Wallet SIWE challenge, authenticated session, CSRF enforcement, cache policy, and replay rejection passed')
