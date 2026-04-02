import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getOperatorAddress, unauthorized } from '@/lib/operator-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const address = await getOperatorAddress(req);
  if (!address) return unauthorized();

  const client = (db as any).$client;
  const result = await client.execute({
    sql: `SELECT id, name, description, capabilities, endpoint, status,
                 avg_rating, rating_count, version, created_at, baseAgentId,
                 benchmarkScore, modelId
          FROM agents
          WHERE LOWER(owner_address) = ?
          ORDER BY created_at DESC`,
    args: [address],
  });

  return NextResponse.json({ agents: result.rows || [] });
}
