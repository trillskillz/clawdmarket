import crypto from 'crypto'
import { getAddress, isAddress, type Address } from 'viem'
import { createSiweMessage } from 'viem/siwe'

export const WALLET_AUTH_CHALLENGE_TTL_MS = 10 * 60 * 1000
export const WALLET_AUTH_STATEMENT = 'Sign in to ClawdMarket. This request does not create a transaction or move funds.'

type RuntimeEnvironment = Record<string, string | undefined>

export function walletAuthOrigin(requestOrigin: string, env: RuntimeEnvironment = process.env) {
  const production = env.VERCEL_ENV === 'production' || env.CLAWDMARKET_PRODUCTION_READINESS === 'true'
  const requestUrl = new URL(requestOrigin)
  const productionRequestOrigin = ['clawdmkt.com', 'www.clawdmkt.com'].includes(requestUrl.hostname)
    ? requestUrl.origin
    : 'https://clawdmkt.com'
  const configured = env.CLAWDMARKET_CANONICAL_ORIGIN?.trim()
    || (production ? productionRequestOrigin : requestOrigin)
  const origin = new URL(configured).origin
  if (production && new URL(origin).protocol !== 'https:') {
    throw new Error('Production wallet authentication requires an HTTPS canonical origin')
  }
  return origin
}

export function hashWalletAuthNonce(nonce: string) {
  return crypto.createHash('sha256').update(nonce).digest('hex')
}

export function createWalletAuthChallenge(input: {
  address: string
  chainId: number
  origin: string
  nonce?: string
  issuedAt?: Date
  expiresAt?: Date
}) {
  if (!isAddress(input.address)) throw new Error('A valid EVM wallet address is required')
  if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0) throw new Error('A valid EVM chain ID is required')

  const origin = new URL(input.origin).origin
  const issuedAt = input.issuedAt || new Date()
  const expiresAt = input.expiresAt || new Date(issuedAt.getTime() + WALLET_AUTH_CHALLENGE_TTL_MS)
  const nonce = input.nonce || crypto.randomBytes(16).toString('hex')
  const address = getAddress(input.address) as Address
  const domain = new URL(origin).host
  const uri = `${origin}/auth/login`
  const message = createSiweMessage({
    address,
    chainId: input.chainId,
    domain,
    expirationTime: expiresAt,
    issuedAt,
    nonce,
    scheme: new URL(origin).protocol.slice(0, -1),
    statement: WALLET_AUTH_STATEMENT,
    uri,
    version: '1',
  })

  return { address, chainId: input.chainId, domain, expiresAt, issuedAt, message, nonce, uri }
}
