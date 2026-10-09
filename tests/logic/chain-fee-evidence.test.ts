import test from 'node:test'
import assert from 'node:assert/strict'
import { measuredEvmChainFee, readChainFeeEvidence, serializeChainFeeEvidence } from '../../lib/chain-fee-evidence'
const receipt = { transactionHash: `0x${'11'.repeat(32)}`, blockHash: `0x${'22'.repeat(32)}`, blockNumber: 55n,
  from: `0x${'33'.repeat(20)}`, gasUsed: 50_000n, effectiveGasPrice: 1_000_000_000n, type: 'eip1559' }
const identity = { chainId: 1, txHash: receipt.transactionHash, payerAddress: receipt.from }

test('verified L1 receipt fees use exact integer execution and blob units, including beyond 64-bit totals', () => {
  const value = measuredEvmChainFee(1, receipt)!
  assert.equal(value.total_fee_units, '50000000000000')
  assert.deepEqual(readChainFeeEvidence(serializeChainFeeEvidence(value, identity), identity), value)
  const blob = measuredEvmChainFee(1, { ...receipt, type: 'eip4844', gasUsed: 10n ** 19n, blobGasUsed: 2n ** 30n, blobGasPrice: 2n ** 50n })!
  assert.equal(BigInt(blob.total_fee_units), 10n ** 28n + 2n ** 80n)
  assert.equal(blob.blob_fee_units, (2n ** 80n).toString())
  assert.equal(measuredEvmChainFee(11155111, { ...receipt, effectiveGasPrice: 0n })!.total_fee_units, '0')
})
test('unknown, incomplete rollup/Tempo, absent gas and incomplete blob receipts stay unmeasured', () => {
  for (const chain of [8453, 10, 4217, 99999]) assert.equal(measuredEvmChainFee(chain, receipt), null)
  assert.equal(measuredEvmChainFee(1, { ...receipt, type: 'eip4844' }), null)
  assert.equal(measuredEvmChainFee(1, { ...receipt, effectiveGasPrice: -1n }), null)
  assert.equal(measuredEvmChainFee(1, { ...receipt, type: 'unknown' }), null)
  assert.equal(measuredEvmChainFee(1, { ...receipt, gasUsed: 0n }), null)
  assert.equal(readChainFeeEvidence(null, identity), null)
})
test('swapped chain, hash, payer and manipulated fee arithmetic cannot enter an original record', () => {
  const value = measuredEvmChainFee(1, receipt)!
  for (const replacement of [{ chainId: 11155111 }, { txHash: `0x${'44'.repeat(32)}` }, { payerAddress: `0x${'44'.repeat(20)}` }]) {
    assert.throws(() => readChainFeeEvidence(JSON.stringify(value), { ...identity, ...replacement }), /CHAIN_FEE_EVIDENCE_INVALID/)
  }
  for (const replacement of [{ total_fee_units: '1' }, { execution_fee_units: '1' }, { extra: 'not-approved' }, { gas_used: '00001' }]) {
    assert.throws(() => serializeChainFeeEvidence({ ...value, ...replacement }, identity), /CHAIN_FEE_EVIDENCE_INVALID/)
  }
  assert.throws(() => readChainFeeEvidence('{', identity), /CHAIN_FEE_EVIDENCE_INVALID/)
})
