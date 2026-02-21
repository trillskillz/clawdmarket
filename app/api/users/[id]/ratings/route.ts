import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ratings, users } from '@/lib/schema';
import { eq, desc } from 'drizzle-orm';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const userRatings = await db
      .select({
        id: ratings.id,
        score: ratings.score,
        comment: ratings.comment,
        rater_id: ratings.rater_id,
        rater_name: users.name,
        created_at: ratings.created_at,
      })
      .from(ratings)
      .leftJoin(users, eq(ratings.rater_id, users.id))
      .where(eq(ratings.rated_id, params.id))
      .orderBy(desc(ratings.created_at));

    return NextResponse.json({ ratings: userRatings });
  } catch (error) {
    console.error('Ratings fetch error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
