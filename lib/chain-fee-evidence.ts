import { z } from 'zod'
import { canonicalContract } from './structured-verification'

const units = z.string().regex(/^(0|[1-9][0-9]{0,99})$/)
const address = z.string().regex(/^0x[a-f0-9]{40}$/)
const hash = z.string().regex(/^0x[a-f0-9]{64}$/)
const ethereumChains = new Set([1, 11155111])
const evidence = z.object({ version: z.literal(1), model: z.literal('ethereum_l1_native_v1'),
  chain_id: z.number().int().positive(), tx_hash: hash, block_hash: hash, block_number: units,
  payer_address: address, fee_asset: z.literal('native'), unit: z.literal('wei'),
  gas_used: units, effective_gas_price: units, execution_fee_units: units, blob_fee_units: units, total_fee_units: units,
}).strict().superRefine((value, context) => {
  if (!ethereumChains.has(value.chain_id) || BigInt(value.gas_used) <= 0n
    || BigInt(value.gas_used) * BigInt(value.effective_gas_price) !== BigInt(value.execution_fee_units)
    || BigInt(value.execution_fee_units) + BigInt(value.blob_fee_units) !== BigInt(value.total_fee_units)) context.addIssue({ code: 'custom', message: 'Invalid measured fee' })
})
export type ChainFeeEvidence = z.infer<typeof evidence>
export class ChainFeeEvidenceError extends Error {
  constructor() { super('CHAIN_FEE_EVIDENCE_INVALID') }
}
type Receipt = { transactionHash: string; blockHash: string; blockNumber: bigint; from: string;
  gasUsed: bigint; effectiveGasPrice: bigint; type: string; blobGasUsed?: bigint; blobGasPrice?: bigint }

/** Receipt-only observation. Unsupported models stay unmeasured; no ceiling is reported as actual gas. */
export function measuredEvmChainFee(chainId: number, receipt: Receipt): ChainFeeEvidence | null {
  if (!ethereumChains.has(chainId) || typeof receipt.transactionHash !== 'string' || typeof receipt.blockHash !== 'string' || typeof receipt.from !== 'string'
    || !['legacy', 'eip2930', 'eip1559', 'eip7702', 'eip4844'].includes(receipt.type)
    || typeof receipt.gasUsed !== 'bigint' || typeof receipt.effectiveGasPrice !== 'bigint' || typeof receipt.blockNumber !== 'bigint'
    || receipt.gasUsed <= 0n || receipt.effectiveGasPrice < 0n) return null
  const blobs = receipt.type === 'eip4844'
  if (blobs && (typeof receipt.blobGasUsed !== 'bigint' || typeof receipt.blobGasPrice !== 'bigint' || receipt.blobGasUsed < 0n || receipt.blobGasPrice < 0n)) return null
  const execution = receipt.gasUsed * receipt.effectiveGasPrice, blob = blobs ? receipt.blobGasUsed! * receipt.blobGasPrice! : 0n
  const parsed = evidence.safeParse({ version: 1, model: 'ethereum_l1_native_v1', chain_id: chainId,
    tx_hash: receipt.transactionHash.toLowerCase(), block_hash: receipt.blockHash.toLowerCase(), block_number: receipt.blockNumber.toString(),
    payer_address: receipt.from.toLowerCase(), fee_asset: 'native', unit: 'wei', gas_used: receipt.gasUsed.toString(),
    effective_gas_price: receipt.effectiveGasPrice.toString(), execution_fee_units: execution.toString(), blob_fee_units: blob.toString(), total_fee_units: (execution + blob).toString() })
  return parsed.success ? parsed.data : null
}

export function readChainFeeEvidence(json: string | null, identity: { chainId: number; txHash: string | null; payerAddress: string | null }) {
  if (json === null) return null
  try {
    const parsed = evidence.parse(JSON.parse(json))
    if (parsed.chain_id !== identity.chainId || parsed.tx_hash !== identity.txHash?.toLowerCase() || parsed.payer_address !== identity.payerAddress?.toLowerCase()) throw new ChainFeeEvidenceError()
    return parsed
  } catch { throw new ChainFeeEvidenceError() }
}
export function serializeChainFeeEvidence(value: ChainFeeEvidence | null | undefined, identity: Parameters<typeof readChainFeeEvidence>[1]) {
  if (!value) return null
  const json = canonicalContract(value)
  readChainFeeEvidence(json, identity)
  return json
}
