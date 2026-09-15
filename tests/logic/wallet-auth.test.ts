import assert from 'node:assert/strict'
import test from 'node:test'
import { privateKeyToAccount } from 'viem/accounts'
import { parseSiweMessage, validateSiweMessage } from 'viem/siwe'
import {
  createWalletAuthChallenge,
  hashWalletAuthNonce,
  WALLET_AUTH_CHALLENGE_TTL_MS,
  walletAuthOrigin,
} from '@/lib/wallet-auth'

const account = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945387d9f71b4ddf4f5f0f8f0ce5f5ef5b9d25')

test('wallet authentication creates a domain-bound, expiring SIWE challenge', () => {
  const issuedAt = new Date('2026-09-15T00:00:00.000Z')
  const challenge = createWalletAuthChallenge({
    address: account.address,
    chainId: 8453,
    origin: 'https://www.clawdmkt.com',
    nonce: '0123456789abcdef0123456789abcdef',
    issuedAt,
  })
  const parsed = parseSiweMessage(challenge.message)

  assert.equal(parsed.domain, 'www.clawdmkt.com')
  assert.equal(parsed.uri, 'https://www.clawdmkt.com/auth/login')
  assert.equal(parsed.chainId, 8453)
  assert.equal(parsed.address, account.address)
  assert.equal(parsed.expirationTime?.getTime(), issuedAt.getTime() + WALLET_AUTH_CHALLENGE_TTL_MS)
  assert.equal(validateSiweMessage({
    address: account.address,
    domain: 'www.clawdmkt.com',
    nonce: challenge.nonce,
    scheme: 'https',
    message: parsed,
    time: new Date(issuedAt.getTime() + 1),
  }), true)
  assert.equal(validateSiweMessage({ message: parsed, domain: 'attacker.example' }), false)
  assert.equal(validateSiweMessage({ message: parsed, time: challenge.expiresAt }), false)
})

test('production wallet authentication ignores deployment hostnames by default', () => {
  assert.equal(walletAuthOrigin('https://clawdmarket-random.vercel.app', { VERCEL_ENV: 'production' }), 'https://clawdmkt.com')
  assert.equal(walletAuthOrigin('https://www.clawdmkt.com', { VERCEL_ENV: 'production' }), 'https://www.clawdmkt.com')
  assert.equal(walletAuthOrigin('http://localhost:3000', {}), 'http://localhost:3000')
})

test('wallet nonce hashes do not expose the challenge value', () => {
  const nonce = '0123456789abcdef0123456789abcdef'
  assert.notEqual(hashWalletAuthNonce(nonce), nonce)
  assert.equal(hashWalletAuthNonce(nonce), hashWalletAuthNonce(nonce))
})
