import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { authenticateRequest } from '@/lib/auth';
import { authorizeAdmin } from '@/lib/admin-auth';
import { db } from '@/lib/db';
import { banned_users, blacklisted_ips, users } from '@/lib/schema';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import { validateCsrf } from '@/lib/csrf';

export const dynamic = 'force-dynamic';

async function adminFor(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('auth-token')?.value;
  const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));
  return { auth, authHeader, error: authorizeAdmin(auth ? { userId: auth.userId, email: auth.email } : null) };
}

export async function GET(req: NextRequest) {
  const { error } = await adminFor(req);
  if (error) return error;

  try {
    const [bannedResult, ipResult] = await Promise.all([
      db.$client.execute(`
        SELECT b.user_id, b.reason, b.created_at, u.name, u.email
        FROM banned_users b
        LEFT JOIN users u ON u.id = b.user_id
        ORDER BY b.created_at DESC
        LIMIT 500
      `),
      db.$client.execute(`
        SELECT ip, reason, created_at
        FROM blacklisted_ips
        ORDER BY created_at DESC
        LIMIT 500
      `),
    ]);
    return NextResponse.json({
      banned_users: bannedResult.rows || [],
      blacklisted_ips: ipResult.rows || [],
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('Moderation list error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { auth, authHeader, error } = await adminFor(req);
  if (error) return error;
  if (!authHeader && !validateCsrf(req)) {
    return NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 });
  }

  const rl = await rateLimit(`admin:${auth!.userId}`, { interval: 60_000, maxRequests: 30 });
  if (!rl.success) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429, headers: getRateLimitHeaders(rl) });
  }

  try {
    const body = await req.json();
    const action = body?.action === 'ban' ? 'ban_user' : body?.action === 'unban' ? 'unban_user' : body?.action;

    if (action === 'unblacklist_ip') {
      const ip = typeof body?.ip === 'string' ? body.ip.trim() : '';
      if (!ip || ip.length > 64) return NextResponse.json({ error: 'Invalid IP address' }, { status: 400 });
      await db.delete(blacklisted_ips).where(eq(blacklisted_ips.ip, ip));
      return NextResponse.json({ success: true, action, ip }, { headers: getRateLimitHeaders(rl) });
    }

    if (action !== 'ban_user' && action !== 'unban_user') {
      return NextResponse.json({ error: 'Invalid moderation action' }, { status: 400 });
    }
    const userIdValue = body?.user_id ?? body?.userId;
    const userId = typeof userIdValue === 'string' ? userIdValue.trim() : '';
    if (!userId || userId.length > 128) return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 });

    const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
    if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const now = new Date();
    const nowMs = now.getTime();
    if (action === 'ban_user') {
      const reason = typeof body?.reason === 'string' && body.reason.trim()
        ? body.reason.trim().slice(0, 500)
        : 'Administrative action';
      await db.transaction(async (tx) => {
        await tx.insert(banned_users).values({ user_id: userId, reason, created_at: nowMs })
          .onConflictDoUpdate({ target: banned_users.user_id, set: { reason, created_at: nowMs } });
        await tx.update(users).set({ is_banned: true, updated_at: now }).where(eq(users.id, userId));
      });
    } else {
      await db.transaction(async (tx) => {
        await tx.delete(banned_users).where(eq(banned_users.user_id, userId));
        await tx.update(users).set({ is_banned: false, updated_at: now }).where(eq(users.id, userId));
      });
    }

    return NextResponse.json({ success: true, user_id: userId, action }, { headers: getRateLimitHeaders(rl) });
  } catch (err) {
    console.error('Moderation error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
