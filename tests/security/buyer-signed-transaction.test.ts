import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeFunctionData, erc20Abi, keccak256 } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { inspectSignedEvmPayment, assertBuyerWalletReserve } from '../../lib/buyer-signed-transaction.mjs'

const signer = privateKeyToAccount(`0x${'11'.repeat(32)}`) // Dummy fixture only; no wallet/RPC.
const intent = { chain_id: 8453, payer_address: signer.address, token_address: `0x${'44'.repeat(20)}` as const,
  treasury_address: `0x${'55'.repeat(20)}` as const, token_amount: '1050000' }
const payment = { ...intent, max_gas_cost_wei: '200000', minimum_token_reserve_units: '5000000', minimum_native_reserve_wei: '1000000' }
const data = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [intent.treasury_address, 1050000n] })
const transaction = { chainId: 8453, nonce: 7, to: intent.token_address, data, value: 0n, gas: 50000n, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n, type: 'eip1559' as const }

test('signed buyer payment binds signer, chain, token, exact transfer and fee bidding before submission', async () => {
  const raw = await signer.signTransaction(transaction)
  const checked = await inspectSignedEvmPayment(raw, intent, payment)
  assert.equal(checked.tx_hash, keccak256(raw)); assert.equal(checked.nonce, 7); assert.equal(checked.token_amount, '1050000')
  assert.equal(checked.maximum_execution_gas_cost_wei, '100000')
  for (const changed of [
    { chainId: 1 }, { to: intent.treasury_address }, { value: 1n },
    { data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [intent.treasury_address, 1050000n] }) },
    { data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [intent.treasury_address, 1050001n] }) },
    { data: `${data}00` as `0x${string}` },
  ]) await assert.rejects(() => signer.signTransaction({ ...transaction, ...changed }).then((bytes) => inspectSignedEvmPayment(bytes, intent, payment)), /BUYER_TRANSACTION_SCOPE_MISMATCH/)
  await assert.rejects(() => inspectSignedEvmPayment(raw, intent, { ...payment, payer_address: intent.treasury_address }), /BUYER_TRANSACTION_SCOPE_MISMATCH/)
  await assert.rejects(() => inspectSignedEvmPayment(raw, intent, { ...payment, max_gas_cost_wei: '99999' }), /BUYER_TRANSACTION_GAS_LIMIT/)
})

test('buyer reserve floor includes pending/unknown authorized payments and exact boundary values', () => {
  const balances = { tokenBalance: 8000000n, nativeBalance: 2000000n, paymentAmount: 1000000n, gasCost: 100000n, outstandingToken: 2000000n, outstandingGas: 900000n, payment }
  assert.doesNotThrow(() => assertBuyerWalletReserve(balances))
  assert.throws(() => assertBuyerWalletReserve({ ...balances, tokenBalance: 7999999n }), /BUYER_TOKEN_RESERVE_REQUIRED/)
  assert.throws(() => assertBuyerWalletReserve({ ...balances, nativeBalance: 1999999n }), /BUYER_NATIVE_RESERVE_REQUIRED/)
  assert.throws(() => assertBuyerWalletReserve({ ...balances, gasCost: 200001n }), /BUYER_WALLET_BOUNDS_INVALID/)
})
