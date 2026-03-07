import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { contract_disputes } from '@/lib/schema';
import { authenticateRequest } from '@/lib/auth';
import { authorizeAdmin } from '@/lib/admin-auth';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('auth-token')?.value;
  const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));
  const error = authorizeAdmin(auth ? { userId: auth.userId, email: auth.email } : null);
  if (error) return error;

  try {
    const disputes = await db.select().from(contract_disputes);
    return NextResponse.json({ disputes });
  } catch (err) {
    console.error('List disputes error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
