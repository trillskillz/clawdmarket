import test from 'node:test'
import assert from 'node:assert/strict'
import { privateKeyToAccount } from 'viem/accounts'
import { GET as getPublicConfig } from '@/app/api/payments/config/route'
import { getPaymentReadiness } from '@/lib/payment-config'

const PRIVATE_KEY = `0x${'01'.repeat(32)}` as const
const account = privateKeyToAccount(PRIVATE_KEY)
const managedKeys = [
  'CLAWDMARKET_LEDGER_ENABLED',
  'CLAWDMARKET_LEDGER_REDEEMABLE',
  'EVM_SETTLEMENT_PRIVATE_KEY',
  'TREASURY_ADDRESS',
  'MPP_RECIPIENT_ADDRESS',
  'MPP_SECRET_KEY',
  'TEMPO_RPC_URL',
  'EVM_ACCEPTED_TOKENS',
  'EVM_RPC_URL',
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
  process.env.MPP_SECRET_KEY = 'never-return-this-mpp-secret'
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
  assert.equal(ready.ledger.enabled, true)
  assert.equal(ready.ledger.redeemable, true)
  assert.equal(ready.evm.enabled, true)
  assert.equal(ready.mpp.enabled, true)

  const response = await getPublicConfig()
  const body = await response.json()
  const serialized = JSON.stringify(body)
  assert.equal(body.erc20_configured, true)
  assert.equal(body.mpp_configured, true)
  assert.deepEqual(body.supported_protocols, ['ledger', 'mpp-tempo', 'erc20-evm'])
  assert.equal(body.accepted_tokens[0].fixed_usd_price, 1)
  assert.doesNotMatch(serialized, /never-return-this|rpc-secret|EVM_SETTLEMENT_PRIVATE_KEY/i)

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
