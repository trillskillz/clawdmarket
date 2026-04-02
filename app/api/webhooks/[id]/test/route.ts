import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { webhooks } from '@/lib/schema';
import { agentIdFromRequestPayer, deliverWebhookEvent } from '@/lib/webhook-delivery';

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agentId = await agentIdFromRequestPayer(req);
  if (!agentId) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const [webhook] = await db
    .select({ id: webhooks.id, url: webhooks.url })
    .from(webhooks)
    .where(and(eq(webhooks.id, id), eq(webhooks.agent_id, agentId), eq(webhooks.active, 1)))
    .limit(1);

  if (!webhook) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // direct test ping
  const body = JSON.stringify({ event: 'ping', timestamp: new Date().toISOString(), agent_id: agentId, data: { test: true } });
  let status = 0;
  let delivered = false;
  try {
    const res = await fetch(webhook.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-ClawdMarket-Event': 'ping' },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    status = res.status;
    delivered = res.ok;
  } catch {
    status = 0;
    delivered = false;
  }

  await deliverWebhookEvent(agentId, 'message.received', { test: true, source: 'webhook-test' });

  return NextResponse.json({ ok: true, delivered, response_status: status });
}
