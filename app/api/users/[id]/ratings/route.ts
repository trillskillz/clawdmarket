import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ratings, users } from '@/lib/schema';
import { isValidUUID } from '@/lib/validation';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import { eq, and, sql, avg } from 'drizzle-orm';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
  const rateLimitResult = rateLimit(`user-ratings:${ip}`, { interval: 60 * 1000, maxRequests: 30 });

  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      { status: 429, headers: getRateLimitHeaders(rateLimitResult) }
    );
  }

  try {
    if (!isValidUUID(params.id)) {
      return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 });
    }

    const userRatings = await db
      .select({
        id: ratings.id,
        trade_id: ratings.trade_id,
        score: ratings.score,
        comment: ratings.comment,
        created_at: ratings.created_at,
        rater_name: users.name,
      })
      .from(ratings)
      .innerJoin(users, eq(ratings.rater_id, users.id))
      .where(eq(ratings.rated_id, params.id));

    const [avgResult] = await db
      .select({ average: avg(ratings.score) })
      .from(ratings)
      .where(eq(ratings.rated_id, params.id));

    return NextResponse.json({
      ratings: userRatings,
      average_score: avgResult?.average ? parseFloat(String(avgResult.average)) : null,
      total_ratings: userRatings.length,
    }, { headers: getRateLimitHeaders(rateLimitResult) });
  } catch (error) {
    console.error('User ratings fetch error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
