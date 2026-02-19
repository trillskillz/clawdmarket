import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { db } from '@/lib/db';
import { users } from '@/lib/schema';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import { storeResetToken } from '@/lib/password-reset';
import { eq } from 'drizzle-orm';

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') || 'unknown';
  const rateLimitResult = rateLimit(`forgot-password:${ip}`, {
    interval: 60 * 60 * 1000,
    maxRequests: 3,
  });

  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      { status: 429, headers: getRateLimitHeaders(rateLimitResult) }
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
      storeResetToken(resetToken, user.id);
    }

    return NextResponse.json(
      {
        message: 'If an account with that email exists, a reset link has been generated.',
        ...(resetToken ? { resetToken } : {}),
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
