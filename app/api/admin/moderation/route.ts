import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { isAdminEmail } from '@/lib/admin';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isAdminEmail(session.user.email)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const bannedUsers = await (db as any).$client.execute('SELECT user_id, reason, created_at FROM banned_users ORDER BY created_at DESC LIMIT 200');
  const blacklistedIps = await (db as any).$client.execute('SELECT ip, reason, created_at FROM blacklisted_ips ORDER BY created_at DESC LIMIT 200');

  return NextResponse.json({
    banned_users: bannedUsers.rows || [],
    blacklisted_ips: blacklistedIps.rows || [],
  });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isAdminEmail(session.user.email)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { action, user_id, ip } = body || {};

  if (action === 'unban_user' && user_id) {
    await (db as any).$client.execute({ sql: 'DELETE FROM banned_users WHERE user_id = ?', args: [user_id] });
    return NextResponse.json({ success: true });
  }
  if (action === 'unblacklist_ip' && ip) {
    await (db as any).$client.execute({ sql: 'DELETE FROM blacklisted_ips WHERE ip = ?', args: [ip] });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
