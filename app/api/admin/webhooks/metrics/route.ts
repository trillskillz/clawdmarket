import { NextRequest, NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { authenticateRequest } from '@/lib/auth';
import { authorizeAdmin } from '@/lib/admin-auth';
import { db } from '@/lib/db';
import { webhooks } from '@/lib/schema';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('auth-token')?.value;
  const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));
  const error = authorizeAdmin(auth ? { userId: auth.userId, email: auth.email } : null);
  if (error) return error;

  try {
    const [totalRow] = await db.select({ count: sql<number>`count(*)` }).from(webhooks);
    const rows = await db.select({ events: webhooks.events }).from(webhooks);

    const byEvent: Record<string, number> = {
      'agent.registered': 0,
      'job.created': 0,
      'job.completed': 0,
      'job.failed': 0,
    };

    for (const row of rows) {
      for (const event of String(row.events || '').split(',').map((e) => e.trim()).filter(Boolean)) {
        byEvent[event] = (byEvent[event] || 0) + 1;
      }
    }

    return NextResponse.json({
      total_subscribers: Number(totalRow?.count || 0),
      by_event: byEvent,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Webhook metrics error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
