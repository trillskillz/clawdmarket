import { encodeFunctionData, keccak256, toHex } from 'viem'
import { Abis, Secp256k1, Transaction } from 'viem/tempo'
import { tempoMaximumFeeUnits } from './buyer-tempo-fees.mjs'

/** Inspect exact unsponsored root-key Tempo bytes. No RPC, signing or broadcast. */
export async function inspectSignedTempoPayment(raw, intent, payment) {
  const fail = () => { throw new Error('BUYER_TEMPO_TRANSACTION_SCOPE_MISMATCH') }
  if (payment?.rail !== 'mpp' || typeof raw !== 'string' || !/^0x76(?:[0-9a-fA-F]{2}){1,4096}$/.test(raw)) fail()
  let transaction, sender, amount, deadline, maximumFee
  try {
    transaction = Transaction.deserialize(raw)
    if (transaction.signature?.type !== 'secp256k1' || transaction.feePayerSignature !== undefined
      || transaction.authorizationList?.length || transaction.keyAuthorization || transaction.multisig || transaction.accessList?.length) fail()
    // Recover independently: the envelope can include an explicit sender field.
    const unsigned = await Transaction.serialize({ ...transaction, signature: undefined, from: undefined })
    sender = Secp256k1.recoverAddress({ payload: keccak256(unsigned), signature: transaction.signature.signature })
    const canonical = await Transaction.serialize({ ...transaction, from: undefined })
    if (canonical.toLowerCase() !== raw.toLowerCase()) fail()
    amount = BigInt(intent.token_amount); deadline = Math.floor(Date.parse(intent.expires_at) / 1000)
    maximumFee = tempoMaximumFeeUnits(transaction.gas, transaction.maxFeePerGas)
  } catch { fail() }
  if (!Number.isSafeInteger(intent.chain_id) || transaction.chainId !== intent.chain_id || payment.chain_id !== intent.chain_id
    || sender.toLowerCase() !== intent.payer_address?.toLowerCase() || sender.toLowerCase() !== payment.payer_address?.toLowerCase()
    || payment.token_address?.toLowerCase() !== intent.token_address?.toLowerCase()
    || payment.treasury_address?.toLowerCase() !== intent.treasury_address?.toLowerCase()
    || transaction.feeToken?.toLowerCase() !== payment.fee_token_address?.toLowerCase()
    || payment.fee_token_address?.toLowerCase() !== payment.token_address?.toLowerCase()
    || !Number.isSafeInteger(transaction.nonce) || transaction.nonce < 0 || (transaction.nonceKey ?? 0n) !== 0n
    || amount <= 0n || amount >= 2n ** 256n || !Number.isSafeInteger(deadline)
    || !Number.isSafeInteger(transaction.validBefore) || transaction.validBefore <= 0 || transaction.validBefore > deadline
    || (transaction.validAfter ?? 0) !== 0 || (transaction.maxPriorityFeePerGas ?? 0n) < 0n
    || (transaction.maxPriorityFeePerGas ?? 0n) > transaction.maxFeePerGas || transaction.calls?.length !== 1) fail()
  const call = transaction.calls[0]
  const memo = keccak256(toHex(`clawdmarket:${intent.trade_id}`))
  const data = encodeFunctionData({ abi: Abis.tip20, functionName: 'transferWithMemo', args: [intent.treasury_address, amount, memo] })
  if (call.to?.toLowerCase() !== intent.token_address.toLowerCase() || (call.value ?? 0n) !== 0n || call.data?.toLowerCase() !== data.toLowerCase()) fail()
  let limit
  try {
    if (typeof payment.max_fee_token_cost_units !== 'string' || !/^[1-9][0-9]{0,77}$/.test(payment.max_fee_token_cost_units)) fail()
    limit = BigInt(payment.max_fee_token_cost_units)
    if (limit >= 2n ** 256n) fail()
  } catch { fail() }
  if (maximumFee > limit) throw new Error('BUYER_TEMPO_TRANSACTION_FEE_LIMIT')
  return { tx_hash: keccak256(raw), payer_address: sender.toLowerCase(), chain_id: Number(transaction.chainId), nonce: Number(transaction.nonce),
    nonce_key: '0', token_amount: amount.toString(), fee_token_address: transaction.feeToken.toLowerCase(),
    maximum_fee_token_cost_units: maximumFee.toString(), valid_before: transaction.validBefore }
}
