import 'server-only'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { listings, payment_receipts, service_orders, trades } from '@/lib/schema'
import { advanceServiceOrder } from '@/lib/service-order-state'
import { queueFundedWorkOrder } from '@/lib/service-order-dispatch'
import { serviceFundingEligibility } from './service-funding-eligibility'
import { withKeyedWriteLock } from '@/lib/service-reservation-lock'
import { mandateFundingEligibility, recordMandateFunding } from './route-payment-mandate'

export class TradeFundingError extends Error {
  constructor(message: string, public readonly status: number, public readonly code: string) {
    super(message)
    this.name = 'TradeFundingError'
  }
}

export function paymentDeadlinePassed(trade: typeof trades.$inferSelect) {
  return Boolean(trade.payment_due_at && Date.parse(trade.payment_due_at) <= Date.now())
}

function sqliteBusy(error: unknown) {
  let current = error
  for (let depth = 0; current && typeof current === 'object' && depth < 6; depth += 1) {
    const cause = current as { code?: string; message?: string; cause?: unknown }
    if (cause.code === 'SQLITE_BUSY' || /SQLITE_BUSY|database is locked/i.test(cause.message || '')) return true
    current = cause.cause
  }
  return false
}

export async function expireTradePayment(trade: typeof trades.$inferSelect) {
  return withKeyedWriteLock(`trade-cancel:${trade.id}`, async () => {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        const [cancelled] = await db.transaction(async (tx) => {
          const rows = await tx.update(trades).set({ status: 'cancelled' })
            .where(and(eq(trades.id, trade.id), eq(trades.status, 'pending'))).returning()
          if (!rows[0]) return []
          await advanceServiceOrder(tx, trade.id, 'cancelled')
          const [serviceOrder] = await tx.select({ id: service_orders.id }).from(service_orders).where(eq(service_orders.trade_id, trade.id)).limit(1)
          if (!serviceOrder) await tx.update(listings).set({ status: 'active' }).where(and(eq(listings.id, trade.listing_id), eq(listings.status, 'sold')))
          return rows
        })
        return cancelled || null
      } catch (error) {
        if (!sqliteBusy(error) || attempt === 5) throw error
        await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** attempt))
      }
    }
    throw new Error('TRADE_CANCELLATION_UNAVAILABLE')
  })
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

