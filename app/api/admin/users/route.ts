import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { users } from '@/lib/schema';
import { authenticateRequest } from '@/lib/auth';
import { authorizeAdmin } from '@/lib/admin-auth';
import { desc, like, or } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('auth-token')?.value;
  const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));
  const error = authorizeAdmin(auth ? { userId: auth.userId, email: auth.email } : null);
  if (error) return error;

  const search = req.nextUrl.searchParams.get('q') || '';

  try {
    const query = db.select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      is_banned: users.is_banned,
      created_at: users.created_at,
    }).from(users);

    if (search) {
      query.where(or(
        like(users.name, `%${search}%`),
        like(users.email, `%${search}%`),
        like(users.id, `%${search}%`)
      ));
    }

    const rows = await query.orderBy(desc(users.created_at)).limit(50);
    return NextResponse.json({ users: rows });
  } catch (err) {
    console.error('List users error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
