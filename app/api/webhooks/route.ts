import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { webhooks } from '@/lib/schema';
import { authenticateRequest } from '@/lib/auth';
import { createWebhookSchema } from '@/lib/validation';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import { validateCsrf } from '@/lib/csrf';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('auth-token')?.value;
  const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));

  if (!auth) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  // Validate CSRF for cookie-based auth
  if (!authHeader && !validateCsrf(req)) {
    return NextResponse.json(
      { error: 'CSRF validation failed' },
      { status: 403 }
    );
  }

  const rateLimitResult = rateLimit(`webhook:${auth.userId}`, { 
    interval: 60 * 60 * 1000, 
    maxRequests: 10 
  });

  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: 'Too many webhook creation attempts. Please try again later.' },
      { 
        status: 429,
        headers: getRateLimitHeaders(rateLimitResult),
      }
    );
  }

  try {
    const body = await req.json();
    const validated = createWebhookSchema.parse(body);

    // Generate secret for webhook signature
    const secret = crypto.randomBytes(32).toString('hex');

    const [newWebhook] = await db
      .insert(webhooks)
      .values({
        user_id: auth.userId,
        url: validated.url,
        events: validated.events.join(','),
        secret: secret,
      })
      .returning();

    return NextResponse.json(
      {
        message: 'Webhook created successfully',
        webhook: {
          id: newWebhook.id,
          url: newWebhook.url,
          events: validated.events,
          secret: secret,
          created_at: newWebhook.created_at,
        },
        note: 'Save the secret - it will be used to sign webhook payloads',
      },
      { 
        status: 201,
        headers: getRateLimitHeaders(rateLimitResult),
      }
    );
  } catch (error: any) {
    if (error.errors) {
      return NextResponse.json(
        { error: 'Validation failed', details: error.errors },
        { status: 400 }
      );
    }
    console.error('Webhook creation error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('auth-token')?.value;
  const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));

  if (!auth) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  try {
    const userWebhooks = await db
      .select({
        id: webhooks.id,
        url: webhooks.url,
        events: webhooks.events,
        created_at: webhooks.created_at,
      })
      .from(webhooks)
      .where(eq(webhooks.user_id, auth.userId));

    return NextResponse.json({
      webhooks: userWebhooks.map(wh => ({
        ...wh,
        events: wh.events.split(','),
      })),
    });
  } catch (error) {
    console.error('Webhooks fetch error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
