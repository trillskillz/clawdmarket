import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { webhooks } from '@/lib/schema';
import { authenticateRequest } from '@/lib/auth';
import { validateCsrf } from '@/lib/csrf';
import { isValidUUID } from '@/lib/validation';

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('auth-token')?.value;
  const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));

  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!authHeader && !validateCsrf(req)) return NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 });
  if (!isValidUUID(params.id)) return NextResponse.json({ error: 'Invalid webhook ID' }, { status: 400 });

  const [found] = await db.select().from(webhooks).where(and(eq(webhooks.id, params.id), eq(webhooks.user_id, auth.userId))).limit(1);
  if (!found) return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });

  await db.delete(webhooks).where(eq(webhooks.id, params.id));
  return NextResponse.json({ message: 'Webhook unsubscribed successfully', id: params.id });
}