function isUniqueProofConflict(error: unknown) {
  let current = error
  for (let depth = 0; current && typeof current === 'object' && depth < 8; depth += 1) {
    const cause = current as { code?: string; message?: string; cause?: unknown }
    if (cause.code === 'SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE constraint failed: payment_receipts\./i.test(cause.message || '')) return true
    current = cause.cause
  }
  return false
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
    const commit = () => db.transaction(async (tx) => {
      const [current] = await tx.select().from(trades).where(eq(trades.id, input.trade.id)).limit(1)
      if (!current || current.status !== 'pending') throw new TradeFundingError('Trade was funded or cancelled by another request', 409, 'TRADE_FUNDING_RACE')
      const reason = paymentDeadlinePassed(current) ? 'CHECKOUT_EXPIRED' : await mandateFundingEligibility(current, tx, input) || await serviceFundingEligibility(current, tx, 'proof_recovery')
      if (reason) {
        const [cancelled] = await tx.update(trades).set({ status: 'cancelled', payout_status: 'processing', fee_tx_hash: input.txHash, funded_at: new Date().toISOString() })
          .where(and(eq(trades.id, current.id), eq(trades.status, 'pending'))).returning()
        if (!cancelled) throw new TradeFundingError('Trade changed while verifying payment', 409, 'TRADE_FUNDING_RACE')
        await advanceServiceOrder(tx, current.id, 'cancelled')
        const [order] = await tx.select({ id: service_orders.id }).from(service_orders).where(eq(service_orders.trade_id, current.id)).limit(1)
        if (!order) await tx.update(listings).set({ status: 'active' }).where(and(eq(listings.id, current.listing_id), eq(listings.status, 'sold')))
        await tx.insert(payment_receipts).values(paymentReceiptValues(input))
        await recordMandateFunding(tx, current.id, 'rejected')
        return { trade: cancelled, rejection: reason }
      }
      const [funded] = await tx.update(trades).set({
        status: 'escrow_held',
        payout_status: 'pending',
        fee_tx_hash: input.txHash,
        funded_at: new Date().toISOString(),
        auto_confirm_at: new Date(Date.now() + 259200 * 1000).toISOString(),
      }).where(and(eq(trades.id, input.trade.id), eq(trades.status, 'pending'))).returning()
      if (!funded) throw new TradeFundingError('Trade was funded or cancelled by another request', 409, 'TRADE_FUNDING_RACE')
      await advanceServiceOrder(tx, input.trade.id, 'funded')
      await tx.insert(payment_receipts).values(paymentReceiptValues(input))
      await recordMandateFunding(tx, current.id, 'funded')
      await queueFundedWorkOrder(tx, input.trade.id, input.trade.seller_id)
      return { trade: funded, rejection: null }
    })
    const result = await withKeyedWriteLock(`trade-funding:${input.trade.id}`, async () => {
      for (let attempt = 0; ; attempt += 1) {
        try { return await commit() } catch (error) {
          if (!sqliteBusy(error) || attempt >= 5) throw error
          await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** attempt))
        }
      }
    })
    // Throw only after the verified proof and cancellation commit; callers use the existing refund outbox.
    if (result.rejection) throw new TradeFundingError(`Payment received after eligibility changed: ${result.rejection}`, 409, result.rejection === 'CHECKOUT_EXPIRED' ? 'CHECKOUT_EXPIRED' : 'PROVIDER_ELIGIBILITY_CHANGED')
    return result.trade
  } catch (error) {
    if (error instanceof TradeFundingError) {
      if (error.code === 'TRADE_FUNDING_RACE') {
        // Cancellation may have committed after the endpoint read a pending trade.
        // Tell the caller to record this verified proof on the cancelled trade for refund.
        const [current] = await db.select({ status: trades.status }).from(trades).where(eq(trades.id, input.trade.id)).limit(1)
        if (current?.status === 'cancelled') throw new TradeFundingError('Trade was cancelled while payment was verified', 409, 'TRADE_NOT_AWAITING_PAYMENT')
      }
      throw error
    }
    if (isUniqueProofConflict(error)) {
      throw new TradeFundingError('This payment proof is already attached to a trade', 409, 'PAYMENT_PROOF_REUSED')
    }
    throw error
  }
}

export async function recordCancelledExternalFunding(input: ExternalFundingInput) {
  const replay = async () => {
    const [existing] = await db.select().from(payment_receipts).where(eq(payment_receipts.trade_id, input.trade.id)).limit(1)
    if (!existing) return null
    const sameProof = existing.payment_rail === input.rail
      && existing.external_id === input.externalId
      && (existing.tx_hash || null) === input.txHash
    if (!sameProof) throw new TradeFundingError('Another payment proof is already attached to this trade', 409, 'PAYMENT_PROOF_REUSED')
    const [current] = await db.select().from(trades).where(eq(trades.id, input.trade.id)).limit(1)
    if (!current || current.status !== 'cancelled') throw new TradeFundingError('Trade is not a cancelled payment reservation', 409, 'TRADE_NOT_CANCELLED')
    return current
  }
  return withKeyedWriteLock(`cancelled-payment:${input.trade.id}`, async () => {
    const prior = await replay()
    if (prior) return prior
    try {
      const [updated] = await db.transaction(async (tx) => {
        const rows = await tx.update(trades).set({
          payout_status: 'processing',
          fee_tx_hash: input.txHash,
          funded_at: new Date().toISOString(),
        }).where(and(eq(trades.id, input.trade.id), eq(trades.status, 'cancelled'))).returning()
        if (!rows[0]) throw new TradeFundingError('Trade is not a cancelled payment reservation', 409, 'TRADE_NOT_CANCELLED')
        await tx.insert(payment_receipts).values(paymentReceiptValues(input))
        await recordMandateFunding(tx, input.trade.id, 'rejected')
        return rows
      })
      return updated
    } catch (error) {
      if (error instanceof TradeFundingError) throw error
      if (isUniqueProofConflict(error)) {
        const raced = await replay()
        if (raced) return raced
        throw new TradeFundingError('This payment proof is already attached to a trade', 409, 'PAYMENT_PROOF_REUSED')
      }
      throw error
    }
  })
}
