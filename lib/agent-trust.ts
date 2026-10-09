import { db } from '@/lib/db';
import { backedReputationTradeSql, eligibleReputationTradeSql, rankedBuyerFeedbackSql } from './reputation-evidence-sql';
import { tradePrincipalSql } from './trade-evidence-sql';
import { REPUTATION_EVIDENCE_POLICY } from './reputation-evidence-policy';
import { computeTrustScore, trustBand, type TrustComputation } from '@/lib/trust-score';

export interface AgentTrustInput {
  id: string;
  created_at?: string | number | Date | null;
  avg_rating?: string | number | null;
  rating_count?: string | number | null;
}

export interface AgentTrustSnapshot extends TrustComputation {
  band: string;
  evidence: typeof REPUTATION_EVIDENCE_POLICY;
  components: {
    averageRating: number | null;
    ratingCount: number;
    positiveRatings: number;
    negativeRatings: number;
    completedTrades: number;
    disputedTrades: number;
    totalTrades: number;
    recentRatings90d: number;
    accountAgeDays: number;
    distinctBuyerCount: number;
    ratingDistribution: number[];
    backedVolume: number;
  };
}

interface RatingAggregate {
  distribution: number[];
  ratingCount: number;
  ratingTotal: number;
  positiveRatings: number;
  negativeRatings: number;
  recentRatings90d: number;
}

interface TradeAggregate {
  backedVolume: number;
  distinctBuyers: number;
  completedTrades: number;
  disputedTrades: number;
  totalTrades: number;
}

function asFiniteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function accountAgeDays(value: AgentTrustInput['created_at']): number {
  if (!value) return 0;
  const normalized = typeof value === 'number' && Math.abs(value) < 1_000_000_000_000
    ? value * 1000
    : value;
  const date = normalized instanceof Date ? normalized : new Date(normalized);
  const time = date.getTime();
  if (!Number.isFinite(time)) return 0;
  return Math.max(0, Math.floor((Date.now() - time) / 86_400_000));
}

function canonicalAgentId(principalId: string, knownIds: Set<string>): string | null {
  if (knownIds.has(principalId)) return principalId;
  if (principalId.startsWith('user_agent_')) {
    const agentId = principalId.slice('user_agent_'.length);
    if (knownIds.has(agentId)) return agentId;
  }
  return null;
}

export function computeAgentTrust(
  agent: AgentTrustInput,
  ratings: RatingAggregate,
  trades: TradeAggregate,
): AgentTrustSnapshot {
  // Cached profile aggregates can include imported/historical ratings. Only
  // ratings joined to an evidence-backed trade contribute to trust.
  const ratingCount = ratings.ratingCount;
  const averageRating = ratings.ratingCount > 0
    ? ratings.ratingTotal / ratings.ratingCount
    : null;
  const age = accountAgeDays(agent.created_at);
  const trust = computeTrustScore({
    averageRating,
    distinctBuyerCount: trades.distinctBuyers,
    totalRatings: ratingCount,
    completedTrades: trades.completedTrades,
    disputedTrades: trades.disputedTrades,
    accountAgeDays: age,
    recentRatings90d: ratings.recentRatings90d,
  });

  return {
    ...trust,
    evidence: REPUTATION_EVIDENCE_POLICY,
    band: trustBand(trust.trustScore),
    components: {
      averageRating,
      ratingCount,
      positiveRatings: ratings.positiveRatings,
      negativeRatings: ratings.negativeRatings,
      completedTrades: trades.completedTrades,
      disputedTrades: trades.disputedTrades,
      totalTrades: trades.totalTrades,
      recentRatings90d: ratings.recentRatings90d,
      accountAgeDays: age,
      distinctBuyerCount: trades.distinctBuyers,
      ratingDistribution: ratings.distribution,
      backedVolume: trades.backedVolume,
    },
  };
}

