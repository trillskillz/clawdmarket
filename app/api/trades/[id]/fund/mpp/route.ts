import { serviceFundingEligibility } from '@/lib/service-funding-eligibility'
import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { Errors, Receipt } from 'mppx'
import { z } from 'zod'
import { ArtifactError, readBoundedJson } from '@/lib/private-artifacts'
import { assertMarketplaceMppPullAllowed, marketplaceMppCharge, marketplaceMppCredential, marketplaceMppValidationRequest } from '@/lib/marketplace-mpp-payment'
import { verifyMarketplaceMppHash } from '@/lib/mpp-payment-proof'
import { parseUnits } from 'viem'
import { db } from '@/lib/db'
import { payment_receipts, trades } from '@/lib/schema'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { getMarketplaceMppServer } from '@/lib/mpp'
import { getPaymentReadiness } from '@/lib/payment-config'
import { recordCancelledExternalFunding, recordExternalTradeFunding, TradeFundingError } from '@/lib/trade-funding'
import { fireWebhook } from '@/lib/webhooks'
import { validateCsrf } from '@/lib/csrf'
import { refundCancelledExternalTrade } from '@/lib/external-settlement'
import { getNewPaymentControl, NEW_PAYMENTS_PAUSED_MESSAGE } from '@/lib/payment-control'

