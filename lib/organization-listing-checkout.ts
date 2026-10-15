import 'server-only'
import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from './db'
import { listings, organization_listing_authorizations as grants, organization_listing_uses as uses, payment_controls, trades } from './schema'
import { organizationListingCheckoutInput, currentListingReview, validatedListingTerms } from './organization-listing-authorizations'
import { originalListingPayment, organizationListingExposure } from './organization-listing-uses'
import { PurchasingError, purchasingTransaction, type PurchasingSource } from './organization-purchasing-transaction'
import { canonicalContract } from './structured-verification'
import { calculateTradeFinancials } from './settlement'
import { enforceAgentSpendPolicy } from './agent-spend-policy'
import { issuePurchaseEvidence } from './organization-purchase-evidence'
import { attributeOrganizationTrade } from './organization-budgets'
import { checkoutForTrade } from './trade-checkout'
import { getPaymentReadiness } from './payment-config'
import { NEW_PAYMENTS_CONTROL_KEY } from './payment-control'

type Grant = typeof grants.$inferSelect
type Terms = ReturnType<typeof validatedListingTerms>
const hash = (value: unknown) => createHash('sha256').update(canonicalContract(value)).digest('hex')
function fail(code: string, status = 409): never { throw new PurchasingError(code, status) }

async function grant(source: PurchasingSource, orgId: string, id: string, buyerId: string) {
  const [row] = await source.select().from(grants).where(and(eq(grants.organization_id, orgId), eq(grants.id, id))).limit(1)
  if (!row || row.buyer_id !== buyerId) return fail('ORGANIZATION_LISTING_NOT_FOUND', 404)
  return row
}

export async function assertListingExposure(source: PurchasingSource, row: Grant, terms: Terms, excludeTradeId = '') {
  const { readOriginalOrganizationRouteExposure } = await import('./organization-route-authorizations')
  const { organizationWorkflowExposure } = await import('./organization-workflow-authorizations')
  const { organizationTaskExposure } = await import('./organization-task-authorizations')
  const route = await readOriginalOrganizationRouteExposure(source, row.organization_id, row.buyer_id, terms.payment)
  const workflow = await organizationWorkflowExposure(source, row.organization_id, row.buyer_id, terms.payment)
  const task = await organizationTaskExposure(source, row.organization_id, row.buyer_id, terms.payment)
  const listing = await organizationListingExposure(source, row.organization_id, row.buyer_id, terms.payment, excludeTradeId)
  const all = [route, workflow, task, listing]
  for (const [window, limit] of [['daily', terms.max_daily_minor], ['monthly', terms.max_monthly_minor], ['lifetime', terms.max_lifetime_minor]] as const) {
    const spent = all.reduce((total, entry) => total + entry[window], 0)
    if (!Number.isSafeInteger(spent) || spent + terms.total_minor > limit) fail(`ORGANIZATION_LISTING_${window.toUpperCase()}_EXPOSURE`)
  }
  const fees = all.reduce((total, entry) => total + (terms.payment.rail === 'evm' ? entry.gas : entry.fees), 0n)
  const perPayment = terms.payment.rail === 'evm' ? terms.payment.max_gas_cost_wei : terms.payment.max_fee_token_cost_units
  if (fees + BigInt(perPayment) > BigInt(terms.max_lifetime_chain_fee_units)) fail('ORGANIZATION_LISTING_FEE_EXPOSURE')
}

export function listingPurchaseEvidence(row: Grant, terms: Terms) {
  return issuePurchaseEvidence({ approvalId: row.id, requestHash: row.authority_hash, buyerId: row.buyer_id,
    totalMinor: terms.total_minor, sellerId: row.seller_id, paymentRail: terms.payment.rail })
}

function dto(row: Grant, terms: Terms, trade: typeof trades.$inferSelect | null) {
  return { ok: true as const, authorization_id: row.id, authority_hash: row.authority_hash, listing_id: row.listing_id,
    trade, checkout: trade ? checkoutForTrade(trade) : null, delivery_contract: terms.delivery,
    payment_authority: { id: row.id, kind: terms.version === 1 ? 'organization_listing_v1' as const : 'organization_listing_v2' as const,
      authority_hash: row.authority_hash, terms: { payment: terms.payment, token_decimals: terms.token_decimals, token_usd_price: terms.token_usd_price,
        ...(terms.fee_token_decimals === undefined ? {} : { fee_token_decimals: terms.fee_token_decimals }), expires_at: terms.expires_at } } }
}

