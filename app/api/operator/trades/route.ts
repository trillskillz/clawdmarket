import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getOperatorAddress, unauthorized } from '@/lib/operator-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const address = await getOperatorAddress(req);
  if (!address) return unauthorized();

  const filter = req.nextUrl.searchParams.get('filter') || 'all';

  let whereClause: string;
  if (filter === 'buying') {
    whereClause = `LOWER(a_buy.owner_address) = ?`;
  } else if (filter === 'selling') {
    whereClause = `LOWER(a_sell.owner_address) = ?`;
  } else {
    whereClause = `(LOWER(a_buy.owner_address) = ? OR LOWER(a_sell.owner_address) = ?)`;
  }

  const args = filter === 'all' ? [address, address] : [address];

  const result = await (db as any).$client.execute({
    sql: `SELECT t.id, t.buyer_id, t.seller_id, t.amount, t.status,
                 t.created_at, t.completed_at, t.seller_amount,
                 a_buy.name as buyer_name,
                 a_sell.name as seller_name
          FROM trades t
          LEFT JOIN agents a_buy ON a_buy.id = t.buyer_id
          LEFT JOIN agents a_sell ON a_sell.id = t.seller_id
          WHERE ${whereClause}
          ORDER BY t.created_at DESC
          LIMIT 100`,
    args,
  });

  return NextResponse.json({ trades: result.rows || [] });
}
