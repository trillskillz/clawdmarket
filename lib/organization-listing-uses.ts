import 'server-only'
import { createHash } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { organization_listing_authorizations as grants, organization_listing_uses as uses,
  organization_trade_attributions, trades } from './schema'
import { canonicalContract } from './structured-verification'
import { calculateTradeFinancials } from './settlement'
import { validatedListingTerms } from './organization-listing-authorizations'
import { PurchasingError, type PurchasingSource } from './organization-purchasing-transaction'
import type { mandateDto } from './route-payment-mandate'

const hash = (value: unknown) => createHash('sha256').update(canonicalContract(value)).digest('hex')
function fail(): never { throw new PurchasingError('ORGANIZATION_LISTING_USE_INVALID', 409) }

/** Historical binding is independent of current ownership, listing text and permission.
 * It validates consumed exposure; it cannot authorize checkout or payment. */
export async function originalListingPayment(source: PurchasingSource, tradeId: string) {
  const [use] = await source.select().from(uses).where(eq(uses.trade_id, tradeId)).limit(1)
  if (!use) {
    // client_reference was historically buyer supplied. A textual prefix alone
    // cannot adopt a legacy trade into this authority or close its recovery path.
    const [orphan] = await source.all(sql`SELECT t.id FROM trades t JOIN organization_listing_authorizations a
      ON t.client_reference=('organization-listing:' || a.id) AND t.listing_id=a.listing_id AND t.buyer_id=a.buyer_id
      WHERE t.id=${tradeId} LIMIT 1`)
    if (orphan) fail()
    return null
  }
  const [authorization] = await source.select().from(grants).where(eq(grants.id, use.authorization_id)).limit(1)
  if (!authorization) return fail()
  const terms = validatedListingTerms(authorization)
  const [trade] = await source.select().from(trades).where(eq(trades.id, tradeId)).limit(1)
  const [attribution] = await source.select().from(organization_trade_attributions).where(eq(organization_trade_attributions.trade_id, tradeId)).limit(1)
  const quote = calculateTradeFinancials(terms.listing.item_price_usd)
  const fee = terms.payment.rail === 'evm' ? terms.payment.max_gas_cost_wei : terms.payment.max_fee_token_cost_units
  if (!['approved', 'revoked'].includes(authorization.state) || !authorization.approved_at || !authorization.decision_reference
    || authorization.decision_hash !== hash({ version: terms.version, client_reference: authorization.decision_reference, authority_hash: authorization.authority_hash, approve: true })
    || !Number.isFinite(use.created_at.getTime()) || use.created_at < authorization.approved_at || use.created_at.getTime() > Date.now() + 1_000
    || !trade || !attribution || use.authority_hash !== authorization.authority_hash
    || use.listing_id !== authorization.listing_id || trade.listing_id !== authorization.listing_id
    || use.request_hash !== hash({ version: terms.version, client_reference: use.client_reference, authority_hash: authorization.authority_hash })
    || use.amount_minor !== terms.total_minor || trade.buyer_id !== authorization.buyer_id || trade.seller_id !== authorization.seller_id
    || trade.payment_rail !== terms.payment.rail || trade.client_reference !== `organization-listing:${authorization.id}`
    || trade.item_price !== quote.itemPrice || trade.platform_fee !== quote.platformFee || trade.total_cost !== quote.totalCost
    || trade.amount !== quote.sellerAmount || trade.seller_amount !== quote.sellerAmount || trade.fee !== quote.devAmount || trade.dev_amount !== quote.devAmount
    || attribution.organization_id !== authorization.organization_id || attribution.agent_id !== authorization.agent_id
    || attribution.team_id !== authorization.team_id || attribution.cost_center !== authorization.cost_center || attribution.total_minor !== terms.total_minor
    || use.chain_id !== terms.payment.chain_id || use.maximum_chain_fee_units !== fee
    || use.fee_token_decimals !== (terms.payment.rail === 'evm' ? 18 : 6)
    || use.fee_token_address !== (terms.payment.rail === 'mpp' ? terms.payment.fee_token_address : null)) fail()
  const [collision] = await source.all(sql`SELECT id FROM service_orders WHERE trade_id=${tradeId}
    UNION ALL SELECT approval_id FROM organization_purchase_uses WHERE trade_id=${tradeId}
    UNION ALL SELECT account_id FROM organization_spending_uses WHERE trade_id=${tradeId}
    UNION ALL SELECT authorization_id FROM organization_task_uses WHERE trade_id=${tradeId}
    UNION ALL SELECT task_id FROM task_workspaces WHERE trade_id=${tradeId}
    UNION ALL SELECT route_id FROM route_funding_steps WHERE trade_id=${tradeId} LIMIT 1`)
  if (collision) fail()
  return { authorization, terms, use, trade }
}

export async function organizationListingExposure(source: PurchasingSource, orgId: string, buyerId: string,
  payment: ReturnType<typeof mandateDto>['terms']['payment'], excludeTradeId = '') {
  // Missing parent scope cannot safely be assigned to an organization. Corruption
  // fails closed rather than silently excluding an unaccounted obligation.
  const [orphanUse] = await source.all(sql`SELECT u.trade_id FROM organization_listing_uses u
    LEFT JOIN organization_listing_authorizations a ON a.id=u.authorization_id WHERE a.id IS NULL LIMIT 1`)
  if (orphanUse) fail()
  const history = await source.select({ use: uses }).from(uses).innerJoin(grants, eq(grants.id, uses.authorization_id))
    .where(and(eq(grants.organization_id, orgId), eq(grants.buyer_id, buyerId))).limit(10001)
  if (history.length > 10000) throw new PurchasingError('ORGANIZATION_LISTING_HISTORY_UNAVAILABLE', 503)
  let daily = 0, monthly = 0, lifetime = 0, gas = 0n, fees = 0n
  const now = new Date(), day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()), month = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  for (const { use } of history) {
    const original = await originalListingPayment(source, use.trade_id)
    if (!original) return fail()
    if (use.trade_id === excludeTradeId) continue
    lifetime += use.amount_minor
    if (use.created_at.getTime() >= day) daily += use.amount_minor
    if (use.created_at.getTime() >= month) monthly += use.amount_minor
    if (original.terms.payment.rail === 'evm') gas += BigInt(use.maximum_chain_fee_units)
    else if (payment.rail === 'mpp' && 'fee_token_address' in payment && payment.chain_id === use.chain_id && payment.fee_token_address === use.fee_token_address) fees += BigInt(use.maximum_chain_fee_units)
    if (![daily, monthly, lifetime].every(Number.isSafeInteger)) fail()
  }
  const [orphanTrade] = await source.all(sql`SELECT t.id FROM trades t JOIN organization_trade_attributions a ON a.trade_id=t.id
    JOIN organization_listing_authorizations g ON t.client_reference=('organization-listing:' || g.id)
      AND t.listing_id=g.listing_id AND t.buyer_id=g.buyer_id
    WHERE a.organization_id=${orgId} AND t.buyer_id=${buyerId}
      AND NOT EXISTS(SELECT 1 FROM organization_listing_uses u WHERE u.trade_id=t.id) LIMIT 1`)
  if (orphanTrade) fail()
  return { daily, monthly, lifetime, gas, fees }
}
