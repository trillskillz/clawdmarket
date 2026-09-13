import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { Credential } from 'mppx'
import { parseUnits } from 'viem'
import { db } from '@/lib/db'
import { payment_receipts, trades } from '@/lib/schema'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { getMarketplaceMppServer } from '@/lib/mpp'
import { getPaymentReadiness } from '@/lib/payment-config'
import { addressFromSource } from '@/lib/trade-escrow'
import { recordCancelledExternalFunding, recordExternalTradeFunding, TradeFundingError } from '@/lib/trade-funding'
import { fireWebhook } from '@/lib/webhooks'
import { validateCsrf } from '@/lib/csrf'
import { refundCancelledExternalTrade } from '@/lib/external-settlement'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const principal = await resolveRequestPrincipal(request)
  if (!principal) return NextResponse.json({ error: 'Authenticate with a ClawdMarket account or registered-agent key before paying' }, { status: 401 })
  if (principal.usesCookieAuth && !validateCsrf(request)) return NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
  const { id } = await params
  const [trade] = await db.select().from(trades).where(eq(trades.id, id)).limit(1)
  if (!trade) return NextResponse.json({ error: 'Trade not found' }, { status: 404 })
  if (trade.buyer_id !== principal.userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (trade.payment_rail !== 'mpp') return NextResponse.json({ error: 'Trade does not use MPP settlement' }, { status: 409 })
  if (trade.status === 'escrow_held') {
    const [receipt] = await db.select().from(payment_receipts).where(eq(payment_receipts.trade_id, trade.id)).limit(1)
    return NextResponse.json({ ok: true, trade, receipt, idempotent: true })
  }
  let hasPaymentCredential = false
  try { Credential.fromRequest(request); hasPaymentCredential = true } catch {}
  if (trade.status === 'cancelled' && !hasPaymentCredential) {
    return NextResponse.json({ error: 'This payment reservation was cancelled', code: 'TRADE_NOT_AWAITING_PAYMENT' }, { status: 410 })
  }
  if (!['pending', 'cancelled'].includes(trade.status)) return NextResponse.json({ error: 'Trade is not awaiting payment' }, { status: 409 })
  const readiness = getPaymentReadiness()
  const mpp = getMarketplaceMppServer()
  if (!readiness.mpp.enabled || !mpp) return NextResponse.json({ error: 'MPP settlement is not configured', code: 'PAYMENT_RAIL_NOT_CONFIGURED' }, { status: 503 })

  try {
    const payment = await mpp.charge({
      amount: trade.total_cost.toFixed(2),
      description: `Fund ClawdMarket trade ${trade.id}`,
      externalId: trade.id,
      memo: `clawdmarket:${trade.id}`,
      expires: trade.payment_due_at || undefined,
    })(request)
    if (payment.status === 402) return payment.challenge

    const credential = Credential.fromRequest<any>(request)
    const payer = addressFromSource(credential.source ?? null)
    if (!payer) return NextResponse.json({ error: 'Verified MPP payment did not include a payer address' }, { status: 402 })
    const payload = credential?.payload || {}
    const reference = String(payload.hash || payload.signature || credential?.challenge?.id || trade.id)
    const txHash = /^0x[a-fA-F0-9]{64}$/.test(reference) ? reference : null
    const funding = {
      trade,
      rail: 'mpp',
      txHash,
      externalId: reference,
      payerAddress: payer,
      tokenAddress: readiness.mpp.currency,
      chainId: readiness.mpp.chainId,
      tokenSymbol: 'pathUSD',
      tokenDecimals: 6,
      tokenAmount: parseUnits(trade.total_cost.toFixed(2), 6),
      tokenUsdPrice: 1,
      usdValue: trade.total_cost,
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
      return payment.withReceipt(NextResponse.json({
        ok: true,
        status: refund.complete ? 'late_payment_refunded' : 'late_payment_refund_processing',
        trade: { ...cancelled, payout_status: refund.complete ? 'refunded' : 'processing' },
        transfers: refund.transfers.map(({ id, kind, status, tx_hash }) => ({ id, kind, status, tx_hash })),
      }, { status: refund.complete ? 200 : 202 }))
    }
    await Promise.allSettled([
      fireWebhook(trade.buyer_id, 'trade.status_changed', { trade: funded, old_status: 'pending', new_status: 'escrow_held', payment_rail: 'mpp', payment_reference: reference }),
      fireWebhook(trade.seller_id, 'trade.status_changed', { trade: funded, old_status: 'pending', new_status: 'escrow_held', payment_rail: 'mpp', payment_reference: reference }),
    ])
    return payment.withReceipt(NextResponse.json({ ok: true, trade: funded, receipt: { payment_reference: reference, chain_id: readiness.mpp.chainId, token_address: readiness.mpp.currency } }))
  } catch (error) {
    if (error instanceof TradeFundingError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    console.error('[trade/fund/mpp]', error)
    return NextResponse.json({ error: 'MPP payment verification failed', code: 'PAYMENT_VERIFICATION_FAILED' }, { status: 500 })
  }
}
