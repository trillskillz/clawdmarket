import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { users } from '@/lib/schema';
import { hashPassword, validatePasswordStrength } from '@/lib/auth';
import { registerSchema } from '@/lib/validation';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import { eq } from 'drizzle-orm';
import { isIpBlacklisted, trackUserIp } from '@/lib/agent-moderation';

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
  if (await isIpBlacklisted(ip)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  const rateLimitResult = rateLimit(`register:${ip}`, { interval: 60 * 1000, maxRequests: 5 });

  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: 'Too many registration attempts. Please try again later.' },
      { 
        status: 429,
        headers: getRateLimitHeaders(rateLimitResult),
      }
    );
  }

  try {
    const body = await req.json();
    const validated = registerSchema.parse(body);

    // Validate password strength
    const passwordCheck = validatePasswordStrength(validated.password);
    if (!passwordCheck.valid) {
      return NextResponse.json(
        { error: passwordCheck.error },
        { status: 400 }
      );
    }

    // Check if email already exists
    const [existingUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, validated.email));

    if (existingUser) {
      return NextResponse.json(
        { error: 'Email already registered' },
        { status: 400 }
      );
    }

    // Hash password
    const password_hash = await hashPassword(validated.password);

    // Create user
    const [newUser] = await db
      .insert(users)
      .values({
        email: validated.email,
        password_hash,
        name: validated.name,
        role: validated.role,
      })
      .returning();

    await trackUserIp(newUser.id, ip);

    return NextResponse.json(
      {
        message: 'Registration successful',
        user: {
          id: newUser.id,
          email: newUser.email,
          name: newUser.name,
          role: newUser.role,
        },
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
    console.error('Registration error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
