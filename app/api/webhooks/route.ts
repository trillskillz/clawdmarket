import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { webhooks } from '@/lib/schema';
import { mppx } from '@/lib/mpp';
import { createWebhookSchema } from '@/lib/validation';
import { createWebhookSecret, hashSecret } from '@/lib/webhook-delivery';
import { resolveRequestPrincipal } from '@/lib/request-principal';
import { validateCsrf } from '@/lib/csrf';
import { assertSafeWebhookDestination } from '@/lib/webhook-url';

export const dynamic = 'force-dynamic'

async function createWebhook(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const validated = createWebhookSchema.safeParse(body);
  if (!validated.success) {
    return NextResponse.json({ error: 'validation_failed', details: validated.error.issues }, { status: 400 });
  }

  const { url, events } = validated.data;
  const principal = await resolveRequestPrincipal(req);
  if (!principal) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (principal.usesCookieAuth && !validateCsrf(req)) {
    return NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 });
  }
  try {
    await assertSafeWebhookDestination(url);
  } catch {
    return NextResponse.json({ error: 'invalid_url', message: 'Webhook destination must resolve to a public HTTPS address' }, { status: 400 });
  }
  const webhookId = randomUUID();
  const secret = createWebhookSecret(webhookId);
  const secretHash = await hashSecret(secret);

  const [created] = await db
    .insert(webhooks)
    .values({
      id: webhookId,
      agent_id: principal.userId,
      url,
      secret_hash: secretHash,
      events: JSON.stringify(events),
      active: 1,
    })
    .returning({ id: webhooks.id });

  return NextResponse.json({
    webhook_id: created.id,
    webhook: { id: created.id, url, events, active: true },
    secret,
  }, { status: 201 });
}

async function listWebhooks(req: NextRequest) {
  const principal = await resolveRequestPrincipal(req);
  if (!principal) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

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
    .where(eq(webhooks.agent_id, principal.userId));

  return NextResponse.json({
    webhooks: rows.map((w) => ({ ...w, events: JSON.parse(w.events || '[]') })),
  });
}

export async function POST(req: NextRequest) {
  const principal = await resolveRequestPrincipal(req);
  if (principal) return createWebhook(req);
  return mppx.charge({ amount: '0.001' })(createWebhook)(req);
}
export async function GET(req: NextRequest) {
  const principal = await resolveRequestPrincipal(req);
  if (principal) return listWebhooks(req);
  return mppx.charge({ amount: '0.001' })(listWebhooks)(req);
}
