import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import { getRequestIp } from '@/lib/request-ip';

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const ip = getRequestIp(req);
  const rl = await rateLimit(`wallet-nonce:${ip}`, { interval: 60_000, maxRequests: 30, failClosed: true });

  if (!rl.success) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: getRateLimitHeaders(rl) });
  }

  const nonce = crypto.randomBytes(16).toString('hex');
  const message = `Sign in to ClawdMarket\nNonce: ${nonce}`;

  const response = NextResponse.json({ nonce, message }, { headers: getRateLimitHeaders(rl) });

  response.cookies.set('wallet-nonce', nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 10 * 60,
    path: '/',
  });

  return response;
}
