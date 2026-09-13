import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { trades } from '@/lib/schema';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type AgentSpendSnapshot = {
  agent_id: string;
  unit: 'usd';
  per_trade_limit: number;
  daily_limit: number;
  spent_today: number;
  remaining_today: number;
  resets_at: string;
};

function positiveEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function getAgentSpendLimits() {
  return {
    perTrade: positiveEnv('CLAWDMARKET_AGENT_MAX_TRADE_USD', positiveEnv('CLAWDMARKET_AGENT_MAX_TRADE_CREDITS', 50)),
    daily: positiveEnv('CLAWDMARKET_AGENT_DAILY_SPEND_USD', positiveEnv('CLAWDMARKET_AGENT_DAILY_SPEND_CREDITS', 200)),
  };
}

function windowStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function windowEnd(now: Date): Date {
  return new Date(windowStart(now).getTime() + 86_400_000);
}

async function spentSince(tx: Transaction | typeof db, buyerId: string, since: Date): Promise<number> {
  const [row] = await tx
    .select({
      spent: sql<number>`COALESCE(SUM(CASE WHEN ${trades.total_cost} > 0 THEN ${trades.total_cost} ELSE ${trades.amount} + ${trades.fee} END), 0)`,
    })
    .from(trades)
    .where(and(
      eq(trades.buyer_id, buyerId),
      gte(trades.created_at, since),
      sql`${trades.status} NOT IN ('pending', 'cancelled')`,
    ));
  return round2(Number(row?.spent || 0));
}

export class AgentSpendPolicyError extends Error {
  constructor(
    public readonly code: 'AGENT_PER_TRADE_LIMIT' | 'AGENT_DAILY_SPEND_LIMIT',
    message: string,
    public readonly policy: AgentSpendSnapshot,
  ) {
    super(message);
    this.name = 'AgentSpendPolicyError';
  }
}

export async function getAgentSpendSnapshot(agentId: string, buyerId = `user_agent_${agentId}`, now = new Date()): Promise<AgentSpendSnapshot> {
  const limits = getAgentSpendLimits();
  const spentToday = await spentSince(db, buyerId, windowStart(now));
  return {
    agent_id: agentId,
    unit: 'usd',
    per_trade_limit: limits.perTrade,
    daily_limit: limits.daily,
    spent_today: spentToday,
    remaining_today: round2(Math.max(0, limits.daily - spentToday)),
    resets_at: windowEnd(now).toISOString(),
  };
}

export async function enforceAgentSpendPolicy(
  tx: Transaction,
  input: { agentId: string; buyerId: string; totalCost: number; now?: Date },
): Promise<AgentSpendSnapshot> {
  const now = input.now || new Date();
  const limits = getAgentSpendLimits();
  const spentToday = await spentSince(tx, input.buyerId, windowStart(now));
  const policy: AgentSpendSnapshot = {
    agent_id: input.agentId,
    unit: 'usd',
    per_trade_limit: limits.perTrade,
    daily_limit: limits.daily,
    spent_today: spentToday,
    remaining_today: round2(Math.max(0, limits.daily - spentToday)),
    resets_at: windowEnd(now).toISOString(),
  };

  if (input.totalCost > limits.perTrade) {
    throw new AgentSpendPolicyError(
      'AGENT_PER_TRADE_LIMIT',
      `Agent trade total $${round2(input.totalCost)} exceeds the $${limits.perTrade} per-trade limit.`,
      policy,
    );
  }
  if (round2(spentToday + input.totalCost) > limits.daily) {
    throw new AgentSpendPolicyError(
      'AGENT_DAILY_SPEND_LIMIT',
      `Agent daily spend would exceed the $${limits.daily} limit.`,
      policy,
    );
  }
  return policy;
}
