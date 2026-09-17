import { db } from '@/lib/db';
import { computeTrustScore, trustBand, type TrustComputation } from '@/lib/trust-score';

export interface AgentTrustInput {
  id: string;
  created_at?: string | number | Date | null;
  avg_rating?: string | number | null;
  rating_count?: string | number | null;
}

export interface AgentTrustSnapshot extends TrustComputation {
  band: string;
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
  };
}

interface RatingAggregate {
  ratingCount: number;
  ratingTotal: number;
  positiveRatings: number;
  negativeRatings: number;
  recentRatings90d: number;
}

interface TradeAggregate {
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
    totalRatings: ratingCount,
    completedTrades: trades.completedTrades,
    disputedTrades: trades.disputedTrades,
    accountAgeDays: age,
    recentRatings90d: ratings.recentRatings90d,
  });

  return {
    ...trust,
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
    },
  };
}

export async function loadAgentTrustMap(agents: AgentTrustInput[]): Promise<Map<string, AgentTrustSnapshot>> {
  if (agents.length === 0) return new Map();

  const knownIds = new Set(agents.map((agent) => agent.id));
  const principals = agents.flatMap((agent) => [agent.id, `user_agent_${agent.id}`]);
  const placeholders = principals.map(() => '?').join(', ');
  const client = (db as any).$client;
  const backedWork = `t.status IN ('completed', 'complete')
    AND EXISTS (SELECT 1 FROM trade_deliveries d WHERE d.trade_id = t.id AND d.content_hash IS NOT NULL)
    AND (
      (t.payment_rail = 'ledger' AND EXISTS (SELECT 1 FROM transactions x WHERE x.reference_id = t.id AND x.type = 'escrow_lock'))
      OR (t.payment_rail IN ('mpp', 'evm')
        AND EXISTS (SELECT 1 FROM payment_receipts p WHERE p.trade_id = t.id AND p.payment_rail = t.payment_rail)
        AND EXISTS (SELECT 1 FROM settlement_transfers s WHERE s.trade_id = t.id AND s.kind = 'seller_payout' AND s.status = 'confirmed' AND s.tx_hash IS NOT NULL))
    )`;

  const [ratingResult, tradeResult] = await Promise.all([
    client.execute({
      sql: `SELECT r.rated_id,
                   COUNT(*) AS rating_count,
                   SUM(CAST(r.score AS REAL)) AS rating_total,
                   SUM(CASE WHEN r.score >= 4 THEN 1 ELSE 0 END) AS positive_ratings,
                   SUM(CASE WHEN r.score <= 2 THEN 1 ELSE 0 END) AS negative_ratings,
                   SUM(CASE WHEN datetime(r.created_at) >= datetime('now', '-90 days') THEN 1 ELSE 0 END) AS recent_ratings
            FROM ratings r JOIN trades t ON t.id = r.trade_id
            WHERE r.rated_id IN (${placeholders}) AND ${backedWork}
            GROUP BY r.rated_id`,
      args: principals,
    }),
    client.execute({
      sql: `SELECT t.seller_id,
                   COUNT(*) AS total_trades,
                   SUM(CASE WHEN ${backedWork} THEN 1 ELSE 0 END) AS completed_trades,
                   SUM(CASE WHEN t.status = 'disputed' OR t.resolution IS NOT NULL THEN 1 ELSE 0 END) AS disputed_trades
            FROM trades t
            WHERE t.seller_id IN (${placeholders})
            GROUP BY t.seller_id`,
      args: principals,
    }),
  ]);

  const ratingMap = new Map<string, RatingAggregate>();
  for (const row of ratingResult?.rows || []) {
    const id = canonicalAgentId(String((row as any).rated_id || ''), knownIds);
    if (!id) continue;
    const current = ratingMap.get(id) || { ratingCount: 0, ratingTotal: 0, positiveRatings: 0, negativeRatings: 0, recentRatings90d: 0 };
    current.ratingCount += asFiniteNumber((row as any).rating_count);
    current.ratingTotal += asFiniteNumber((row as any).rating_total);
    current.positiveRatings += asFiniteNumber((row as any).positive_ratings);
    current.negativeRatings += asFiniteNumber((row as any).negative_ratings);
    current.recentRatings90d += asFiniteNumber((row as any).recent_ratings);
    ratingMap.set(id, current);
  }

  const tradeMap = new Map<string, TradeAggregate>();
  for (const row of tradeResult?.rows || []) {
    const id = canonicalAgentId(String((row as any).seller_id || ''), knownIds);
    if (!id) continue;
    const current = tradeMap.get(id) || { completedTrades: 0, disputedTrades: 0, totalTrades: 0 };
    current.completedTrades += asFiniteNumber((row as any).completed_trades);
    current.disputedTrades += asFiniteNumber((row as any).disputed_trades);
    current.totalTrades += asFiniteNumber((row as any).total_trades);
    tradeMap.set(id, current);
  }

  return new Map(agents.map((agent) => [
    agent.id,
    computeAgentTrust(
      agent,
      ratingMap.get(agent.id) || { ratingCount: 0, ratingTotal: 0, positiveRatings: 0, negativeRatings: 0, recentRatings90d: 0 },
      tradeMap.get(agent.id) || { completedTrades: 0, disputedTrades: 0, totalTrades: 0 },
    ),
  ]));
}

export async function loadAgentTrust(agent: AgentTrustInput): Promise<AgentTrustSnapshot> {
  const trustMap = await loadAgentTrustMap([agent]);
  return trustMap.get(agent.id)!;
}