export const dynamic = 'force-dynamic'
const json = (value: unknown, init: ResponseInit = {}) => {
  const headers = new Headers(init.headers)
  headers.set('Cache-Control', 'private, no-store'); headers.set('Vary', 'Authorization, Cookie, Payment-Authorization, X-ClawdMarket-Agent-Key')
  return NextResponse.json(value, { ...init, headers })
}
const hashProof = z.object({ tx_hash: z.string().regex(/^0x[a-fA-F0-9]{64}$/), payer_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/) }).strict()

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const principal = await resolveRequestPrincipal(request)
  if (!principal) return json({ error: 'Authenticate with a ClawdMarket account or registered-agent key before paying' }, { status: 401 })
  if (principal.usesCookieAuth && !validateCsrf(request)) return json({ error: 'CSRF validation failed' }, { status: 403 })
  const { id } = await params
  const [trade] = await db.select().from(trades).where(eq(trades.id, id)).limit(1)
  if (!trade) return json({ error: 'Trade not found' }, { status: 404 })
  if (trade.buyer_id !== principal.userId) return json({ error: 'Forbidden' }, { status: 403 })
  if (trade.payment_rail !== 'mpp') return json({ error: 'Trade does not use MPP settlement' }, { status: 409 })
  if (trade.status === 'escrow_held') {
    const [receipt] = await db.select().from(payment_receipts).where(eq(payment_receipts.trade_id, trade.id)).limit(1)
    return json({ ok: true, trade, receipt, idempotent: true })
  }
  try {
    const credential = marketplaceMppCredential(request)
    let proof: z.infer<typeof hashProof> | undefined
    if (request.body) {
      const body = await readBoundedJson(request, 1_024, 10_000, true)
      if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Invalid MPP proof body', code: 'MPP_PAYMENT_PROOF_INVALID' }, { status: 400 })
      if (Object.keys(body).length) {
        const parsed = hashProof.safeParse(body)
        if (!parsed.success || credential) return json({ error: 'Supply one exact hash proof or one MPP credential', code: 'MPP_PAYMENT_PROOF_INVALID' }, { status: 400 })
        proof = parsed.data
      }
    }
    const hasPaymentProof = Boolean(credential || proof)
    const control = trade.status === 'pending' ? await getNewPaymentControl() : null
    const pausedResponse = () => json({ error: NEW_PAYMENTS_PAUSED_MESSAGE, code: 'NEW_PAYMENTS_PAUSED' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
    if (!hasPaymentProof && control?.paused) return pausedResponse()
    if (trade.status === 'cancelled' && !hasPaymentProof) return json({ error: 'This payment reservation was cancelled', code: 'TRADE_NOT_AWAITING_PAYMENT' }, { status: 410 })
    if (!['pending', 'cancelled'].includes(trade.status)) return json({ error: 'Trade is not awaiting payment' }, { status: 409 })

    if (!hasPaymentProof) {
      const reason = await serviceFundingEligibility(trade)
      if (reason === 'ROUTE_EXECUTION_PAUSED') return json({ error: 'New route payment authority is paused; recover original payments', code: reason, retryable: true }, { status: 503 })
      if (reason) return json({ error: 'Provider no longer satisfies checkout requirements; do not pay', code: 'PROVIDER_ELIGIBILITY_CHANGED', reason }, { status: 409 })
    }
    if (!proof && (!credential || credential.payload?.type === 'transaction')) await assertMarketplaceMppPullAllowed(trade.id, undefined,
      credential?.payload?.type === 'transaction' ? { serialized_transaction: credential.payload.signature, challenge: credential.challenge } : undefined)
    const readiness = getPaymentReadiness()
    if (!readiness.mpp.enabled) return json({ error: 'MPP settlement is not configured', code: 'PAYMENT_RAIL_NOT_CONFIGURED' }, { status: 503 })
    let payer: string, txHash: string, withReceipt = (response: Response): Response => response
    if (proof) {
      const verified = await verifyMarketplaceMppHash(trade, proof.tx_hash as `0x${string}`, proof.payer_address as `0x${string}`)
      payer = verified.payer; txHash = verified.hash
    } else {
      const mpp = getMarketplaceMppServer()
      if (!mpp) return json({ error: 'MPP settlement is not configured', code: 'PAYMENT_RAIL_NOT_CONFIGURED' }, { status: 503 })
      const headers = new Headers(request.headers)
      if (credential) {
        const { Credential } = await import('mppx')
        headers.set('payment-authorization', Credential.serialize(credential))
      }
      const paymentRequest = new Request(request.url, { method: 'POST', headers })
      const charge = marketplaceMppCharge(trade)
      const validated = credential ? await mpp.validateCredential(credential, { capturedRequest: paymentRequest, request: marketplaceMppValidationRequest(trade) }) : null
      const payment = await mpp.charge(charge)(paymentRequest)
      if (payment.status === 402) return control?.paused ? pausedResponse() : payment.challenge
      // The SDK's verified receipt is the actual canonical on-chain hash, including pull mode.
      const receipt = Receipt.fromResponse(payment.withReceipt(new Response()))
      if (!/^0x[a-fA-F0-9]{64}$/.test(receipt.reference) || !/^0x[a-fA-F0-9]{40}$/.test(validated?.details?.sender || '')) {
        throw new TradeFundingError('MPP verification did not establish a transaction and payer', 422, 'MPP_PAYMENT_PROOF_INVALID')
      }
      payer = validated.details.sender; txHash = receipt.reference
      withReceipt = (response) => payment.withReceipt(response)
    }
    const reference = txHash.toLowerCase()
    txHash = reference
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
      if (!(error instanceof TradeFundingError) || !['CHECKOUT_EXPIRED', 'TRADE_NOT_AWAITING_PAYMENT', 'PROVIDER_ELIGIBILITY_CHANGED'].includes(error.code)) throw error
      const [cancelled] = await db.select().from(trades).where(eq(trades.id, trade.id)).limit(1)
      if (!cancelled || cancelled.status !== 'cancelled') throw error
      await recordCancelledExternalFunding({ ...funding, trade: cancelled })
      const refund = await refundCancelledExternalTrade(cancelled, { process: false })
      return withReceipt(json({
        ok: true,
        rejection_code: error.code,
        rejection_reason: error.message,
        status: refund.complete ? 'late_payment_refunded' : 'late_payment_refund_processing',
        trade: { ...cancelled, payout_status: refund.complete ? 'refunded' : 'processing' },
        transfers: refund.transfers.map(({ id, kind, status, tx_hash }) => ({ id, kind, status, tx_hash })),
      }, { status: refund.complete ? 200 : 202 }))
    }
    await Promise.allSettled([
      fireWebhook(trade.buyer_id, 'trade.status_changed', { trade: funded, old_status: 'pending', new_status: 'escrow_held', payment_rail: 'mpp', payment_reference: reference }),
      fireWebhook(trade.seller_id, 'trade.status_changed', { trade: funded, old_status: 'pending', new_status: 'escrow_held', payment_rail: 'mpp', payment_reference: reference }),
    ])
    return withReceipt(json({ ok: true, trade: funded, receipt: { payment_reference: reference, chain_id: readiness.mpp.chainId, token_address: readiness.mpp.currency } }))
  } catch (error) {
    if (error instanceof TradeFundingError) return json({ error: error.message, code: error.code, ...(error.code === 'PAYMENT_CONFIRMING' ? { retryable: true } : {}) }, { status: error.status, headers: { 'Cache-Control': 'private, no-store' } })
    if (error instanceof Errors.PaymentError) return json({ error: 'MPP credential was rejected; retain the original payment for hash recovery', code: 'MPP_CREDENTIAL_REJECTED' }, { status: error.status })
    if (error instanceof ArtifactError) return json({ error: error.code, code: error.code }, { status: error.status })
    console.error('[trade/fund/mpp] verification failed')
    return json({ error: 'MPP payment verification failed', code: 'PAYMENT_VERIFICATION_FAILED' }, { status: 500 })
  }
}
