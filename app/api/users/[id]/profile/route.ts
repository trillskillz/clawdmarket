import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { users, trades, listings, ratings } from '@/lib/schema';
import { isValidUUID } from '@/lib/validation';
import { eq, sql } from 'drizzle-orm';
import { FALLBACK_AGENTS } from '@/lib/fallback-agents';
import { loadAgentTrust } from '@/lib/agent-trust';

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    if (!isValidUUID(id)) {
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
      .where(eq(users.id, id));

    if (!user) {
      const fallback = FALLBACK_AGENTS.find((a) => a.id === id);
      if (!fallback) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }

      return NextResponse.json({
        profile: {
          id: fallback.id,
          name: fallback.name,
          email: `${fallback.name.toLowerCase().replace(/\s+/g, '.')}@agents.clawdmarket.local`,
          role: fallback.role,
          wallet: null,
          bio: fallback.bio,
          avatar_url: fallback.avatar_url,
          avatar_emoji: null,
          trust_score: null,
          trust_confidence: 'low',
          trust_drivers: ['No verified activity yet'],
          trust_evidence_points: 0,
          joined: new Date().toISOString(),
          stats: {
            completed_trades_as_seller: 0,
            disputed_trades_as_seller: 0,
            active_listings: 0,
            average_rating: null,
            total_ratings: 0,
          },
        },
      });
    }

    // Calculate stats
    const [stats] = await db
      .select({
        completed_trades_as_seller: sql<number>`count(case when ${trades.status} in ('completed','complete') then 1 else null end)`,
        disputed_trades_as_seller: sql<number>`count(case when ${trades.status} = 'disputed' then 1 else null end)`,
        active_listings: sql<number>`(select count(*) from ${listings} where ${listings.seller_id} = ${user.id} and ${listings.status} = 'active')`,
        average_rating: sql<number>`(select avg(${ratings.score}) from ${ratings} where ${ratings.rated_id} = ${user.id})`,
        total_ratings: sql<number>`(select count(*) from ${ratings} where ${ratings.rated_id} = ${user.id})`,
      })
      .from(trades)
      .where(eq(trades.seller_id, user.id));

    const trust = await loadAgentTrust({
      id: user.id,
      created_at: user.created_at,
      avg_rating: stats?.average_rating,
      rating_count: stats?.total_ratings,
    });

    return NextResponse.json({
      profile: {
        ...user,
        joined: user.created_at,
        trust_score: trust.trustScore,
        trust_confidence: trust.confidence,
        trust_drivers: trust.drivers,
        trust_evidence_points: trust.evidencePoints,
        stats: {
          completed_trades_as_seller: stats?.completed_trades_as_seller || 0,
          disputed_trades_as_seller: stats?.disputed_trades_as_seller || 0,
          active_listings: stats?.active_listings || 0,
          average_rating: trust.components.averageRating,
          total_ratings: trust.components.ratingCount,
          likes: trust.components.positiveRatings,
          dislikes: trust.components.negativeRatings,
          effective_dislikes: trust.components.negativeRatings,
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
