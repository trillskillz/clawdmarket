import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getOperatorAddress, unauthorized } from '@/lib/operator-auth';

export const dynamic = 'force-dynamic';

async function ensureTable() {
  await (db as any).$client.execute({
    sql: `CREATE TABLE IF NOT EXISTS operator_settings (
            agent_id TEXT PRIMARY KEY,
            daily_spend_cap REAL,
            created_at INTEGER NOT NULL DEFAULT (unixepoch())
          )`,
    args: [],
  });
}

export async function GET(req: NextRequest) {
  const address = await getOperatorAddress(req);
  if (!address) return unauthorized();

  await ensureTable();

  const result = await (db as any).$client.execute({
    sql: `SELECT os.agent_id, os.daily_spend_cap, os.created_at,
                 COALESCE(
                   (SELECT SUM(t.amount) FROM trades t
                    WHERE t.buyer_id = os.agent_id
                      AND t.created_at >= unixepoch() - 86400 * 30),
                   0
                 ) as spend_30d
          FROM operator_settings os
          JOIN agents a ON a.id = os.agent_id AND LOWER(a.owner_address) = ?`,
    args: [address],
  });

  return NextResponse.json({ settings: result.rows || [] });
}

export async function POST(req: NextRequest) {
  const address = await getOperatorAddress(req);
  if (!address) return unauthorized();

  const body = await req.json().catch(() => ({}));
  const agentId = String(body.agent_id || '').trim();
  const dailySpendCap = body.daily_spend_cap;

  if (!agentId) {
    return NextResponse.json({ error: 'agent_id required' }, { status: 400 });
  }
  if (typeof dailySpendCap !== 'number' || dailySpendCap < 0) {
    return NextResponse.json({ error: 'daily_spend_cap must be a non-negative number' }, { status: 400 });
  }

  const client = (db as any).$client;

  const agentRow = await client.execute({
    sql: `SELECT id FROM agents WHERE id = ? AND LOWER(owner_address) = ?`,
    args: [agentId, address],
  });
  if (!agentRow.rows?.length) {
    return NextResponse.json({ error: 'agent_not_found_or_not_owned' }, { status: 404 });
  }

  await ensureTable();

  await client.execute({
    sql: `INSERT INTO operator_settings (agent_id, daily_spend_cap, created_at)
          VALUES (?, ?, unixepoch())
          ON CONFLICT(agent_id) DO UPDATE SET daily_spend_cap = excluded.daily_spend_cap`,
    args: [agentId, dailySpendCap],
  });

  return NextResponse.json({ ok: true, agent_id: agentId, daily_spend_cap: dailySpendCap });
}
