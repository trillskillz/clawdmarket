import 'server-only'
import { eq } from 'drizzle-orm'
import { Credential, Errors } from 'mppx'
import { keccak256, toHex } from 'viem'
import { db } from '@/lib/db'
import { route_funding_steps, route_plans, service_orders, trades } from '@/lib/schema'
import { getNewPaymentControl } from '@/lib/payment-control'
import { serviceFundingEligibility } from '@/lib/service-funding-eligibility'
import { mandateFundingEligibility } from '@/lib/route-payment-mandate'
import { routeExecutionEnabled } from '@/lib/routing-feature-flags'
import { getPaymentReadiness } from '@/lib/payment-config'
import { TradeFundingError } from '@/lib/trade-funding'

export function marketplaceMppMemo(tradeId: string) {
  return keccak256(toHex(`clawdmarket:${tradeId}`))
}
export function marketplaceMppCharge(trade: typeof trades.$inferSelect) {
  return { amount: trade.total_cost.toFixed(2), description: `Fund ClawdMarket trade ${trade.id}`,
    externalId: trade.id, memo: marketplaceMppMemo(trade.id), expires: trade.payment_due_at || undefined }
}

// Standalone SDK validation accepts payment request fields; description/expiry are charge handler options.
export function marketplaceMppValidationRequest(trade: typeof trades.$inferSelect) {
  const { amount, externalId, memo } = marketplaceMppCharge(trade)
  return { amount, externalId, memo }
}

/** Separate the account/agent identity from the payment credential. Legacy cookie/agent-key callers remain supported. */
export function marketplaceMppCredential(request: Request) {
  const dedicated = request.headers.get('payment-authorization')
  const legacy = /^Payment\s/i.test(request.headers.get('authorization') || '') ? request.headers.get('authorization') : null
  if (dedicated && legacy && dedicated !== legacy) throw new TradeFundingError('Conflicting MPP credentials', 400, 'MPP_CREDENTIAL_INVALID')
  const header = dedicated || legacy
  if (!header) return null
  if (Buffer.byteLength(header) > 16_384) throw new TradeFundingError('MPP credential exceeds the supported bound', 413, 'MPP_CREDENTIAL_TOO_LARGE')
  try { return Credential.deserialize<any>(header) } catch { throw new TradeFundingError('Malformed MPP credential', 400, 'MPP_CREDENTIAL_INVALID') }
}

/** Permission for a new external effect, always checked from current database state. Hash proofs bypass this guard. */
export async function assertMarketplaceMppPullAllowed(tradeId: string, payer?: string) {
  const [trade] = await db.select().from(trades).where(eq(trades.id, tradeId)).limit(1)
  if (!trade || trade.payment_rail !== 'mpp' || trade.status !== 'pending' || !trade.payment_due_at || !(Date.parse(trade.payment_due_at) > Date.now())) {
    throw new TradeFundingError('Recover the existing payment by hash; no new broadcast is permitted', 409, 'MPP_BROADCAST_NOT_ALLOWED')
  }
  if ((await getNewPaymentControl()).paused) throw new TradeFundingError('New payments are paused', 503, 'NEW_PAYMENTS_PAUSED')
  const [route] = await db.select({ id: route_plans.id }).from(route_plans)
    .innerJoin(service_orders, eq(route_plans.service_order_id, service_orders.id)).where(eq(service_orders.trade_id, tradeId)).limit(1)
  if (route && !routeExecutionEnabled(trade.buyer_id)) throw new TradeFundingError('Route execution is disabled; recover an existing payment by hash', 409, 'ROUTE_EXECUTION_DISABLED')
  const ready = getPaymentReadiness().mpp
  const reason = await mandateFundingEligibility(trade, db, payer ? { rail: 'mpp', chainId: ready.chainId,
    tokenAddress: ready.currency, payerAddress: payer, treasuryAddress: ready.recipient || '' } : undefined)
    || await serviceFundingEligibility(trade)
  if (reason) throw new TradeFundingError('Current checkout authority does not permit a new broadcast', 409, reason)
  const [step] = await db.select({ id: route_funding_steps.id }).from(route_funding_steps).where(eq(route_funding_steps.trade_id, tradeId)).limit(1)
  // Tempo fees use token units. EVM wei reserve terms and a credential timeout are insufficient automatic funding authority.
  if (step) throw new TradeFundingError('MPP mandate pull funding requires the durable buyer protocol; recover an existing payment by hash', 409, 'MPP_MANDATE_PULL_NOT_READY')
}

class MppBroadcastDenied extends Errors.PaymentError {
  readonly status: number
  title = 'New broadcast is not permitted'
  type = 'https://clawdmkt.com/problems/mpp-broadcast-denied'
  constructor(error: TradeFundingError) { super(error.message, { details: { code: error.code } }); this.status = error.status }
}
function safeSdkError(error: unknown): never {
  if (error instanceof TradeFundingError) throw new MppBroadcastDenied(error)
  if (error instanceof Errors.PaymentError) throw error
  // RPC error objects can embed signed authorization bytes. Keep them out of SDK error logging.
  throw new Errors.VerificationFailedError({ reason: 'Original payment verification did not complete; retain its hash for read-only recovery' })
}

/** The SDK may simulate/validate before broadcast. Recheck permission at the method's actual mutation boundary. */
export function guardMarketplaceMppMethod<T extends { validate?: (...args: any[]) => Promise<any>; broadcast?: (...args: any[]) => Promise<any> }>(method: T): T {
  const validate = method.validate, broadcast = method.broadcast
  if (!validate || !broadcast) throw new Error('Marketplace MPP requires separate validation and broadcast')
  return { ...method,
    async validate(...args: any[]) { try { return await validate(...args) } catch (error) { return safeSdkError(error) } },
    async broadcast(...args: any[]) {
      try {
        const parameters = args[0]
        if (parameters.credential.payload.type === 'transaction') {
          const validated = await validate(...args)
          const tradeId = parameters.request.externalId
          if (typeof tradeId !== 'string' || !validated.details?.sender) throw new TradeFundingError('MPP payment scope is invalid', 409, 'MPP_CREDENTIAL_INVALID')
          await assertMarketplaceMppPullAllowed(tradeId, validated.details.sender)
        }
        return await broadcast(...args)
      } catch (error) { return safeSdkError(error) }
    },
  }
}
