import 'server-only'
import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import type { RequestPrincipal } from './request-principal'
import { getRequestOrigin } from './request-origin'
import { buyer_evm_payment_claims, buyer_mpp_payment_claims, buyer_mpp_payment_intents, evm_payment_intents, payment_receipts,
  route_agent_decisions, route_origins, route_plans } from './schema'
import { findTradeFundingStep, type RouteFundingSource } from './route-funding-steps'

export function attributeRouteOrigin(principal: RequestPrincipal, request: NextRequest, reference: string) {
  const channel = principal.kind === 'registered-agent' ? 'authenticated_agent' : principal.kind === 'mpp' ? 'mpp_wallet' : 'account'
  const requested = request.headers.get('X-ClawdMarket-Run-Kind')
  const suppressed = requested && ['canary', 'demo', 'reference', 'test'].includes(requested) ? requested : null
  const scopedCanary = principal.userId === process.env.CLAWDMARKET_ROUTE_CANARY_BUYER_ID
  const classified = suppressed || (/^(?:route-)?canary[-:]/i.test(reference) || scopedCanary ? 'canary' : /^reference[-:]/i.test(reference) ? 'reference' : null)
  const origin = new URL(getRequestOrigin(request))
  const production = process.env.VERCEL_ENV === 'production' && origin.protocol === 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)
  const cohort = classified === 'test' ? 'nonproduction' : classified || (production ? 'production' : 'nonproduction')
  return { channel, cohort } as Pick<typeof route_origins.$inferInsert, 'channel' | 'cohort'>
}

/** The financial claim and receipt, not a client-supplied automation flag, prove durable buyer funding. */
export async function hasDurableBuyerFunding(source: RouteFundingSource, tradeId: string) {
  const step = await findTradeFundingStep(source, tradeId)
  const [receipt] = await source.select().from(payment_receipts).where(eq(payment_receipts.trade_id, tradeId)).limit(1)
  if (!step || step.state !== 'funded' || !receipt?.tx_hash) return false
  const [evm] = await source.select().from(evm_payment_intents).where(eq(evm_payment_intents.trade_id, tradeId)).limit(1)
  const [tempo] = await source.select().from(buyer_mpp_payment_intents).where(eq(buyer_mpp_payment_intents.trade_id, tradeId)).limit(1)
  const [evmClaim] = evm ? await source.select().from(buyer_evm_payment_claims).where(eq(buyer_evm_payment_claims.intent_id, evm.id)).limit(1) : []
  const [tempoClaim] = tempo ? await source.select().from(buyer_mpp_payment_claims).where(eq(buyer_mpp_payment_claims.intent_id, tempo.id)).limit(1) : []
  const claim = receipt.payment_rail === 'evm' && evm?.buyer_operation_id ? evmClaim : receipt.payment_rail === 'mpp' && tempo?.buyer_operation_id ? tempoClaim : null
  return !!claim && claim.state === 'confirmed' && claim.tx_hash === receipt.tx_hash && claim.mandate_id === step.mandate_id && claim.terms_hash === step.terms_hash
}

/** Call only inside the first authenticated agent acceptance transaction. No economic permission is added. */
export async function recordAgentRouteDecision(source: RouteFundingSource, routeId: string, tradeId: string, buyerId: string, deliveryHash: string) {
  const [plan] = await source.select().from(route_plans).where(eq(route_plans.id, routeId)).limit(1)
  const [origin] = await source.select().from(route_origins).where(eq(route_origins.route_id, routeId)).limit(1)
  const step = await findTradeFundingStep(source, tradeId)
  if (!plan || plan.buyer_id !== buyerId || !buyerId.startsWith('user_agent_') || origin?.channel !== 'authenticated_agent'
    || step?.route_id !== routeId || step.order_id !== plan.service_order_id || !await hasDurableBuyerFunding(source, tradeId)) return false
  await source.insert(route_agent_decisions).values({ route_id: routeId, trade_id: tradeId, delivery_hash: deliveryHash }).onConflictDoNothing()
  return true
}
