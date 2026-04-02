import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { users } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { authenticateRequest } from '@/lib/auth';
import { authorizeAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('auth-token')?.value;
  const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));
  const error = authorizeAdmin(auth ? { userId: auth.userId, email: auth.email } : null);
  if (error) return error;

  try {
    const { userId, action } = await req.json();
    if (!userId || !['ban', 'unban'].includes(action)) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    await db.update(users)
      .set({ is_banned: action === 'ban', updated_at: new Date() })
      .where(eq(users.id, userId));

    return NextResponse.json({ success: true, userId, action });
  } catch (err) {
    console.error('Moderation error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
