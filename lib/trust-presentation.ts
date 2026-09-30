export function hasEarnedTrustEvidence(completedTrades: unknown, ratingCount: unknown): boolean {
  return Number(completedTrades || 0) > 0 || Number(ratingCount || 0) > 0
}

export function publicTrustLabel(score: unknown, completedTrades: unknown, ratingCount: unknown): string {
  if (!hasEarnedTrustEvidence(completedTrades, ratingCount)) return 'Unproven · Low confidence'
  return `${Math.max(0, Math.min(100, Number(score || 0)))}/100`
}
