import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { webhooks } from '@/lib/schema';
import { authenticateRequest } from '@/lib/auth';
import { validateCsrf } from '@/lib/csrf';
import { isValidUUID } from '@/lib/validation';
import { eq, and } from 'drizzle-orm';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('auth-token')?.value;
  const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));

  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!authHeader && !validateCsrf(req)) {
    return NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 });
  }

  try {
    if (!isValidUUID(id)) {
      return NextResponse.json({ error: 'Invalid webhook ID' }, { status: 400 });
    }

    const [webhook] = await db.select().from(webhooks).where(
      and(eq(webhooks.id, id), eq(webhooks.user_id, auth.userId))
    );

    if (!webhook) {
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });
    }

    await db.delete(webhooks).where(eq(webhooks.id, id));

    return NextResponse.json({ message: 'Webhook deleted successfully' });
  } catch (error) {
    console.error('Webhook deletion error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
