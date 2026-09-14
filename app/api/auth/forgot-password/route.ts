import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { db } from '@/lib/db';
import { users } from '@/lib/schema';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import { storeResetToken } from '@/lib/password-reset';
import { eq } from 'drizzle-orm';
import { getRequestIp } from '@/lib/request-ip';
import { isPasswordResetEmailConfigured } from '@/lib/password-reset-email';

export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json(
    { configured: isPasswordResetEmailConfigured() },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request: NextRequest) {
  const ip = getRequestIp(request);
  const rateLimitResult = await rateLimit(`forgot-password:${ip}`, {
    interval: 60 * 60 * 1000,
    maxRequests: 3,
    failClosed: true,
  });

  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      { status: 429, headers: getRateLimitHeaders(rateLimitResult) }
    );
  }

  if (!isPasswordResetEmailConfigured()) {
    return NextResponse.json(
      {
        error: 'password_reset_unavailable',
        message: 'Email password recovery is temporarily unavailable. Use signed-wallet access or contact support.',
      },
      {
        status: 503,
        headers: {
          ...getRateLimitHeaders(rateLimitResult),
          'Cache-Control': 'no-store',
          'Retry-After': '3600',
        },
      },
    );
  }

  try {
    const { email } = await request.json();

    if (!email || typeof email !== 'string') {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400, headers: getRateLimitHeaders(rateLimitResult) }
      );
    }

    const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase().trim()));

    let resetToken: string | undefined;

    if (user) {
      resetToken = crypto.randomBytes(32).toString('hex');
      await storeResetToken(resetToken, user.id);

      const resendKey = process.env.RESEND_API_KEY!.trim();
      const from = process.env.PASSWORD_RESET_FROM_EMAIL!.trim();
      const origin = process.env.NEXT_PUBLIC_BASE_URL?.trim() || 'https://www.clawdmkt.com';
      const resetUrl = `${new URL(origin).origin}/auth/reset-password?token=${encodeURIComponent(resetToken)}`;
      const sent = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from,
          to: [user.email],
          subject: 'Reset your ClawdMarket password',
          text: `Reset your ClawdMarket password within 15 minutes: ${resetUrl}`,
        }),
      });
      if (!sent.ok) throw new Error('Password reset email delivery failed');
    }

    return NextResponse.json(
      {
        message: 'If an account with that email exists, a reset link has been generated.',
        ...(resetToken && process.env.NODE_ENV !== 'production' ? { resetToken } : {}),
      },
      { status: 200, headers: getRateLimitHeaders(rateLimitResult) }
    );
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
