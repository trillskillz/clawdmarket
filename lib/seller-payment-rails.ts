import { eq } from 'drizzle-orm'
import { db } from './db'
import { seller_payment_preferences } from './schema'
import type { MarketplaceRail } from './payment-rail-selection'

type Source = Pick<typeof db, 'select'>
export const MARKETPLACE_RAILS = ['credit', 'ledger', 'mpp', 'evm'] as const
export const CREDIT_SETTLEMENT_DISCLOSURE = 'Prepaid account credit cannot be withdrawn as cash or tokens. Sellers receive nonwithdrawable account credit after acceptance; external rails pay the configured seller wallet after settlement.'

export class SellerRailError extends Error {
  readonly code = 'SELLER_PAYMENT_RAIL_UNSUPPORTED'
  readonly status = 409
  constructor() { super('The seller does not accept this payment rail. No new order was funded.') }
}

export async function sellerPaymentRails(sellerId: string, source: Source = db) {
  const [row] = await source.select().from(seller_payment_preferences).where(eq(seller_payment_preferences.seller_id, sellerId)).limit(1)
  // Nonwithdrawable credit requires explicit seller consent for new orders.
  // External rails and the disabled-by-default legacy ledger remain compatible;
  // no prose is parsed into binding preferences. Existing orders retain terms.
  const supported = row ? JSON.parse(row.supported_rails) as MarketplaceRail[] : ['ledger', 'mpp', 'evm'] as MarketplaceRail[]
  if (!Array.isArray(supported) || supported.some(rail => !MARKETPLACE_RAILS.includes(rail))) throw new Error('Invalid seller payment preferences')
  return { supported_payment_rails: supported, payment_rails_confirmed: Boolean(row),
    payment_rail_review_required: !row, credit_redeemable: false, settlement_disclosure: CREDIT_SETTLEMENT_DISCLOSURE }
}

export async function requireSellerPaymentRail(sellerId: string, rail: MarketplaceRail, source: Source = db) {
  if (!(await sellerPaymentRails(sellerId, source)).supported_payment_rails.includes(rail)) throw new SellerRailError()
}
