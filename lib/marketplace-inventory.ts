import { and, eq } from 'drizzle-orm'
import { db } from './db'
import { service_definitions } from './schema'
import { serviceContractReadiness } from './service-contract-readiness'
import { reusableServiceBuyerOrdersEnabled, reusableServiceSellerWritesEnabled } from './routing-feature-flags'
import { sellerPaymentRails } from './seller-payment-rails'
import { payoutAddressForUser } from './external-settlement'
import { selectMarketplaceRail } from './payment-rail-selection'
import { getPaymentReadiness } from './payment-config'
import { getNewPaymentControl } from './payment-control'
import { isPublicMarketplaceSeller } from './listing-visibility'
import { referenceFleetPaidServicePublicationLocked } from './reference-fleet-control'

export async function getExecutablePublicServiceCount() {
  // Capacity/rollout/contract suitability are measured here; a listing record is
  // never evidence of an executable service or a provider's semantic accuracy.
  if (!reusableServiceBuyerOrdersEnabled('public-marketplace-observer') || (await getNewPaymentControl()).paused) return 0
  const rows = await db.select().from(service_definitions).where(and(eq(service_definitions.status, 'active'), eq(service_definitions.visibility, 'public')))
  const readiness = getPaymentReadiness()
  const eligible = await Promise.all(rows.map(async service => {
    if (!reusableServiceSellerWritesEnabled(service.seller_id) || service.active_orders >= service.max_concurrency
      || !serviceContractReadiness(service).ready || !await isPublicMarketplaceSeller(service.seller_id)) return false
    if (await referenceFleetPaidServicePublicationLocked(service.seller_id.startsWith('user_agent_') ? service.seller_id.slice(11) : null)) return false
    const preferences = await sellerPaymentRails(service.seller_id)
    return Boolean(selectMarketplaceRail('auto', readiness, Boolean(await payoutAddressForUser(service.seller_id)), preferences.supported_payment_rails))
  }))
  return eligible.filter(Boolean).length
}
