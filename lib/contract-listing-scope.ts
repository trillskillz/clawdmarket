import 'server-only'
import { eq } from 'drizzle-orm'
import { listings, task_workspaces, trades } from './schema'
import { isPublicMarketplaceSeller, originalPrivateServiceListing, originalReviewedTaskListing, originalReviewedListing } from './listing-visibility'
import { genericListingFundingGuard } from './organization-listing-authorizations'
import { PurchasingError, type PurchasingSource } from './organization-purchasing-transaction'

/** Fresh contract inventory only. Existing funded settlement/refunds never call this. */
export async function requireContractListingScope(source: PurchasingSource, listingId: string,
  options: { expectedSeller?: string; fundingBuyer?: string } = {}) {
  const [listing] = await source.select().from(listings).where(eq(listings.id, listingId)).limit(1)
  if (!listing) throw new PurchasingError('CONTRACT_LISTING_NOT_FOUND', 404)
  if (listing.status !== 'active' || options.expectedSeller && listing.seller_id !== options.expectedSeller
    || !await isPublicMarketplaceSeller(listing.seller_id, source)
    || await originalPrivateServiceListing(listingId, source)
    || await originalReviewedTaskListing(listingId, source)
    || await originalReviewedListing(listingId, source)) throw new PurchasingError('CONTRACT_LISTING_UNAVAILABLE')
  // A bounty listing belongs to its original task, including legacy task trades.
  const [task] = await source.select({ id: task_workspaces.task_id }).from(task_workspaces)
    .innerJoin(trades, eq(trades.id, task_workspaces.trade_id)).where(eq(trades.listing_id, listingId)).limit(1)
  if (task) throw new PurchasingError('CONTRACT_LISTING_UNAVAILABLE')
  // A free companion restricts only its original buyer. Revocation is not a bypass.
  if (options.fundingBuyer) await genericListingFundingGuard(source, listingId, options.fundingBuyer)
  return listing
}
