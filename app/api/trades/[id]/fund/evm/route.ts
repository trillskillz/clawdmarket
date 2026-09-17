import { NextRequest, NextResponse } from 'next/server'
import { and, eq, isNull, or } from 'drizzle-orm'
import { isAddress, type Address, type Hash } from 'viem'
import { db } from '@/lib/db'
import { evm_payment_intents, payment_receipts, trades } from '@/lib/schema'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { validateCsrf } from '@/lib/csrf'
import { getPaymentReadiness } from '@/lib/payment-config'
import { refundCancelledExternalTrade, SettlementError, verifyIncomingErc20Payment } from '@/lib/external-settlement'
import { recordCancelledExternalFunding, recordExternalTradeFunding, TradeFundingError } from '@/lib/trade-funding'
import { fireWebhook } from '@/lib/webhooks'
import { evmPaymentProofMessage, verifyEvmPaymentProof } from '@/lib/evm-payment-proof'

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
  if (['escrow_held', 'pending_release', 'completed', 'complete', 'resolved', 'disputed'].includes(trade.status)) {
    const [receipt] = await db.select().from(payment_receipts).where(eq(payment_receipts.trade_id, trade.id)).limit(1)
    return NextResponse.json({ ok: true, trade, receipt, idempotent: true })
  }

  const body = await request.json().catch(() => null)
  const chainId = Number(body?.chain_id)
  const tokenAddress = String(body?.token_address || '')
  const txHash = String(body?.tx_hash || '').toLowerCase()
  const payerAddress = String(body?.payer_address || '')
  if (!Number.isInteger(chainId) || chainId <= 0 || !isAddress(tokenAddress) || !TX_HASH.test(txHash) || !isAddress(payerAddress)) {
    return NextResponse.json({ error: 'chain_id, token_address, tx_hash, and payer_address are required' }, { status: 400 })
  }
  const readiness = getPaymentReadiness()
  if (!readiness.evm.enabled || !readiness.evm.treasury) return NextResponse.json({ error: 'EVM settlement is not configured', code: 'PAYMENT_RAIL_NOT_CONFIGURED' }, { status: 503 })

  try {
    const [intent] = await db.select().from(evm_payment_intents).where(eq(evm_payment_intents.trade_id, trade.id)).limit(1)
    if (!intent) return NextResponse.json({ error: 'Create a payment intent before sending funds. Contact support for a transfer sent by an older client.', code: 'PAYMENT_INTENT_REQUIRED' }, { status: 409 })
    if (body.intent_id !== intent.id || chainId !== intent.chain_id || payerAddress.toLowerCase() !== intent.payer_address
      || tokenAddress.toLowerCase() !== intent.token_address || intent.buyer_id !== principal.userId) {
      return NextResponse.json({ error: 'Payment proof does not match the reserved intent', code: 'PAYMENT_INTENT_MISMATCH' }, { status: 409 })
    }
    if (intent.tx_hash && intent.tx_hash !== txHash) return NextResponse.json({ error: 'This intent already has a transaction. Resume it; do not send another payment.', code: 'PAYMENT_TRANSACTION_CONFLICT' }, { status: 409 })
    const signature = String(body.payer_signature || intent.payer_signature || '')
    if (!signature) return NextResponse.json({
      error: 'The payer must authorize this exact transfer for this trade', code: 'PAYER_AUTHORIZATION_REQUIRED',
      message: evmPaymentProofMessage(intent, txHash),
    }, { status: 428, headers: { 'Cache-Control': 'no-store' } })
    if (!await verifyEvmPaymentProof(intent, txHash, signature)) {
      return NextResponse.json({ error: 'Invalid payer signature for this trade and transaction', code: 'PAYER_AUTHORIZATION_INVALID' }, { status: 403 })
    }
    // Persist authorized proof before RPC confirmation. Another device can
    // resume this same hash even if this request or the RPC connection fails.
    const [saved] = await db.update(evm_payment_intents).set({ tx_hash: txHash, payer_signature: signature })
      .where(and(eq(evm_payment_intents.id, intent.id), or(isNull(evm_payment_intents.tx_hash), eq(evm_payment_intents.tx_hash, txHash)))).returning()
    if (!saved) return NextResponse.json({ error: 'Another transaction is already attached to this intent', code: 'PAYMENT_TRANSACTION_CONFLICT' }, { status: 409 })
    const verified = await verifyIncomingErc20Payment({
      tradeId: trade.id,
      chainId,
      tokenAddress: tokenAddress as Address,
      txHash: txHash as Hash,
      treasuryAddress: intent.treasury_address as Address,
      buyerAddress: intent.payer_address as Address,
      requiredUsd: intent.amount_usd,
      requiredTokenAmount: BigInt(intent.token_amount),
      notBefore: intent.created_at,
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
