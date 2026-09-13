import 'server-only'
import { isAddress, type Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { PATHUSD_ADDRESS, TEMPO_CHAIN_ID } from '@/lib/constants'

export type AcceptedToken = {
  chainId: number
  chainName: string
  address: Address
  symbol: string
  decimals: number
  rpcUrl?: string
  fixedUsdPrice: number
  confirmations: number
}

const DEFAULT_TOKENS: AcceptedToken[] = [
  { chainId: 1, chainName: 'Ethereum', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', decimals: 6, fixedUsdPrice: 1, confirmations: 3 },
  { chainId: 10, chainName: 'Optimism', address: '0x7F5c764cBc14f9669B88837ca1490cCa17c31607', symbol: 'USDC', decimals: 6, fixedUsdPrice: 1, confirmations: 3 },
  { chainId: 137, chainName: 'Polygon', address: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', symbol: 'USDC', decimals: 6, fixedUsdPrice: 1, confirmations: 64 },
  { chainId: 8453, chainName: 'Base', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC', decimals: 6, fixedUsdPrice: 1, confirmations: 3 },
  { chainId: 42161, chainName: 'Arbitrum One', address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', symbol: 'USDC', decimals: 6, fixedUsdPrice: 1, confirmations: 3 },
]

function positiveInteger(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function parseConfiguredTokens(): AcceptedToken[] {
  const raw = process.env.EVM_ACCEPTED_TOKENS?.trim()
  if (!raw) return DEFAULT_TOKENS
  try {
    const input = JSON.parse(raw)
    if (!Array.isArray(input)) throw new Error('must be a JSON array')
    return input.map((item, index) => {
      const address = String(item?.address || '')
      const chainId = Number(item?.chainId)
      const decimals = Number(item?.decimals)
      const fixedUsdPrice = Number(item?.fixedUsdPrice)
      if (!Number.isInteger(chainId) || chainId <= 0 || !isAddress(address)) throw new Error(`invalid token at index ${index}`)
      if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error(`invalid decimals at index ${index}`)
      if (!Number.isFinite(fixedUsdPrice) || fixedUsdPrice !== 1) throw new Error(`fixedUsdPrice must be 1 for USD-pegged tokens at index ${index}`)
      return {
        chainId,
        chainName: String(item?.chainName || `EVM ${chainId}`).slice(0, 80),
        address: address as Address,
        symbol: String(item?.symbol || 'TOKEN').slice(0, 20),
        decimals,
        rpcUrl: item?.rpcUrl ? String(item.rpcUrl) : undefined,
        fixedUsdPrice,
        confirmations: positiveInteger(item?.confirmations, 3),
      }
    })
  } catch (error) {
    throw new Error(`EVM_ACCEPTED_TOKENS is invalid: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export function getAcceptedTokens() {
  return parseConfiguredTokens()
}

function explicitRpcUrl(token: AcceptedToken) {
  const specific = process.env[`EVM_RPC_URL_${token.chainId}`]?.trim()
  const generic = getAcceptedTokens().length === 1 ? process.env.EVM_RPC_URL?.trim() : ''
  return token.rpcUrl?.trim() || specific || generic || null
}

export function getReadyAcceptedTokens() {
  return getAcceptedTokens().filter((token) => Boolean(explicitRpcUrl(token)))
}

export function findAcceptedToken(chainId: number, address: string) {
  return getReadyAcceptedTokens().find((token) => token.chainId === chainId && token.address.toLowerCase() === address.toLowerCase()) || null
}

export function getSettlementPrivateKey(): `0x${string}` | null {
  const raw = (process.env.EVM_SETTLEMENT_PRIVATE_KEY || '').trim()
  const value = (raw.startsWith('0x') ? raw : raw ? `0x${raw}` : '') as `0x${string}`
  return /^0x[a-fA-F0-9]{64}$/.test(value) ? value : null
}

export function getTreasuryAddress(): Address | null {
  const raw = (process.env.TREASURY_ADDRESS || '').trim()
  return isAddress(raw) ? raw as Address : null
}

export function getMppRecipientAddress(): Address | null {
  const raw = (process.env.MPP_RECIPIENT_ADDRESS || process.env.TREASURY_ADDRESS || '').trim()
  return isAddress(raw) ? raw as Address : null
}

export function getTempoRpcUrl() {
  return process.env.TEMPO_RPC_URL?.trim() || process.env.EVM_RPC_URL_4217?.trim() || null
}

export function settlementSignerAddress(): Address | null {
  const key = getSettlementPrivateKey()
  return key ? privateKeyToAccount(key).address : null
}

export function getPaymentReadiness() {
  const treasury = getTreasuryAddress()
  const mppRecipient = getMppRecipientAddress()
  const signer = settlementSignerAddress()
  const secretConfigured = Boolean(process.env.MPP_SECRET_KEY?.trim())
  const readyTokens = getReadyAcceptedTokens()
  const evmReady = Boolean(treasury && signer && readyTokens.length > 0 && treasury.toLowerCase() === signer.toLowerCase())
  const tempoRpcConfigured = Boolean(getTempoRpcUrl())
  const platformMppReady = Boolean(mppRecipient && secretConfigured && tempoRpcConfigured)
  const mppReady = Boolean(mppRecipient && signer && secretConfigured && tempoRpcConfigured && mppRecipient.toLowerCase() === signer.toLowerCase())
  return {
    mode: 'production' as const,
    ledger: {
      enabled: process.env.CLAWDMARKET_LEDGER_ENABLED === 'true',
      redeemable: process.env.CLAWDMARKET_LEDGER_REDEEMABLE === 'true',
      description: 'ClawdMarket account balance with atomic escrow and settlement.',
    },
    evm: {
      enabled: evmReady,
      treasury,
      signerMatchesTreasury: Boolean(treasury && signer && treasury.toLowerCase() === signer.toLowerCase()),
      tokens: readyTokens,
    },
    mpp: {
      enabled: mppReady,
      platformEnabled: platformMppReady,
      recipient: mppRecipient,
      chainId: TEMPO_CHAIN_ID,
      currency: PATHUSD_ADDRESS,
      secretConfigured,
      rpcConfigured: tempoRpcConfigured,
      signerMatchesRecipient: Boolean(mppRecipient && signer && mppRecipient.toLowerCase() === signer.toLowerCase()),
    },
  }
}

export function requireSettlementSigner(expectedFrom: Address) {
  const privateKey = getSettlementPrivateKey()
  if (!privateKey) throw new Error('EVM_SETTLEMENT_PRIVATE_KEY is not configured')
  const account = privateKeyToAccount(privateKey)
  if (account.address.toLowerCase() !== expectedFrom.toLowerCase()) {
    throw new Error('Settlement signer does not match the configured payment recipient')
  }
  return { privateKey, account }
}
