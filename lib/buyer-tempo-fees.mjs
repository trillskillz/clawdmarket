const uint256 = 2n ** 256n
const scale = 1_000_000_000_000n
const address = /^0x[0-9a-fA-F]{40}$/
function units(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]{0,77})$/.test(value)) throw new Error('BUYER_TEMPO_FEE_TERMS_INVALID')
  const amount = BigInt(value)
  if (amount >= uint256) throw new Error('BUYER_TEMPO_FEE_TERMS_INVALID')
  return amount
}

/** Tempo gas prices use 18-decimal USD; six-decimal TIP-20 cost rounds up. */
export function tempoMaximumFeeUnits(gas, maxFeePerGas) {
  if (typeof gas !== 'bigint' || typeof maxFeePerGas !== 'bigint' || gas <= 0n || maxFeePerGas <= 0n
    || gas >= uint256 || maxFeePerGas >= uint256 || gas * maxFeePerGas >= uint256) throw new Error('BUYER_TEMPO_FEE_BOUNDS_INVALID')
  return (gas * maxFeePerGas + scale - 1n) / scale
}

/** One shared token balance pays both principal and fees; uncertain claims still consume reserve. */
export function assertBuyerTempoReserve({ tokenBalance, paymentAmount, maximumFeeUnits, outstandingToken = 0n, outstandingFees = 0n, payment }) {
  if (payment?.rail !== 'mpp' || !address.test(payment.token_address || '') || !address.test(payment.fee_token_address || '')
    || payment.fee_token_address.toLowerCase() !== payment.token_address.toLowerCase()) throw new Error('BUYER_TEMPO_FEE_TERMS_INVALID')
  const tokenReserve = units(payment.minimum_token_reserve_units), feeReserve = units(payment.minimum_fee_token_reserve_units),
    feeLimit = units(payment.max_fee_token_cost_units)
  if ([tokenBalance, paymentAmount, maximumFeeUnits, outstandingToken, outstandingFees].some((value) => typeof value !== 'bigint' || value < 0n || value >= uint256)
    || paymentAmount <= 0n || maximumFeeUnits <= 0n || maximumFeeUnits > feeLimit) throw new Error('BUYER_TEMPO_FEE_BOUNDS_INVALID')
  const remaining = tokenBalance - paymentAmount - maximumFeeUnits - outstandingToken - outstandingFees
  if (remaining < tokenReserve || remaining < feeReserve) throw new Error('BUYER_TEMPO_TOKEN_RESERVE_REQUIRED')
}
