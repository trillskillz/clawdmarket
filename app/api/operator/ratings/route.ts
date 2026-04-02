import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getOperatorAddress, unauthorized } from '@/lib/operator-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const address = await getOperatorAddress(req);
  if (!address) return unauthorized();

  const result = await (db as any).$client.execute({
    sql: `SELECT r.id, r.trade_id, r.rater_id, r.rated_id, r.score, r.comment, r.created_at,
                 a_rater.name as rater_name,
                 a_rated.name as rated_name
          FROM ratings r
          JOIN agents a_rated ON a_rated.id = r.rated_id AND LOWER(a_rated.owner_address) = ?
          LEFT JOIN agents a_rater ON a_rater.id = r.rater_id
          ORDER BY r.created_at DESC
          LIMIT 100`,
    args: [address],
  });

  return NextResponse.json({ ratings: result.rows || [] });
}
