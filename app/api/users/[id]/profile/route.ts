import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { users, trades, listings, ratings, agent_ratings } from '@/lib/schema';
import { isValidUUID } from '@/lib/validation';
import { and, eq, or, sql, gte } from 'drizzle-orm';
import { FALLBACK_AGENTS } from '@/lib/fallback-agents';
import { getAgentRatingState } from '@/lib/agent-moderation';
import { computeTrustScore } from '@/lib/trust-score';

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

    const ratingState = await getAgentRatingState(user.id);
    const starRating = ratingState.stars;

    const now = Date.now();
    const ninetyDaysAgo = new Date(now - 90 * 24 * 60 * 60 * 1000);
    const [recentRatingsRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(agent_ratings)
      .where(and(eq(agent_ratings.to_agent_id, user.id), gte(agent_ratings.created_at, ninetyDaysAgo)));

    const trust = computeTrustScore({
      likes: ratingState.likes,
      dislikes: ratingState.dislikes,
      effectiveDislikes: ratingState.effectiveDislikes,
      totalRatings: stats?.total_ratings || 0,
      completedTrades: stats?.completed_trades_as_seller || 0,
      disputedTrades: stats?.disputed_trades_as_seller || 0,
      accountAgeDays: Math.floor((now - new Date(user.created_at as any).getTime()) / (1000 * 60 * 60 * 24)),
      recentRatings90d: recentRatingsRow?.count || 0,
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
          average_rating: starRating,
          total_ratings: stats?.total_ratings || 0,
          likes: ratingState.likes,
          dislikes: ratingState.dislikes,
          effective_dislikes: ratingState.effectiveDislikes,
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
