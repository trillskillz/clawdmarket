import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { api_keys } from '@/lib/schema';
import { authenticateRequest } from '@/lib/auth';
import { validateCsrf } from '@/lib/csrf';
import { isValidUUID } from '@/lib/validation';
import { and, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic'

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

  if (!isValidUUID(id)) {
    return NextResponse.json({ error: 'Invalid API key ID' }, { status: 400 });
  }

  const deleted = await db
    .delete(api_keys)
    .where(and(eq(api_keys.id, id), eq(api_keys.user_id, auth.userId)))
    .returning({ id: api_keys.id });

  if (deleted.length === 0) {
    return NextResponse.json({ error: 'API key not found' }, { status: 404 });
  }

  return NextResponse.json({ message: 'API key revoked' });
}
