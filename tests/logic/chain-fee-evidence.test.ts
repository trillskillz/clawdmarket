import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeAbiParameters,encodeEventTopics,erc20Abi } from 'viem'
import { measuredEvmChainFee, measuredTempoChainFee, readChainFeeEvidence, serializeChainFeeEvidence } from '../../lib/chain-fee-evidence'
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

function tempoReceipt(gas=21000n,price=1000000000n){
  const from=receipt.from,fee=(gas*price+999_999_999_999n)/1000000000000n
  const log={address:'0x20c0000000000000000000000000000000000000',data:encodeAbiParameters([{type:'uint256'}],[fee]),topics:encodeEventTopics({abi:erc20Abi,eventName:'Transfer',args:{from:from as `0x${string}`,to:'0xfeec000000000000000000000000000000000000'}}) as [`0x${string}`,...`0x${string}`[]],logIndex:0,transactionHash:receipt.transactionHash,blockHash:receipt.blockHash}
  return {...receipt,type:'0x76',gasUsed:gas,effectiveGasPrice:price,feeToken:log.address,feePayer:from,logs:[log]}
}
test('Tempo sender-paid pathUSD fees require exact original fee transfer and round receipt gas upward in token units',()=>{
  const original=tempoReceipt(),value=measuredTempoChainFee(4217,original)!
  assert.equal(value.model,'tempo_pathusd_sender_fee_v1');assert.equal(value.total_fee_units,'21');assert.equal(value.fee_asset,'fee_token');assert.equal(value.unit,'token_base_units')
  const identity={chainId:4217,txHash:original.transactionHash,payerAddress:original.from}
  assert.deepEqual(readChainFeeEvidence(serializeChainFeeEvidence(value,identity),identity),value)
  assert.equal(measuredTempoChainFee(4217,tempoReceipt(1n,1n))!.total_fee_units,'1')
  assert.equal(measuredTempoChainFee(4217,tempoReceipt(1n,1000000000001n))!.total_fee_units,'2')
  const huge=tempoReceipt(2n**63n,2n**127n);assert.equal(measuredTempoChainFee(4217,huge)!.total_fee_units,((huge.gasUsed*huge.effectiveGasPrice+999999999999n)/1000000000000n).toString())
})
test('Tempo incomplete, sponsored, cross-token, free and contradictory gas/transfer receipts remain unmeasured',()=>{
  const original=tempoReceipt(),log=original.logs[0],other=`0x${'44'.repeat(20)}`
  assert.equal(measuredTempoChainFee(1,original),null)
  for(const change of [{type:'eip1559'},{feePayer:other},{feePayer:undefined},{feeToken:other},{feeToken:undefined},{logs:[]},{logs:[log,log]},{gasUsed:0n},{gasUsed:2n**64n},{effectiveGasPrice:0n},{effectiveGasPrice:2n**128n}])assert.equal(measuredTempoChainFee(4217,{...original,...change}),null)
  for(const change of [{feeToken:1},{feePayer:1},{from:null},{logs:[null]},{logs:[{...log,address:1}]},{logs:[{...log,transactionHash:1}]}])assert.equal(measuredTempoChainFee(4217,{...original,...change} as unknown as Parameters<typeof measuredTempoChainFee>[1]),null)
  for(const change of [{address:other},{data:encodeAbiParameters([{type:'uint256'}],[22n])},{logIndex:-1},{logIndex:null},{transactionHash:`0x${'55'.repeat(32)}`},{blockHash:`0x${'55'.repeat(32)}`}])assert.equal(measuredTempoChainFee(4217,{...original,logs:[{...log,...change}]}),null)
})
test('stored Tempo fee evidence rejects changed payer/token/manager/scale, extra fields and rounded arithmetic',()=>{
  const original=tempoReceipt(),value=measuredTempoChainFee(4217,original)!,identity={chainId:4217,txHash:original.transactionHash,payerAddress:original.from}
  for(const change of [{fee_token_address:`0x${'44'.repeat(20)}`},{fee_manager_address:`0x${'44'.repeat(20)}`},{gas_price_scale:'1'},{fee_transfer_amount_units:'20'},{execution_fee_units:'20'},{blob_fee_units:'1'},{total_fee_units:'20'},{gas_used:'0'},{effective_gas_price:'0'},{fee_log_index:'-1'},{payer_address:`0x${'44'.repeat(20)}`},{unexpected:'not receipt evidence'}])assert.throws(()=>readChainFeeEvidence(JSON.stringify({...value,...change}),identity),/CHAIN_FEE_EVIDENCE_INVALID/)
  assert.throws(()=>readChainFeeEvidence(JSON.stringify(value),{...identity,chainId:1}),/CHAIN_FEE_EVIDENCE_INVALID/)
})
