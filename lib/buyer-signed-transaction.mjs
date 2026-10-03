import { encodeFunctionData, erc20Abi, keccak256, parseTransaction, recoverTransactionAddress } from 'viem'

/** Validate the exact payment before a buyer worker may submit its durable bytes. */
export async function inspectSignedEvmPayment(raw, intent, payment) {
  const fail = () => { throw new Error('BUYER_TRANSACTION_SCOPE_MISMATCH') }
  if (typeof raw !== 'string' || !/^0x(?:[0-9a-fA-F]{2}){1,4096}$/.test(raw)) fail()
  let transaction, sender
  try {
    transaction = parseTransaction(raw)
    sender = await recoverTransactionAddress({ serializedTransaction: raw })
  } catch { fail() }
  if (!['eip1559', 'legacy'].includes(transaction.type) || transaction.chainId !== intent.chain_id
    || intent.chain_id !== payment.chain_id || !Number.isSafeInteger(transaction.nonce) || transaction.nonce < 0
    || sender.toLowerCase() !== intent.payer_address.toLowerCase() || sender.toLowerCase() !== payment.payer_address.toLowerCase()
    || transaction.to?.toLowerCase() !== intent.token_address.toLowerCase() || intent.token_address.toLowerCase() !== payment.token_address.toLowerCase()
    || intent.treasury_address.toLowerCase() !== payment.treasury_address.toLowerCase()
    || (transaction.value ?? 0n) !== 0n) fail()
  let amount, limit
  try { amount = BigInt(intent.token_amount); limit = BigInt(payment.max_gas_cost_wei) } catch { fail() }
  if (amount <= 0n || amount >= 2n ** 256n || limit <= 0n) fail()
  const data = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [intent.treasury_address, amount] })
  if (transaction.data?.toLowerCase() !== data.toLowerCase()) fail()
  const price = transaction.type === 'eip1559' ? transaction.maxFeePerGas : transaction.gasPrice
  if (!transaction.gas || transaction.gas <= 0n || !price || price <= 0n
    || transaction.type === 'eip1559' && (transaction.maxPriorityFeePerGas ?? 0n) > price) fail()
  const executionCost = transaction.gas * price
  if (executionCost > limit) throw new Error('BUYER_TRANSACTION_GAS_LIMIT')
  return { tx_hash: keccak256(raw), payer_address: sender.toLowerCase(), chain_id: Number(transaction.chainId), nonce: Number(transaction.nonce),
    token_amount: amount.toString(), maximum_execution_gas_cost_wei: executionCost.toString() }
}

/** Outstanding authorizations count even when submission or confirmation is unknown. */
export function assertBuyerWalletReserve({ tokenBalance, nativeBalance, paymentAmount, gasCost, outstandingToken = 0n, outstandingGas = 0n, payment }) {
  const tokenReserve = BigInt(payment.minimum_token_reserve_units), nativeReserve = BigInt(payment.minimum_native_reserve_wei), gasLimit = BigInt(payment.max_gas_cost_wei)
  if ([tokenBalance, nativeBalance, paymentAmount, gasCost, outstandingToken, outstandingGas, tokenReserve, nativeReserve, gasLimit].some((value) => typeof value !== 'bigint' || value < 0n)
    || paymentAmount <= 0n || gasCost <= 0n || gasCost > gasLimit) throw new Error('BUYER_WALLET_BOUNDS_INVALID')
  if (tokenBalance - outstandingToken - paymentAmount < tokenReserve) throw new Error('BUYER_TOKEN_RESERVE_REQUIRED')
  if (nativeBalance - outstandingGas - gasCost < nativeReserve) throw new Error('BUYER_NATIVE_RESERVE_REQUIRED')
}
