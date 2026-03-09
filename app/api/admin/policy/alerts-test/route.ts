import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { authorizeAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('auth-token')?.value;
  const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));
  const error = authorizeAdmin(auth ? { userId: auth.userId, email: auth.email } : null);
  if (error) return error;

  const webhook = process.env.ALERT_WEBHOOK_URL;
  if (!webhook) {
    return NextResponse.json({ error: 'ALERT_WEBHOOK_URL is not configured' }, { status: 400 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const note = body?.note ? String(body.note).slice(0, 140) : null;
    const msg = `🧪 ClawdMarket alert test from admin policy dashboard${note ? ` — ${note}` : ''}`;

    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: msg, content: msg }),
    });

    if (!res.ok) {
      return NextResponse.json({ error: `Webhook returned ${res.status}` }, { status: 502 });
    }

    return NextResponse.json({ ok: true, delivered: true, message: msg });
  } catch (err) {
    console.error('alerts-test error', err);
    return NextResponse.json({ error: 'Failed to send test alert' }, { status: 500 });
  }
}
