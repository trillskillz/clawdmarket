import test from 'node:test'
import assert from 'node:assert/strict'
import { privateKeyToAccount } from 'viem/accounts'
import { PATHUSD_ADDRESS, TEMPO_CHAIN_ID } from '@/lib/constants'
import { settlementAccount, settlementChain } from '@/lib/settlement-transaction'

const privateKey = `0x${'01'.repeat(32)}` as `0x${string}`
const recipient = privateKeyToAccount(privateKey).address

test('Tempo payouts use a Tempo transaction and pathUSD for gas', async () => {
  const chain = settlementChain(TEMPO_CHAIN_ID, 'https://rpc.tempo.xyz')
  assert.equal(chain.id, TEMPO_CHAIN_ID)
  assert.equal((chain as typeof chain & { feeToken?: string }).feeToken, PATHUSD_ADDRESS)
  assert.equal(chain.rpcUrls.default.http[0], 'https://rpc.tempo.xyz')

  const account = settlementAccount(TEMPO_CHAIN_ID, privateKey, recipient)
  const raw = await account.signTransaction({
    chainId: TEMPO_CHAIN_ID,
    nonce: 0,
    gas: 100_000n,
    maxFeePerGas: 1n,
    maxPriorityFeePerGas: 1n,
    to: PATHUSD_ADDRESS,
    data: '0x',
    feeToken: PATHUSD_ADDRESS,
  })
  assert.match(raw, /^0x76[0-9a-f]+$/)
})

test('ERC-20 payouts retain standard EVM signing and reject a mismatched signer', async () => {
  const chain = settlementChain(8453, 'https://mainnet.base.org')
  assert.equal(chain.id, 8453)
  assert.equal(chain.rpcUrls.default.http[0], 'https://mainnet.base.org')

  const account = settlementAccount(8453, privateKey, recipient)
  const raw = await account.signTransaction({
    chainId: 8453,
    nonce: 0,
    gas: 100_000n,
    maxFeePerGas: 1n,
    maxPriorityFeePerGas: 1n,
    to: recipient,
    value: 0n,
  })
  assert.match(raw, /^0x02[0-9a-f]+$/)
  assert.throws(() => settlementAccount(TEMPO_CHAIN_ID, privateKey, PATHUSD_ADDRESS), /Settlement signer does not match/)
})
