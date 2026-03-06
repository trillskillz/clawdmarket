export type TrustConfidence = 'low' | 'medium' | 'high';

export interface TrustSignals {
  likes: number;
  dislikes: number;
  effectiveDislikes?: number;
  totalRatings: number;
  completedTrades: number;
  disputedTrades: number;
  accountAgeDays: number;
  recentRatings90d?: number;
}

export interface TrustComputation {
  trustScore: number;
  confidence: TrustConfidence;
  evidencePoints: number;
  drivers: string[];
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function computeTrustScore(signals: TrustSignals): TrustComputation {
  const likes = Math.max(0, signals.likes || 0);
  const dislikes = Math.max(0, signals.dislikes || 0);
  const effectiveDislikes = Math.max(0, signals.effectiveDislikes ?? dislikes);
  const totalRatings = Math.max(0, signals.totalRatings || likes + dislikes);
  const completedTrades = Math.max(0, signals.completedTrades || 0);
  const disputedTrades = Math.max(0, signals.disputedTrades || 0);
  const accountAgeDays = Math.max(0, signals.accountAgeDays || 0);
  const recentRatings90d = Math.max(0, signals.recentRatings90d ?? 0);

  // Bayesian-smoothed rating base (continuous 0-100).
  const priorMean = 72;
  const priorWeight = 8;
  const netRating = likes - effectiveDislikes;
  const ratingMean = totalRatings > 0 ? ((netRating / totalRatings + 1) / 2) * 100 : priorMean;
  const bayesianRating = ((ratingMean * totalRatings) + (priorMean * priorWeight)) / (totalRatings + priorWeight);

  // Trade reliability: completion vs disputes.
  const tradeEvents = completedTrades + disputedTrades;
  const completionRate = tradeEvents > 0 ? completedTrades / tradeEvents : 0.9;
  const tradeReliability = completionRate * 100;

  // Evidence weighting and confidence.
  const evidencePoints = totalRatings * 1.5 + completedTrades * 0.75 + Math.min(15, accountAgeDays / 30);
  const confidence: TrustConfidence = evidencePoints >= 40 ? 'high' : evidencePoints >= 16 ? 'medium' : 'low';
  const evidenceWeight = clamp(evidencePoints / 50, 0.15, 1);

  // Recency boost/decay: active recent ratings add slight confidence in current score.
  const recencyAdj = recentRatings90d >= 5 ? 2 : recentRatings90d === 0 ? -2 : 0;

  // Dispute penalty (non-linear).
  const disputePenalty = clamp(disputedTrades * 2.5, 0, 20);

  const blended = bayesianRating * 0.65 + tradeReliability * 0.35;
  const trustScore = Math.round(clamp((priorMean * (1 - evidenceWeight)) + (blended * evidenceWeight) + recencyAdj - disputePenalty, 0, 100));

  const drivers: string[] = [];
  if (completedTrades > 0) drivers.push(`${completedTrades} completed trade${completedTrades === 1 ? '' : 's'}`);
  if (disputedTrades > 0) drivers.push(`${disputedTrades} dispute${disputedTrades === 1 ? '' : 's'} (penalty applied)`);
  if (totalRatings > 0) drivers.push(`${likes} likes / ${dislikes} dislikes`);
  if (recentRatings90d > 0) drivers.push(`${recentRatings90d} ratings in last 90 days`);
  if (drivers.length === 0) drivers.push('Limited history; score currently confidence-weighted by prior');

  return { trustScore, confidence, evidencePoints, drivers };
}

export function trustScoreClass(score: number): string {
  if (score >= 80) return 'text-green-400';
  if (score >= 60) return 'text-yellow-300';
  return 'text-red-400';
}
