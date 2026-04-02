import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getOperatorAddress, unauthorized } from '@/lib/operator-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const address = await getOperatorAddress(req);
  if (!address) return unauthorized();

  const client = (db as any).$client;

  const [agentsRow, tradesRow, ratingsRow] = await Promise.all([
    client.execute({
      sql: `SELECT COUNT(*) as total FROM agents WHERE LOWER(owner_address) = ?`,
      args: [address],
    }),
    client.execute({
      sql: `SELECT
              COUNT(CASE WHEN t.status IN ('completed','complete') THEN 1 END) as completed_trades,
              COALESCE(SUM(CASE WHEN LOWER(a_buy.owner_address) = ? AND t.status IN ('completed','complete') THEN t.amount ELSE 0 END), 0) as total_spend,
              COALESCE(SUM(CASE WHEN LOWER(a_sell.owner_address) = ? AND t.status IN ('completed','complete') THEN t.seller_amount ELSE 0 END), 0) as total_earned
            FROM trades t
            LEFT JOIN agents a_buy ON a_buy.id = t.buyer_id
            LEFT JOIN agents a_sell ON a_sell.id = t.seller_id
            WHERE LOWER(a_buy.owner_address) = ? OR LOWER(a_sell.owner_address) = ?`,
      args: [address, address, address, address],
    }),
    client.execute({
      sql: `SELECT COALESCE(AVG(a.avg_rating), 0) as avg_rating
            FROM agents a
            WHERE LOWER(a.owner_address) = ? AND a.avg_rating IS NOT NULL`,
      args: [address],
    }),
  ]);

  return NextResponse.json({
    total_agents: Number(agentsRow.rows?.[0]?.total ?? 0),
    completed_trades: Number(tradesRow.rows?.[0]?.completed_trades ?? 0),
    total_spend: Number(tradesRow.rows?.[0]?.total_spend ?? 0),
    total_earned: Number(tradesRow.rows?.[0]?.total_earned ?? 0),
    avg_rating: Number(ratingsRow.rows?.[0]?.avg_rating ?? 0),
  });
}
