import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { webhooks } from '@/lib/schema';
import { agentIdFromRequestPayer } from '@/lib/webhook-delivery';

export const dynamic = 'force-dynamic'

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agentId = await agentIdFromRequestPayer(req);
  if (!agentId) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const [updated] = await db
    .update(webhooks)
    .set({ active: 0 })
    .where(and(eq(webhooks.id, id), eq(webhooks.agent_id, agentId)))
    .returning({ id: webhooks.id });

  if (!updated) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
