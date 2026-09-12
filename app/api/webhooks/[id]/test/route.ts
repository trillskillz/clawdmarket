import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { webhooks } from '@/lib/schema';
import { deliverWebhookEvent } from '@/lib/webhook-delivery';
import { resolveRequestPrincipal } from '@/lib/request-principal';
import { validateCsrf } from '@/lib/csrf';
import { webhook_deliveries } from '@/lib/schema';
import { desc } from 'drizzle-orm';

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const principal = await resolveRequestPrincipal(req);
  if (!principal) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (principal.usesCookieAuth && !validateCsrf(req)) {
    return NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 });
  }

  const [webhook] = await db
    .select({ id: webhooks.id, events: webhooks.events })
    .from(webhooks)
    .where(and(eq(webhooks.id, id), eq(webhooks.agent_id, principal.userId), eq(webhooks.active, 1)))
    .limit(1);

  if (!webhook) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  let events: string[] = [];
  try { events = JSON.parse(webhook.events || '[]'); } catch {}
  const event = events[0];
  if (!event) return NextResponse.json({ error: 'webhook_has_no_events' }, { status: 409 });

  await deliverWebhookEvent(principal.userId, event, { test: true, source: 'webhook-test' });
  const [delivery] = await db
    .select({ response_status: webhook_deliveries.response_status, success: webhook_deliveries.success })
    .from(webhook_deliveries)
    .where(eq(webhook_deliveries.webhook_id, id))
    .orderBy(desc(webhook_deliveries.delivered_at))
    .limit(1);

  return NextResponse.json({
    ok: true,
    delivered: delivery?.success === 1,
    response_status: delivery?.response_status ?? 0,
    event,
  });
}
