import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { isAddress, type Address, type Hash } from 'viem'
import { db } from '@/lib/db'
import { payment_receipts, trades } from '@/lib/schema'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { validateCsrf } from '@/lib/csrf'
import { getPaymentReadiness } from '@/lib/payment-config'
import { refundCancelledExternalTrade, SettlementError, verifyIncomingErc20Payment } from '@/lib/external-settlement'
import { recordCancelledExternalFunding, recordExternalTradeFunding, TradeFundingError } from '@/lib/trade-funding'
import { fireWebhook } from '@/lib/webhooks'

export const dynamic = 'force-dynamic'
const TX_HASH = /^0x[a-fA-F0-9]{64}$/

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const principal = await resolveRequestPrincipal(request)
  if (!principal) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (principal.usesCookieAuth && !validateCsrf(request)) return NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
  const { id } = await params
  const [trade] = await db.select().from(trades).where(eq(trades.id, id)).limit(1)
  if (!trade) return NextResponse.json({ error: 'Trade not found' }, { status: 404 })
  if (trade.buyer_id !== principal.userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (trade.payment_rail !== 'evm') return NextResponse.json({ error: 'Trade does not use EVM settlement' }, { status: 409 })
  if (trade.status === 'escrow_held') {
    const [receipt] = await db.select().from(payment_receipts).where(eq(payment_receipts.trade_id, trade.id)).limit(1)
    return NextResponse.json({ ok: true, trade, receipt, idempotent: true })
  }

  const body = await request.json().catch(() => null)
  const chainId = Number(body?.chain_id)
  const tokenAddress = String(body?.token_address || '')
  const txHash = String(body?.tx_hash || '')
  const payerAddress = String(body?.payer_address || '')
  if (!Number.isInteger(chainId) || chainId <= 0 || !isAddress(tokenAddress) || !TX_HASH.test(txHash) || !isAddress(payerAddress)) {
    return NextResponse.json({ error: 'chain_id, token_address, tx_hash, and payer_address are required' }, { status: 400 })
  }
  const readiness = getPaymentReadiness()
  if (!readiness.evm.enabled || !readiness.evm.treasury) return NextResponse.json({ error: 'EVM settlement is not configured', code: 'PAYMENT_RAIL_NOT_CONFIGURED' }, { status: 503 })

  try {
    const verified = await verifyIncomingErc20Payment({
      tradeId: trade.id,
      chainId,
      tokenAddress: tokenAddress as Address,
      txHash: txHash as Hash,
      treasuryAddress: readiness.evm.treasury,
      buyerAddress: payerAddress as Address,
      requiredUsd: trade.total_cost,
    })
    const funding = {
      trade, rail: 'evm', txHash, externalId: trade.id, payerAddress,
      tokenAddress, chainId, tokenSymbol: verified.token.symbol,
      tokenDecimals: verified.token.decimals, tokenAmount: verified.tokenAmount,
      tokenUsdPrice: verified.token.fixedUsdPrice, usdValue: verified.usdValue,
    } as const
    let funded
    try {
      funded = await recordExternalTradeFunding(funding)
    } catch (error) {
      if (!(error instanceof TradeFundingError) || !['CHECKOUT_EXPIRED', 'TRADE_NOT_AWAITING_PAYMENT'].includes(error.code)) throw error
      const [cancelled] = await db.select().from(trades).where(eq(trades.id, trade.id)).limit(1)
      if (!cancelled || cancelled.status !== 'cancelled') throw error
      await recordCancelledExternalFunding({ ...funding, trade: cancelled })
      const refund = await refundCancelledExternalTrade(cancelled)
      return NextResponse.json({
        ok: true,
        status: refund.complete ? 'late_payment_refunded' : 'late_payment_refund_processing',
        trade: { ...cancelled, payout_status: refund.complete ? 'refunded' : 'processing' },
        transfers: refund.transfers.map(({ id, kind, status, tx_hash }) => ({ id, kind, status, tx_hash })),
      }, { status: refund.complete ? 200 : 202 })
    }
    await Promise.allSettled([
      fireWebhook(trade.buyer_id, 'trade.status_changed', { trade: funded, old_status: 'pending', new_status: 'escrow_held', payment_rail: 'evm', tx_hash: txHash }),
      fireWebhook(trade.seller_id, 'trade.status_changed', { trade: funded, old_status: 'pending', new_status: 'escrow_held', payment_rail: 'evm', tx_hash: txHash }),
    ])
    return NextResponse.json({ ok: true, trade: funded, receipt: { tx_hash: txHash, chain_id: chainId, token_address: tokenAddress, token_amount: verified.tokenAmount.toString(), usd_value: verified.usdValue } })
  } catch (error) {
    if (error instanceof TradeFundingError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    if (error instanceof SettlementError) return NextResponse.json({ error: error.message, code: error.code, retryable: error.retryable }, { status: error.retryable ? 409 : 402 })
    console.error('[trade/fund/evm]', error)
    return NextResponse.json({ error: 'Payment verification failed', code: 'PAYMENT_VERIFICATION_FAILED' }, { status: 500 })
  }
}