export async function inspectOrganizationListingCheckout(orgId: string, id: string, buyerId: string) {
  const row = await grant(db, orgId, id, buyerId)
  const [use] = await db.select().from(uses).where(eq(uses.authorization_id, row.id)).limit(1)
  const original = use ? await originalListingPayment(db, use.trade_id) : null
  return dto(row, validatedListingTerms(row), original?.trade ?? null)
}

/** Internal pending checkout only. No public route is exposed until claim and
 * explicit delivery/settlement integration have their complete acceptance. */
export async function checkoutOrganizationListing(orgId: string, id: string, buyerId: string, input: z.output<typeof organizationListingCheckoutInput>) {
  return purchasingTransaction(async source => {
    const row = await grant(source, orgId, id, buyerId)
    const [prior] = await source.select().from(uses).where(eq(uses.authorization_id, row.id)).limit(1)
    if (prior) {
      if (prior.request_hash !== hash(input)) fail('ORGANIZATION_LISTING_CHECKOUT_CONFLICT')
      const original = await originalListingPayment(source, prior.trade_id)
      if (!original) return fail('ORGANIZATION_LISTING_USE_INVALID')
      return { ...dto(row, original.terms, original.trade), created: false }
    }
    const terms = await currentListingReview(row, source, { requireApproval: true })
    if (input.version !== terms.version || input.authority_hash !== row.authority_hash) fail('ORGANIZATION_LISTING_REVIEW_CHANGED')
    const [used] = await source.select().from(uses).where(eq(uses.listing_id, row.listing_id)).limit(1)
    if (used) fail('ORGANIZATION_LISTING_ALREADY_RESERVED')
    const [pause] = await source.select().from(payment_controls).where(eq(payment_controls.key, NEW_PAYMENTS_CONTROL_KEY)).limit(1)
    if (process.env.CLAWDMARKET_NEW_PAYMENTS_PAUSED === 'true' || pause?.paused === 1) fail('NEW_PAYMENTS_PAUSED', 503)
    await assertListingExposure(source, row, terms)
    const quote = calculateTradeFinancials(terms.listing.item_price_usd)
    await enforceAgentSpendPolicy(source, { agentId: row.agent_id, buyerId, totalCost: quote.totalCost, sellerId: row.seller_id,
      paymentRail: terms.payment.rail, verificationMethods: ['buyer_review'], purchaseEvidence: listingPurchaseEvidence(row, terms) })
    const frozen = terms.listing
    const [claimed] = await source.update(listings).set({ status: 'sold' }).where(and(eq(listings.id, frozen.id), eq(listings.status, 'active'),
      eq(listings.seller_id, frozen.seller_id), eq(listings.category, frozen.category), eq(listings.title, frozen.title),
      eq(listings.description, frozen.description), eq(listings.price_bankr, frozen.item_price_usd))).returning()
    if (!claimed) fail('ORGANIZATION_LISTING_SCOPE_CHANGED')
    const readiness = getPaymentReadiness()
    const [trade] = await source.insert(trades).values({ listing_id: row.listing_id, buyer_id: buyerId, seller_id: row.seller_id,
      amount: quote.sellerAmount, fee: quote.devAmount, item_price: quote.itemPrice, platform_fee: quote.platformFee,
      total_cost: quote.totalCost, seller_amount: quote.sellerAmount, dev_amount: quote.devAmount,
      dev_wallet: terms.payment.rail === 'mpp' ? readiness.mpp.feeRecipient : readiness.evm.feeRecipient,
      payout_status: 'pending', payment_rail: terms.payment.rail, client_reference: `organization-listing:${row.id}`,
      payment_due_at: new Date(Math.min(Date.now() + 30 * 60_000, Date.parse(terms.expires_at))).toISOString(), status: 'pending' }).returning()
    await attributeOrganizationTrade(source, row.agent_id, trade, terms.total_minor)
    await source.insert(uses).values({ authorization_id: row.id, listing_id: row.listing_id, trade_id: trade.id,
      authority_hash: row.authority_hash, client_reference: input.client_reference, request_hash: hash(input), amount_minor: terms.total_minor,
      chain_id: terms.payment.chain_id, fee_token_address: terms.payment.rail === 'mpp' ? terms.payment.fee_token_address : null,
      fee_token_decimals: terms.payment.rail === 'evm' ? 18 : 6,
      maximum_chain_fee_units: terms.payment.rail === 'evm' ? terms.payment.max_gas_cost_wei : terms.payment.max_fee_token_cost_units,
      created_at: new Date() })
    await originalListingPayment(source, trade.id)
    return { ...dto(row, terms, trade), created: true }
  })
}