export async function loadAgentTrustMap(agents: AgentTrustInput[]): Promise<Map<string, AgentTrustSnapshot>> {
  if (agents.length === 0) return new Map();

  const knownIds = new Set(agents.map((agent) => agent.id));
  const principals = agents.flatMap((agent) => [agent.id, `user_agent_${agent.id}`]);
  const placeholders = principals.map(() => '?').join(', ');
  const client = (db as any).$client;
  // A single read transaction keeps ratings and completion breadth at the same
  // backing/ownership snapshot and releases recursive-query locks together.
  const [ratingResult, tradeResult] = await client.batch([
    {
      sql: `WITH feedback AS (${rankedBuyerFeedbackSql(`r.rated_id IN (${placeholders})`)})
            SELECT rated_id, COUNT(*) AS rating_count, SUM(score) AS rating_total,
              SUM(score >= 4) AS positive_ratings, SUM(score <= 2) AS negative_ratings,
              SUM(datetime(created_at) >= datetime('now', '-90 days')) AS recent_ratings,
              SUM(score = 1) AS star_1, SUM(score = 2) AS star_2, SUM(score = 3) AS star_3,
              SUM(score = 4) AS star_4, SUM(score = 5) AS star_5
            FROM feedback WHERE feedback_rank = 1 GROUP BY rated_id`,
      args: principals,
    },
    {
      sql: `WITH observations AS MATERIALIZED (
              SELECT CASE WHEN t.seller_id GLOB 'user_agent_*' THEN substr(t.seller_id, 12) ELSE t.seller_id END AS seller_id, t.status, t.resolution, t.amount, ${tradePrincipalSql('t.buyer_id')} AS buyer,
                CASE WHEN ${backedReputationTradeSql('t')} THEN 1 ELSE 0 END AS backed
              FROM trades t WHERE t.seller_id IN (${placeholders}) AND ${eligibleReputationTradeSql('t')}
            ) SELECT seller_id, COUNT(*) AS total_trades, SUM(backed) AS completed_trades,
              COUNT(DISTINCT CASE WHEN backed = 1 THEN buyer END) AS distinct_buyers,
              SUM(CASE WHEN backed = 1 THEN amount ELSE 0 END) AS backed_volume,
              SUM(status = 'disputed' OR resolution IS NOT NULL) AS disputed_trades
            FROM observations GROUP BY seller_id`,
      args: principals,
    },
  ], 'read');

  const ratingMap = new Map<string, RatingAggregate>();
  for (const row of ratingResult?.rows || []) {
    const id = canonicalAgentId(String((row as any).rated_id || ''), knownIds);
    if (!id) continue;
    const current = ratingMap.get(id) || { ratingCount: 0, ratingTotal: 0, positiveRatings: 0, negativeRatings: 0, recentRatings90d: 0, distribution: [0, 0, 0, 0, 0] };
    current.ratingCount += asFiniteNumber((row as any).rating_count);
    current.ratingTotal += asFiniteNumber((row as any).rating_total);
    current.positiveRatings += asFiniteNumber((row as any).positive_ratings);
    current.negativeRatings += asFiniteNumber((row as any).negative_ratings);
    current.recentRatings90d += asFiniteNumber((row as any).recent_ratings);
    for (let star = 1; star <= 5; star++) current.distribution[star - 1] += asFiniteNumber((row as any)[`star_${star}`]);
    ratingMap.set(id, current);
  }

  const tradeMap = new Map<string, TradeAggregate>();
  for (const row of tradeResult?.rows || []) {
    const id = canonicalAgentId(String((row as any).seller_id || ''), knownIds);
    if (!id) continue;
    const current = tradeMap.get(id) || { completedTrades: 0, disputedTrades: 0, totalTrades: 0, distinctBuyers: 0, backedVolume: 0 };
    current.completedTrades += asFiniteNumber((row as any).completed_trades);
    current.disputedTrades += asFiniteNumber((row as any).disputed_trades);
    current.totalTrades += asFiniteNumber((row as any).total_trades);
    current.distinctBuyers += asFiniteNumber((row as any).distinct_buyers);
    current.backedVolume += asFiniteNumber((row as any).backed_volume);
    tradeMap.set(id, current);
  }

  return new Map(agents.map((agent) => [
    agent.id,
    computeAgentTrust(
      agent,
      ratingMap.get(agent.id) || { ratingCount: 0, ratingTotal: 0, positiveRatings: 0, negativeRatings: 0, recentRatings90d: 0, distribution: [0, 0, 0, 0, 0] },
      tradeMap.get(agent.id) || { completedTrades: 0, disputedTrades: 0, totalTrades: 0, distinctBuyers: 0, backedVolume: 0 },
    ),
  ]));
}

export async function loadAgentTrust(agent: AgentTrustInput): Promise<AgentTrustSnapshot> {
  const trustMap = await loadAgentTrustMap([agent]);
  return trustMap.get(agent.id)!;
}
