import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getOperatorAddress, unauthorized } from '@/lib/operator-auth';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const address = await getOperatorAddress(req);
  if (!address) return unauthorized();

  const { id } = await params;

  const client = (db as any).$client;

  const agentRow = await client.execute({
    sql: `SELECT id, status, owner_address FROM agents WHERE id = ?`,
    args: [id],
  });

  const agent = agentRow.rows?.[0];
  if (!agent) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (String(agent.owner_address).toLowerCase() !== address) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const newStatus = body.status === 'active' ? 'active' : 'paused';

  await client.execute({
    sql: `UPDATE agents SET status = ? WHERE id = ? AND LOWER(owner_address) = ?`,
    args: [newStatus, id, address],
  });

  return NextResponse.json({ ok: true, id, status: newStatus });
}
