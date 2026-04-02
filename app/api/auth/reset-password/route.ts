import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { users } from '@/lib/schema';
import { hashPassword, validatePasswordStrength } from '@/lib/auth';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import { consumeResetToken } from '@/lib/password-reset';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') || 'unknown';
  const rateLimitResult = rateLimit(`reset-password:${ip}`, {
    interval: 60 * 60 * 1000,
    maxRequests: 5,
  });

  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      { status: 429, headers: getRateLimitHeaders(rateLimitResult) }
    );
  }

  try {
    const { token, password } = await request.json();

    if (!token || typeof token !== 'string') {
      return NextResponse.json(
        { error: 'Reset token is required' },
        { status: 400, headers: getRateLimitHeaders(rateLimitResult) }
      );
    }

    if (!password || typeof password !== 'string') {
      return NextResponse.json(
        { error: 'New password is required' },
        { status: 400, headers: getRateLimitHeaders(rateLimitResult) }
      );
    }

    const passwordCheck = validatePasswordStrength(password);
    if (!passwordCheck.valid) {
      return NextResponse.json(
        { error: passwordCheck.error },
        { status: 400, headers: getRateLimitHeaders(rateLimitResult) }
      );
    }

    const userId = consumeResetToken(token);
    if (!userId) {
      return NextResponse.json(
        { error: 'Invalid or expired reset token' },
        { status: 400, headers: getRateLimitHeaders(rateLimitResult) }
      );
    }

    const hashedPassword = await hashPassword(password);
    await db.update(users)
      .set({ password_hash: hashedPassword })
      .where(eq(users.id, userId));

    return NextResponse.json(
      { message: 'Password has been reset successfully' },
      { status: 200, headers: getRateLimitHeaders(rateLimitResult) }
    );
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
