import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { z } from 'zod';
import { db } from '@/lib/db';
import { webhooks } from '@/lib/schema';
import { authenticateRequest } from '@/lib/auth';
import { validateCsrf } from '@/lib/csrf';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';

const subscribeSchema = z.object({
  callback_url: z.string().url().refine((v) => v.startsWith('https://'), 'callback_url must use https'),
  events: z.array(z.enum(['agent.registered', 'job.created', 'job.completed', 'job.failed'])).min(1),
});

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('auth-token')?.value;
  const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));

  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!authHeader && !validateCsrf(req)) return NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 });

  const rl = rateLimit(`webhook-subscribe:${auth.userId}`, { interval: 60 * 60 * 1000, maxRequests: 20 });
  if (!rl.success) return NextResponse.json({ error: 'Too many subscribe attempts' }, { status: 429, headers: getRateLimitHeaders(rl) });

  try {
    const body = await req.json();
    const validated = subscribeSchema.parse(body);

    const secret = crypto.randomBytes(32).toString('hex');
    const [row] = await db.insert(webhooks).values({
      user_id: auth.userId,
      url: validated.callback_url,
      events: validated.events.join(','),
      secret,
    }).returning();

    return NextResponse.json({
      message: 'Webhook subscription created',
      subscription: {
        id: row.id,
        callback_url: row.url,
        events: validated.events,
        signing_secret: secret,
      },
    }, { status: 201, headers: getRateLimitHeaders(rl) });
  } catch (error: any) {
    if (error?.errors) return NextResponse.json({ error: 'Validation failed', details: error.errors }, { status: 400 });
    console.error('Webhook subscribe error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
