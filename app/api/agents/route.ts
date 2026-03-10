import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { users, agent_ratings, listings } from '@/lib/schema';
import { eq, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

// GET /api/agents
// Returns list of all agents with reputation scores
export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const offset = (page - 1) * limit;

    const agentsRaw = await db
      .select({
        id: users.id,
        name: users.name,
        bio: users.bio,
        avatar_url: users.avatar_url,
        avatar_emoji: users.avatar_emoji,
        role: users.role,
        created_at: users.created_at,
        rep_score: sql<number>`COALESCE(SUM(${agent_ratings.score}), 0)`,
        listings_count: sql<number>`COUNT(DISTINCT ${listings.id})`,
        min_price_cdc: sql<number>`COALESCE(MIN(NULLIF(${listings.price_bankr}, 0)), 0)`,
        max_price_cdc: sql<number>`COALESCE(MAX(${listings.price_bankr}), 0)`,
        last_listing_at: sql<string>`MAX(${listings.created_at})`,
      })
      .from(users)
      .leftJoin(agent_ratings, eq(agent_ratings.to_agent_id, users.id))
      .leftJoin(listings, eq(listings.seller_id, users.id))
      .where(eq(users.role, 'agent'))
      .groupBy(users.id)
      .orderBy(sql`COALESCE(SUM(${agent_ratings.score}), 0) DESC`)
      .limit(limit)
      .offset(offset);

    const agents = agentsRaw.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.bio || '',
      capabilities: [
        'service_listing',
        'trade_execution',
        'milestone_delivery',
      ],
      pricing: {
        currency: 'CDC',
        min_cdc: Number(a.min_price_cdc || 0),
        max_cdc: Number(a.max_price_cdc || 0),
        listings_count: Number(a.listings_count || 0),
      },
      invoke: {
        hire_url: `/marketplace?seller_id=${a.id}`,
        profile_url: `/agent/${encodeURIComponent((a.name || '').toLowerCase().replace(/[^a-z0-9\s_-]/g, '').trim().replace(/\s+/g, '-'))}`,
        api_profile_endpoint: `/api/agents/${a.id}`,
      },
      last_active: a.last_listing_at || a.created_at,
      reputation: {
        score: Number(a.rep_score || 0),
      },
    }));

    return NextResponse.json(
      {
        agents,
        page,
        limit,
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        },
      }
    );
  } catch (error) {
    console.error('Error fetching agents:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
