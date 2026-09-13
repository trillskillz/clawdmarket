import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { analytics_events } from '@/lib/schema';
import { authenticateRequest } from '@/lib/auth';
import { z } from 'zod';
import crypto from 'crypto';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import { getRequestIp } from '@/lib/request-ip';

export const dynamic = 'force-dynamic'

const trackEventSchema = z.object({
  event_type: z.enum([
    'view_listing',
    'trade_init',
    'search',
    'add_favorite',
    'remove_favorite',
    'view_profile',
    'copy_install_cmd',
    'hire_started',
    'trade_created',
    'delivery_submitted',
    'trade_completed',
    'rating_submitted',
    'listing_created',
  ]),
  metadata: z.record(z.string(), z.any()).optional(),
});

function hashIp(ip: string) {
  let salt = process.env.ANALYTICS_SALT?.trim() || process.env.JWT_SECRET?.trim();
  if (!salt) {
    if (process.env.NODE_ENV === 'production') throw new Error('ANALYTICS_SALT or JWT_SECRET is required for analytics hashing');
    salt = 'clawdmarket-local-analytics-salt';
  }
  return crypto.createHash('sha256').update(`${salt}:${ip}`).digest('hex').substring(0, 16);
}

export async function POST(req: NextRequest) {
  // Fire and forget - don't block main thread too much
  try {
    const body = await req.json();
    const { event_type, metadata } = trackEventSchema.parse(body);

    const authHeader = req.headers.get('authorization');
    const cookieToken = req.cookies.get('auth-token')?.value;
    const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));
    
    const ip = getRequestIp(req);
    const limit = await rateLimit(`analytics:${ip}`, { interval: 60_000, maxRequests: 120, failClosed: true });
    if (!limit.success) {
      return NextResponse.json({ success: false, error: 'rate_limit_exceeded' }, { status: 429, headers: getRateLimitHeaders(limit) });
    }
    const ip_hash = hashIp(ip);
    const metadataJson = metadata ? JSON.stringify(metadata) : null;
    if (metadataJson && metadataJson.length > 10_000) {
      return NextResponse.json({ success: false, error: 'metadata_too_large' }, { status: 413 });
    }

    await db.insert(analytics_events).values({
      user_id: auth?.userId || null,
      event_type,
      metadata: metadataJson,
      ip_hash,
    });

    return NextResponse.json({ success: true }, { headers: getRateLimitHeaders(limit) });
  } catch (error) {
    console.error('Analytics error:', error);
    // Return success anyway to not break client
    return NextResponse.json({ success: true, ignored_error: true });
  }
}
