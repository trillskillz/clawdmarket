import { z } from 'zod'
import { decodeEventLog,erc20Abi } from 'viem'
import { canonicalContract } from './structured-verification'

const units = z.string().regex(/^(0|[1-9][0-9]{0,99})$/)
const address = z.string().regex(/^0x[a-f0-9]{40}$/)
const hash = z.string().regex(/^0x[a-f0-9]{64}$/)
const ethereumChains = new Set([1, 11155111])
const ethereumEvidence = z.object({ version: z.literal(1), model: z.literal('ethereum_l1_native_v1'),
  chain_id: z.number().int().positive(), tx_hash: hash, block_hash: hash, block_number: units,
  payer_address: address, fee_asset: z.literal('native'), unit: z.literal('wei'),
  gas_used: units, effective_gas_price: units, execution_fee_units: units, blob_fee_units: units, total_fee_units: units,
}).strict().superRefine((value, context) => {
  if (!ethereumChains.has(value.chain_id) || BigInt(value.gas_used) <= 0n
    || BigInt(value.gas_used) * BigInt(value.effective_gas_price) !== BigInt(value.execution_fee_units)
    || BigInt(value.execution_fee_units) + BigInt(value.blob_fee_units) !== BigInt(value.total_fee_units)) context.addIssue({ code: 'custom', message: 'Invalid measured fee' })
})
const tempoFeeManager='0xfeec000000000000000000000000000000000000'
const pathUsd='0x20c0000000000000000000000000000000000000'
const tempoEvidence=z.object({version:z.literal(1),model:z.literal('tempo_pathusd_sender_fee_v1'),
  chain_id:z.literal(4217),tx_hash:hash,block_hash:hash,block_number:units,payer_address:address,
  fee_asset:z.literal('fee_token'),unit:z.literal('token_base_units'),fee_token_address:z.literal(pathUsd),
  fee_manager_address:z.literal(tempoFeeManager),fee_log_index:units,gas_price_unit:z.literal('attousd'),gas_price_scale:z.literal('1000000000000'),
  gas_used:units,effective_gas_price:units,execution_fee_units:units,blob_fee_units:z.literal('0'),total_fee_units:units,fee_transfer_amount_units:units,
}).strict().superRefine((value,context)=>{
  const gas=BigInt(value.gas_used),price=BigInt(value.effective_gas_price),total=(gas*price+999_999_999_999n)/1_000_000_000_000n
  if(gas<=0n||gas>=2n**64n||price<=0n||price>=2n**128n||total!==BigInt(value.execution_fee_units)||total!==BigInt(value.total_fee_units)||total!==BigInt(value.fee_transfer_amount_units))context.addIssue({code:'custom',message:'Invalid measured Tempo fee'})
})
const evidence=z.union([ethereumEvidence,tempoEvidence])

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
  const parsed = ethereumEvidence.safeParse({ version: 1, model: 'ethereum_l1_native_v1', chain_id: chainId,
    tx_hash: receipt.transactionHash.toLowerCase(), block_hash: receipt.blockHash.toLowerCase(), block_number: receipt.blockNumber.toString(),
    payer_address: receipt.from.toLowerCase(), fee_asset: 'native', unit: 'wei', gas_used: receipt.gasUsed.toString(),
    effective_gas_price: receipt.effectiveGasPrice.toString(), execution_fee_units: execution.toString(), blob_fee_units: blob.toString(), total_fee_units: (execution + blob).toString() })
  return parsed.success ? parsed.data : null
}

type TempoReceipt=Receipt & {feeToken?:string;feePayer?:string;logs:readonly {address:string;data:`0x${string}`;topics:[]|[`0x${string}`,...`0x${string}`[]];logIndex:number|null;transactionHash:string|null;blockHash:string|null}[]}
/** Verified configured-RPC receipt only. Unsupported fee models remain explicitly null. */
export function measuredTempoChainFee(chainId:number,receipt:TempoReceipt):ChainFeeEvidence|null{
  if(chainId!==4217||!['0x76','tempo'].includes(receipt.type)||typeof receipt.feeToken!=='string'||typeof receipt.feePayer!=='string'||typeof receipt.from!=='string'||receipt.feeToken.toLowerCase()!==pathUsd||receipt.feePayer.toLowerCase()!==receipt.from.toLowerCase()
    ||typeof receipt.transactionHash!=='string'||typeof receipt.blockHash!=='string'||typeof receipt.from!=='string'||typeof receipt.blockNumber!=='bigint'
    ||typeof receipt.gasUsed!=='bigint'||typeof receipt.effectiveGasPrice!=='bigint'||receipt.gasUsed<=0n||receipt.gasUsed>=2n**64n||receipt.effectiveGasPrice<=0n||receipt.effectiveGasPrice>=2n**128n||!Array.isArray(receipt.logs))return null
  const cost=(receipt.gasUsed*receipt.effectiveGasPrice+999_999_999_999n)/1_000_000_000_000n
  const matches=[]
  for(const log of receipt.logs){
    if(!log||typeof log.address!=='string'||log.address.toLowerCase()!==pathUsd)continue
    try{
      const event=decodeEventLog({abi:erc20Abi,eventName:'Transfer',data:log.data,topics:log.topics})
      if(event.args.from.toLowerCase()===receipt.from.toLowerCase()&&event.args.to.toLowerCase()===tempoFeeManager)matches.push({log,amount:event.args.value})
    }catch{/* Other receipt events do not establish a fee transfer. */}
  }
  if(matches.length!==1)return null
  const {log,amount}=matches[0]
  if(amount!==cost||!Number.isSafeInteger(log.logIndex)||log.logIndex!<0||typeof log.transactionHash!=='string'||typeof log.blockHash!=='string'||log.transactionHash.toLowerCase()!==receipt.transactionHash.toLowerCase()||log.blockHash.toLowerCase()!==receipt.blockHash.toLowerCase())return null
  const parsed=tempoEvidence.safeParse({version:1,model:'tempo_pathusd_sender_fee_v1',chain_id:4217,
    tx_hash:receipt.transactionHash.toLowerCase(),block_hash:receipt.blockHash.toLowerCase(),block_number:receipt.blockNumber.toString(),payer_address:receipt.from.toLowerCase(),
    fee_asset:'fee_token',unit:'token_base_units',fee_token_address:pathUsd,fee_manager_address:tempoFeeManager,fee_log_index:String(log.logIndex),gas_price_unit:'attousd',gas_price_scale:'1000000000000',
    gas_used:receipt.gasUsed.toString(),effective_gas_price:receipt.effectiveGasPrice.toString(),execution_fee_units:cost.toString(),blob_fee_units:'0',total_fee_units:cost.toString(),fee_transfer_amount_units:amount.toString()})
  return parsed.success?parsed.data:null
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
