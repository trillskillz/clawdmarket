import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { waitlist } from '@/lib/schema';
import { waitlistSchema } from '@/lib/validation';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import { validateCsrf } from '@/lib/csrf';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
  const rateLimitResult = await rateLimit(`waitlist:${ip}`, { 
    interval: 60 * 60 * 1000, // 1 hour
    maxRequests: 3 
  });

  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: 'Too many waitlist submissions. Please try again later.' },
      { 
        status: 429,
        headers: getRateLimitHeaders(rateLimitResult),
      }
    );
  }

  try {
    const body = await req.json();
    const validated = waitlistSchema.parse(body);

    // Check if email already exists
    const [existing] = await db
      .select()
      .from(waitlist)
      .where(eq(waitlist.email, validated.email));

    if (existing) {
      return NextResponse.json(
        { message: 'You\'re already on the waitlist!' },
        { 
          status: 200,
          headers: getRateLimitHeaders(rateLimitResult),
        }
      );
    }

    // Add to waitlist
    await db.insert(waitlist).values({
      email: validated.email,
    });

    // Get total count
    const allEntries = await db.select().from(waitlist);
    const count = allEntries.length;

    return NextResponse.json(
      {
        message: 'Successfully added to waitlist!',
        position: count,
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
    console.error('Waitlist submission error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
