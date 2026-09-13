import 'server-only'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { listings, payment_receipts, trades } from '@/lib/schema'

export class TradeFundingError extends Error {
  constructor(message: string, public readonly status: number, public readonly code: string) {
    super(message)
    this.name = 'TradeFundingError'
  }
}

export function paymentDeadlinePassed(trade: typeof trades.$inferSelect) {
  return Boolean(trade.payment_due_at && Date.parse(trade.payment_due_at) <= Date.now())
}

export async function expireTradePayment(trade: typeof trades.$inferSelect) {
  const [cancelled] = await db.transaction(async (tx) => {
    const rows = await tx.update(trades).set({ status: 'cancelled' })
      .where(and(eq(trades.id, trade.id), eq(trades.status, 'pending'))).returning()
    if (!rows[0]) return []
    await tx.update(listings).set({ status: 'active' }).where(and(eq(listings.id, trade.listing_id), eq(listings.status, 'sold')))
    return rows
  })
  return cancelled || null
}

export type ExternalFundingInput = {
  trade: typeof trades.$inferSelect
  rail: 'mpp' | 'evm'
  txHash: string | null
  externalId: string
  payerAddress: string
  tokenAddress: string
  chainId: number
  tokenSymbol: string
  tokenDecimals: number
  tokenAmount: bigint
  tokenUsdPrice: number
  usdValue: number
}

function paymentReceiptValues(input: ExternalFundingInput) {
  return {
    route: `POST /api/trades/${input.trade.id}/fund/${input.rail}`,
    trade_id: input.trade.id,
    payment_rail: input.rail,
    amount: input.trade.total_cost,
    currency: input.tokenAddress.toLowerCase(),
    tx_hash: input.txHash,
    external_id: input.externalId,
    payer_address: input.payerAddress.toLowerCase(),
    token_address: input.tokenAddress.toLowerCase(),
    chain_id: input.chainId,
    token_symbol: input.tokenSymbol,
    token_decimals: input.tokenDecimals,
    token_amount: input.tokenAmount.toString(),
    token_usd_price: input.tokenUsdPrice,
    usd_value_at_payment: input.usdValue,
  } as const
}

export async function recordExternalTradeFunding(input: ExternalFundingInput) {
  if (input.trade.status !== 'pending') {
    if (input.trade.status === 'escrow_held') return input.trade
    throw new TradeFundingError('Trade is not awaiting payment', 409, 'TRADE_NOT_AWAITING_PAYMENT')
  }
  if (paymentDeadlinePassed(input.trade)) {
    await expireTradePayment(input.trade)
    throw new TradeFundingError('The checkout expired before payment was submitted', 410, 'CHECKOUT_EXPIRED')
  }
  try {
    return await db.transaction(async (tx) => {
      const [funded] = await tx.update(trades).set({
        status: 'escrow_held',
        payout_status: 'pending',
        fee_tx_hash: input.txHash,
        funded_at: new Date().toISOString(),
        auto_confirm_at: new Date(Date.now() + 259200 * 1000).toISOString(),
      }).where(and(eq(trades.id, input.trade.id), eq(trades.status, 'pending'))).returning()
      if (!funded) throw new TradeFundingError('Trade was funded or cancelled by another request', 409, 'TRADE_FUNDING_RACE')
      await tx.insert(payment_receipts).values(paymentReceiptValues(input))
      return funded
    })
  } catch (error) {
    if (error instanceof TradeFundingError) throw error
    const message = String(error).toLowerCase()
    if (message.includes('unique') || message.includes('constraint')) {
      throw new TradeFundingError('This payment proof is already attached to a trade', 409, 'PAYMENT_PROOF_REUSED')
    }
    throw error
  }
}

export async function recordCancelledExternalFunding(input: ExternalFundingInput) {
  const [existing] = await db.select().from(payment_receipts).where(eq(payment_receipts.trade_id, input.trade.id)).limit(1)
  if (existing) {
    const sameProof = existing.payment_rail === input.rail
      && existing.external_id === input.externalId
      && (existing.tx_hash || null) === input.txHash
    if (!sameProof) throw new TradeFundingError('Another payment proof is already attached to this trade', 409, 'PAYMENT_PROOF_REUSED')
    return input.trade
  }
  try {
    const [updated] = await db.transaction(async (tx) => {
      const rows = await tx.update(trades).set({
        payout_status: 'processing',
        fee_tx_hash: input.txHash,
        funded_at: new Date().toISOString(),
      }).where(and(eq(trades.id, input.trade.id), eq(trades.status, 'cancelled'))).returning()
      if (!rows[0]) throw new TradeFundingError('Trade is not a cancelled payment reservation', 409, 'TRADE_NOT_CANCELLED')
      await tx.insert(payment_receipts).values(paymentReceiptValues(input))
      return rows
    })
    return updated
  } catch (error) {
    if (error instanceof TradeFundingError) throw error
    const message = String(error).toLowerCase()
    if (message.includes('unique') || message.includes('constraint')) {
      throw new TradeFundingError('This payment proof is already attached to a trade', 409, 'PAYMENT_PROOF_REUSED')
    }
    throw error
  }
}
