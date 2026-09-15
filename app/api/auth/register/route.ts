import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { users, wallets } from '@/lib/schema';
import { hashPassword, validatePasswordStrength } from '@/lib/auth';
import { registerSchema } from '@/lib/validation';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import { sql } from 'drizzle-orm';
import { isIpBlacklisted, trackUserIp } from '@/lib/agent-moderation';
import { getRequestIp } from '@/lib/request-ip';

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const ip = getRequestIp(req);
  if (await isIpBlacklisted(ip)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  const rateLimitResult = await rateLimit(`register:${ip}`, { interval: 3_600_000, maxRequests: 3, failClosed: true });

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
    const body = await req.json().catch(() => null);
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.issues },
        { status: 400, headers: getRateLimitHeaders(rateLimitResult) },
      );
    }
    const validated = parsed.data;

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
      .where(sql`LOWER(${users.email}) = ${validated.email.toLowerCase()}`);

    if (existingUser) {
      return NextResponse.json(
        { error: 'Email already registered' },
        { status: 400 }
      );
    }

    // Hash password
    const password_hash = await hashPassword(validated.password);

    // Create user
    const newUser = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(users)
        .values({
          email: validated.email.toLowerCase(),
          password_hash,
          name: validated.name,
          role: validated.role,
        })
        .returning();
      await tx.insert(wallets).values({ user_id: created.id, balance: 0, escrow: 0 });
      return created;
    });

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
    if (/unique constraint failed:\s*users\.email/i.test(String(error?.message || ''))) {
      return NextResponse.json({ error: 'Email already registered' }, { status: 409 });
    }
    console.error('Registration error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
