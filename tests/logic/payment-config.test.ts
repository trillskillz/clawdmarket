import test from 'node:test'
import assert from 'node:assert/strict'
import { privateKeyToAccount } from 'viem/accounts'
import { GET as getPublicConfig } from '@/app/api/payments/config/route'
import { getAcceptedTokens, getPaymentReadiness } from '@/lib/payment-config'

const PRIVATE_KEY = `0x${'01'.repeat(32)}` as const
const account = privateKeyToAccount(PRIVATE_KEY)
const managedKeys = [
  'CLAWDMARKET_LEDGER_ENABLED',
  'CLAWDMARKET_LEDGER_REDEEMABLE',
  'EVM_SETTLEMENT_PRIVATE_KEY',
  'TREASURY_ADDRESS',
  'MPP_RECIPIENT_ADDRESS',
  'MPP_SECRET_KEY',
  'MPP_SECRET_KEY_CURRENT',
  'TEMPO_RPC_URL',
  'EVM_ACCEPTED_TOKENS',
  'EVM_RPC_URL',
  'EVM_RPC_URL_10',
  'DEV_WALLET_ADDRESS',
  'DEV_FEE_WALLET_ADDRESS',
] as const

function clearConfiguration() {
  for (const key of managedKeys) delete process.env[key]
}

test('production rails require complete configuration and the public response never exposes secrets or RPC credentials', async () => {
  clearConfiguration()
  const unavailable = getPaymentReadiness()
  assert.equal(unavailable.ledger.enabled, false)
  assert.equal(unavailable.evm.enabled, false)
  assert.equal(unavailable.mpp.enabled, false)

  process.env.CLAWDMARKET_LEDGER_ENABLED = 'true'
  process.env.CLAWDMARKET_LEDGER_REDEEMABLE = 'true'
  process.env.EVM_SETTLEMENT_PRIVATE_KEY = PRIVATE_KEY
  process.env.TREASURY_ADDRESS = account.address
  process.env.MPP_RECIPIENT_ADDRESS = account.address
  process.env.MPP_SECRET_KEY = 'never-return-this-mpp-secret-value'
  process.env.TEMPO_RPC_URL = 'https://tempo.example/rpc-secret'
  process.env.EVM_ACCEPTED_TOKENS = JSON.stringify([{
    chainId: 8453,
    chainName: 'Base',
    address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    symbol: 'USDC',
    decimals: 6,
    confirmations: 3,
    fixedUsdPrice: 1,
    rpcUrl: 'https://base.example/rpc-secret',
  }])

  const ready = getPaymentReadiness()
  assert.equal(ready.ledger.enabled, false)
  assert.equal(ready.ledger.redeemable, false)
  assert.equal(ready.evm.enabled, true)
  assert.equal(ready.mpp.enabled, true)
  assert.equal(ready.evm.feeRecipient, account.address)
  assert.equal(ready.mpp.feeRecipient, account.address)

  const response = await getPublicConfig()
  const body = await response.json()
  const serialized = JSON.stringify(body)
  assert.equal(body.erc20_configured, true)
  assert.equal(body.mpp_configured, true)
  assert.deepEqual(body.supported_protocols, ['mpp-tempo', 'erc20-evm'])
  assert.equal(body.accepted_tokens[0].fixed_usd_price, 1)
  assert.doesNotMatch(serialized, /never-return-this|rpc-secret|EVM_SETTLEMENT_PRIVATE_KEY/i)

  clearConfiguration()
})

test('external rails fail closed when the declared fee wallet would not receive the retained fee', () => {
  clearConfiguration()
  process.env.EVM_SETTLEMENT_PRIVATE_KEY = PRIVATE_KEY
  process.env.TREASURY_ADDRESS = account.address
  process.env.MPP_RECIPIENT_ADDRESS = account.address
  process.env.MPP_SECRET_KEY = 'x'.repeat(32)
  process.env.TEMPO_RPC_URL = 'https://rpc.tempo.xyz'
  process.env.EVM_ACCEPTED_TOKENS = JSON.stringify([{
    chainId: 8453,
    address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    symbol: 'USDC',
    decimals: 6,
    confirmations: 3,
    fixedUsdPrice: 1,
    rpcUrl: 'https://mainnet.base.org',
  }])
  process.env.DEV_FEE_WALLET_ADDRESS = '0x0000000000000000000000000000000000000001'

  const readiness = getPaymentReadiness()
  assert.equal(readiness.evm.enabled, false)
  assert.equal(readiness.mpp.enabled, false)
  assert.equal(readiness.evm.feeRecipientMatchesTreasury, false)
  assert.equal(readiness.mpp.feeRecipientMatchesPaymentRecipient, false)
  clearConfiguration()
})

test('custom EVM checkout accepts only explicitly priced USD-pegged tokens', () => {
  clearConfiguration()
  process.env.EVM_ACCEPTED_TOKENS = JSON.stringify([{
    chainId: 8453,
    address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    symbol: 'USDC',
    decimals: 6,
    confirmations: 3,
    fixedUsdPrice: 0.99,
  }])
  assert.throws(() => getPaymentReadiness(), /fixedUsdPrice must be 1/)
  clearConfiguration()
})

test('the built-in Optimism rail uses Circle-issued native USDC', () => {
  clearConfiguration()
  const optimism = getAcceptedTokens().find((token) => token.chainId === 10)
  assert.equal(optimism?.address.toLowerCase(), '0x0b2c639c533813f4aa9d7837caf62653d097ff85')
})
