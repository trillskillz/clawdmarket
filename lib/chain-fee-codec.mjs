import { z } from 'zod'

const units = z.string().regex(/^(0|[1-9][0-9]{0,99})$/)
const address = z.string().regex(/^0x[a-f0-9]{40}$/)
const hash = z.string().regex(/^0x[a-f0-9]{64}$/)
export const ethereumChains = new Set([1, 11155111])
export const ethereumEvidence = z.object({ version: z.literal(1), model: z.literal('ethereum_l1_native_v1'),
  chain_id: z.number().int().positive(), tx_hash: hash, block_hash: hash, block_number: units,
  payer_address: address, fee_asset: z.literal('native'), unit: z.literal('wei'),
  gas_used: units, effective_gas_price: units, execution_fee_units: units, blob_fee_units: units, total_fee_units: units,
}).strict().superRefine((value, context) => {
  if (!ethereumChains.has(value.chain_id) || BigInt(value.gas_used) <= 0n
    || BigInt(value.gas_used) * BigInt(value.effective_gas_price) !== BigInt(value.execution_fee_units)
    || BigInt(value.execution_fee_units) + BigInt(value.blob_fee_units) !== BigInt(value.total_fee_units)) context.addIssue({ code: 'custom', message: 'Invalid measured fee' })
})
export const tempoFeeManager='0xfeec000000000000000000000000000000000000'
export const pathUsd='0x20c0000000000000000000000000000000000000'
export const tempoEvidence=z.object({version:z.literal(1),model:z.literal('tempo_pathusd_sender_fee_v1'),
  chain_id:z.literal(4217),tx_hash:hash,block_hash:hash,block_number:units,payer_address:address,
  fee_asset:z.literal('fee_token'),unit:z.literal('token_base_units'),fee_token_address:z.literal(pathUsd),
  fee_manager_address:z.literal(tempoFeeManager),fee_log_index:units,gas_price_unit:z.literal('attousd'),gas_price_scale:z.literal('1000000000000'),
  gas_used:units,effective_gas_price:units,execution_fee_units:units,blob_fee_units:z.literal('0'),total_fee_units:units,fee_transfer_amount_units:units,
}).strict().superRefine((value,context)=>{
  const gas=BigInt(value.gas_used),price=BigInt(value.effective_gas_price),total=(gas*price+999_999_999_999n)/1_000_000_000_000n
  if(gas<=0n||gas>=2n**64n||price<=0n||price>=2n**128n||total!==BigInt(value.execution_fee_units)||total!==BigInt(value.total_fee_units)||total!==BigInt(value.fee_transfer_amount_units))context.addIssue({code:'custom',message:'Invalid measured Tempo fee'})
})
export const chainFeeEvidenceSchema=z.union([ethereumEvidence,tempoEvidence])

export class ChainFeeEvidenceError extends Error { constructor() { super('CHAIN_FEE_EVIDENCE_INVALID') } }

/** Parse only original receipt identity; null remains unmeasured. */
export function readChainFeeEvidence(json, identity) {
  if (json === null) return null
  try {
    const parsed = chainFeeEvidenceSchema.parse(JSON.parse(json))
    if (parsed.chain_id !== identity.chainId || parsed.tx_hash !== identity.txHash?.toLowerCase() || parsed.payer_address !== identity.payerAddress?.toLowerCase()) throw new ChainFeeEvidenceError()
    return parsed
  } catch { throw new ChainFeeEvidenceError() }
}
