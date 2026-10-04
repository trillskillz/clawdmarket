import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeFunctionData, fromRlp, keccak256, toHex, toRlp } from 'viem'
import { Abis, Account } from 'viem/tempo'
import { inspectSignedTempoPayment } from '../../lib/buyer-tempo-transaction.mjs'

const signer = Account.fromSecp256k1(`0x${'11'.repeat(32)}`) // Dummy local fixture, no RPC or configured wallet.
const intent = { trade_id: '00000000-0000-4000-8000-000000000001', chain_id: 4217, payer_address: signer.address,
  token_address: '0x20c0000000000000000000000000000000000000' as const, treasury_address: `0x${'55'.repeat(20)}` as const,
  token_amount: '1050000', expires_at: new Date(Date.now() + 600_000).toISOString() }
const payment = { ...intent, rail: 'mpp', fee_token_address: intent.token_address, max_fee_token_cost_units: '5000' }
const memo = keccak256(toHex(`clawdmarket:${intent.trade_id}`))
const data = encodeFunctionData({ abi: Abis.tip20, functionName: 'transferWithMemo', args: [intent.treasury_address, 1_050_000n, memo] })
const transaction = { chainId: 4217, nonce: 7, nonceKey: 0n, gas: 50_000n, maxFeePerGas: 100_000_000_000n,
  maxPriorityFeePerGas: 0n, feeToken: intent.token_address, validBefore: Math.floor(Date.now() / 1000) + 25,
  calls: [{ to: intent.token_address, value: 0n, data }] }

test('exact Tempo signature binds root payer, trade memo, single payment, chain, nonce, fee token and rounded fee cap', async () => {
  const raw = await signer.signTransaction(transaction), checked = await inspectSignedTempoPayment(raw, intent, payment)
  assert.equal(checked.tx_hash, keccak256(raw)); assert.equal(checked.nonce, 7); assert.equal(checked.nonce_key, '0')
  assert.equal(checked.payer_address, signer.address.toLowerCase()); assert.equal(checked.maximum_fee_token_cost_units, '5000')
  for (const change of [{ chainId: 1 }, { nonceKey: 1n }, { feeToken: intent.treasury_address },
    { validBefore: Math.floor(Date.parse(intent.expires_at) / 1000) + 1 }, { validAfter: 1 },
    { calls: [transaction.calls[0], transaction.calls[0]] }, { calls: [{ ...transaction.calls[0], value: 1n }] },
    { calls: [{ ...transaction.calls[0], data: `${data}00` as `0x${string}` }] },
    { calls: [{ ...transaction.calls[0], data: encodeFunctionData({ abi: Abis.tip20, functionName: 'transferWithMemo', args: [intent.treasury_address, 1_050_001n, memo] }) }] },
    { calls: [{ ...transaction.calls[0], data: encodeFunctionData({ abi: Abis.tip20, functionName: 'transferWithMemo', args: [intent.treasury_address, 1_050_000n, keccak256(toHex('another-trade'))] }) }] },
  ]) await assert.rejects(() => signer.signTransaction({ ...transaction, ...change }).then((bytes) => inspectSignedTempoPayment(bytes, intent, payment)), /BUYER_TEMPO_TRANSACTION_SCOPE_MISMATCH/)
  await assert.rejects(() => inspectSignedTempoPayment(raw, intent, { ...payment, max_fee_token_cost_units: '4999' }), /BUYER_TEMPO_TRANSACTION_FEE_LIMIT/)
  await assert.rejects(() => inspectSignedTempoPayment(raw, intent, { ...payment, payer_address: intent.treasury_address }), /BUYER_TEMPO_TRANSACTION_SCOPE_MISMATCH/)
})

test('unsigned, sponsored, explicit-sender and noncanonical envelopes cannot obtain Tempo send authority', async () => {
  const raw = await signer.signTransaction(transaction)
  const parts = fromRlp(`0x${raw.slice(4)}`, 'hex') as any[]
  for (const altered of [
    [...parts.slice(0, -1), '0x'],
    parts.map((part, i) => i === 11 ? signer.address : part),
    parts.map((part, i) => i === 11 ? '0x00' : part),
    parts.map((part, i) => i === 7 ? '0x0007' : part),
  ]) await assert.rejects(() => inspectSignedTempoPayment(`0x76${toRlp(altered).slice(2)}`, intent, payment), /BUYER_TEMPO_TRANSACTION_SCOPE_MISMATCH/)
  await assert.rejects(() => inspectSignedTempoPayment(`0x78${raw.slice(4)}`, intent, payment), /BUYER_TEMPO_TRANSACTION_SCOPE_MISMATCH/)
  // Expired bytes remain inspectable for their original hash; fresh permission checks belong to the server claim.
  const expired = await signer.signTransaction({ ...transaction, validBefore: Math.floor(Date.now() / 1000) - 1 })
  assert.equal((await inspectSignedTempoPayment(expired, intent, payment)).tx_hash, keccak256(expired))
})
