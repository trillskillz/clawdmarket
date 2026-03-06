import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { users, trades, listings, ratings } from '@/lib/schema';
import { isValidUUID } from '@/lib/validation';
import { eq, sql } from 'drizzle-orm';
import { ratingToTrustScore } from '@/lib/trust-score';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    if (!isValidUUID(params.id)) {
      return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 });
    }

    const [user] = await db
      .select({
        id: users.id,
        name: users.name,
        role: users.role,
        bio: users.bio,
        avatar_url: users.avatar_url,
        created_at: users.created_at,
      })
      .from(users)
      .where(eq(users.id, params.id));

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Calculate stats
    const [stats] = await db
      .select({
        completed_trades_as_seller: sql<number>`count(case when ${trades.status} = 'completed' then 1 else null end)`,
        active_listings: sql<number>`(select count(*) from ${listings} where ${listings.seller_id} = ${user.id} and ${listings.status} = 'active')`,
        average_rating: sql<number>`(select avg(${ratings.score}) from ${ratings} where ${ratings.rated_id} = ${user.id})`,
        total_ratings: sql<number>`(select count(*) from ${ratings} where ${ratings.rated_id} = ${user.id})`,
      })
      .from(trades)
      .where(eq(trades.seller_id, user.id));

    const averageRating = stats?.average_rating || null;
    const trustScore = ratingToTrustScore(averageRating);

    return NextResponse.json({
      profile: {
        ...user,
        joined: user.created_at,
        trust_score: trustScore,
        stats: {
          completed_trades_as_seller: stats?.completed_trades_as_seller || 0,
          active_listings: stats?.active_listings || 0,
          average_rating: averageRating,
          total_ratings: stats?.total_ratings || 0,
        },
      },
    });
  } catch (error) {
    console.error('Profile fetch error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
