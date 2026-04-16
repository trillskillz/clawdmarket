import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { users } from '@/lib/schema';
import { verifyPassword, generateJWT } from '@/lib/auth';
import { loginSchema } from '@/lib/validation';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import { generateCsrfToken } from '@/lib/csrf';
import { eq } from 'drizzle-orm';
import { isIpBlacklisted, isUserBanned, trackUserIp } from '@/lib/agent-moderation';

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
  if (await isIpBlacklisted(ip)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  const rateLimitResult = await rateLimit(`login:${ip}`, { interval: 60 * 1000, maxRequests: 10 });

  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: 'Too many login attempts. Please try again later.' },
      { 
        status: 429,
        headers: getRateLimitHeaders(rateLimitResult),
      }
    );
  }

  try {
    const body = await req.json();
    const validated = loginSchema.parse(body);

    // Find user
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, validated.email));

    if (!user) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    if (await isUserBanned(user.id)) {
      return NextResponse.json({ error: 'Account banned' }, { status: 403 });
    }

    // Verify password
    const isValid = await verifyPassword(validated.password, user.password_hash);
    if (!isValid) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    await trackUserIp(user.id, ip);

    // Generate JWT
    const token = generateJWT({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    // Generate CSRF token
    const csrfToken = generateCsrfToken();

    const response = NextResponse.json(
      {
        message: 'Login successful',
        authenticated: true,
        token: token, // Return token for API clients (CLI/SDK)
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
      },
      { 
        status: 200,
        headers: getRateLimitHeaders(rateLimitResult),
      }
    );

    // Set HTTP-only auth cookie
    response.cookies.set('auth-token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 3600, // 1 hour
      path: '/',
    });

    // Set CSRF token cookie (NOT http-only, so JS can read it)
    response.cookies.set('csrf-token', csrfToken, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 3600, // 1 hour
      path: '/',
    });

    return response;
  } catch (error: any) {
    if (error.errors) {
      return NextResponse.json(
        { error: 'Validation failed', details: error.errors },
        { status: 400 }
      );
    }
    console.error('Login error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
