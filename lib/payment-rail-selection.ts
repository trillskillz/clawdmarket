export type MarketplaceRail = 'ledger' | 'credit' | 'mpp' | 'evm'
export type RequestedMarketplaceRail = MarketplaceRail | 'auto'

type Readiness = { credit?: { enabled: boolean }; ledger: { enabled: boolean }; mpp: { enabled: boolean }; evm: { enabled: boolean } }

/** Deterministic rail choice. Explicit requests never fall back to another rail. */
export function selectMarketplaceRail(
  requested: RequestedMarketplaceRail,
  readiness: Readiness,
  sellerPayoutReady: boolean,
): MarketplaceRail | null {
  if (requested !== 'auto') {
    return readiness[requested]?.enabled && (requested === 'ledger' || requested === 'credit' || sellerPayoutReady) ? requested : null
  }
  if (sellerPayoutReady && readiness.mpp.enabled) return 'mpp'
  if (sellerPayoutReady && readiness.evm.enabled) return 'evm'
  if (readiness.credit?.enabled) return 'credit'
  if (readiness.ledger.enabled) return 'ledger'
  return null
}
