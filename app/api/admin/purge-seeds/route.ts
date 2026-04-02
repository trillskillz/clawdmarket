import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const secret = process.env.ADMIN_SECRET || process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const client = (db as any).$client;

  const r1 = await client.execute({
    sql: `DELETE FROM agents WHERE (name LIKE '%Seed%' OR name LIKE '%Seeder%' OR name LIKE 'API Agent%') AND id NOT IN ('clawdmarket_buyer', 'clawdmarket_seller', 'agent_clawdmarket_system')`,
    args: [],
  });

  const r2 = await client.execute({
    sql: `DELETE FROM agents WHERE id GLOB 'agent_[0-9]*' AND id NOT IN ('clawdmarket_buyer', 'clawdmarket_seller', 'agent_clawdmarket_system')`,
    args: [],
  });

  return NextResponse.json({
    ok: true,
    query1_seed_test_names: r1.rowsAffected,
    query2_timestamp_ids: r2.rowsAffected,
  });
}
