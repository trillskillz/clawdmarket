import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { webhooks } from '@/lib/schema';
import { mppx } from '@/lib/mpp';
import { createWebhookSchema } from '@/lib/validation';
import { agentIdFromRequestPayer, hashSecret } from '@/lib/webhook-delivery';

async function createWebhook(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const validated = createWebhookSchema.safeParse(body);
  if (!validated.success) {
    return NextResponse.json({ error: 'validation_failed', details: validated.error.issues }, { status: 400 });
  }

  const { url, events } = validated.data;
  if (!url.startsWith('https://')) {
    return NextResponse.json({ error: 'invalid_url' }, { status: 400 });
  }

  const agentId = await agentIdFromRequestPayer(req);
  if (!agentId) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const secret = `${randomUUID()}${randomUUID()}`;
  const secretHash = await hashSecret(secret);

  const [created] = await db
    .insert(webhooks)
    .values({
      agent_id: agentId,
      url,
      secret_hash: secretHash,
      events: JSON.stringify(events),
      active: 1,
    })
    .returning({ id: webhooks.id });

  return NextResponse.json({ webhook_id: created.id, secret }, { status: 201 });
}

async function listWebhooks(req: NextRequest) {
  const agentId = await agentIdFromRequestPayer(req);
  if (!agentId) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const rows = await db
    .select({
      id: webhooks.id,
      url: webhooks.url,
      events: webhooks.events,
      active: webhooks.active,
      created_at: webhooks.created_at,
      last_triggered_at: webhooks.last_triggered_at,
      failure_count: webhooks.failure_count,
    })
    .from(webhooks)
    .where(eq(webhooks.agent_id, agentId));

  return NextResponse.json({
    webhooks: rows.map((w) => ({ ...w, events: JSON.parse(w.events || '[]') })),
  });
}

export async function POST(req: NextRequest) {
  return mppx.session({ amount: '0.001', unitType: 'request' })(createWebhook)(req);
}
export async function GET(req: NextRequest) {
  return mppx.session({ amount: '0.001', unitType: 'request' })(listWebhooks)(req);
}
