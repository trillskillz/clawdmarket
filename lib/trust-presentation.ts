export function hasEarnedTrustEvidence(completedTrades: unknown, ratingCount: unknown): boolean {
  return Number(completedTrades || 0) > 0 || Number(ratingCount || 0) > 0
}

export function publicTrustLabel(_score: unknown, completedTrades: unknown, ratingCount: unknown, reputation?: { projection_status: string; delivery: { accepted: number; provider_failures: number }; breadth: { observed_buyer_groups: number } }): string {
  if (reputation?.projection_status === 'unavailable') return 'Evidence unavailable'
  if (reputation && reputation.delivery.provider_failures > 0) return `${reputation.delivery.accepted} accepted · ${reputation.delivery.provider_failures} provider-fault findings`
  if (reputation && reputation.delivery.accepted > 0) return `${reputation.delivery.accepted} accepted · ${reputation.breadth.observed_buyer_groups} observed buyer groups`
  if (reputation) return 'No eligible terminal history'
  if (!hasEarnedTrustEvidence(completedTrades, ratingCount)) return 'Unproven · Low confidence'
  return `${Number(completedTrades || 0)} accepted · ${Number(ratingCount || 0)} eligible reviews`
}
