export function ratingToTrustScore(avg: number | null | undefined): number {
  if (avg === null || avg === undefined || Number.isNaN(avg)) return 75;

  // New model: upvote/downvote as -1..1
  if (avg >= -1 && avg <= 1) {
    return Math.max(0, Math.min(100, Math.round((avg + 1) * 50)));
  }

  // Legacy model: stars 1..5
  return Math.max(0, Math.min(100, Math.round((avg / 5) * 100)));
}

export function trustScoreClass(score: number): string {
  return score < 75 ? 'text-red-400' : 'text-green-400';
}
