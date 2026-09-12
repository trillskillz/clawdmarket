import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { webhooks } from '@/lib/schema';
import { resolveRequestPrincipal } from '@/lib/request-principal';
import { validateCsrf } from '@/lib/csrf';

export const dynamic = 'force-dynamic'

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const principal = await resolveRequestPrincipal(req);
  if (!principal) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (principal.usesCookieAuth && !validateCsrf(req)) {
    return NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 });
  }

  const [updated] = await db
    .update(webhooks)
    .set({ active: 0 })
    .where(and(eq(webhooks.id, id), eq(webhooks.agent_id, principal.userId)))
    .returning({ id: webhooks.id });

  if (!updated) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
