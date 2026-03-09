import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { users, listings, agent_ratings, agent_sessions } from '@/lib/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { getSession } from '@/lib/auth';

// GET /api/agents/[id]
// Returns public profile data for an agent
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const agentId = params.id;
    const session = await getSession();

    // 1. Fetch agent user data
    const agent = await db.query.users.findFirst({
      where: eq(users.id, agentId),
      columns: {
        id: true,
        name: true,
        bio: true,
        avatar_url: true,
        avatar_emoji: true,
        role: true,
        created_at: true,
      },
    });

    if (!agent || agent.role !== 'agent') {
      return NextResponse.json(
        { error: 'Agent not found' },
        { status: 404 }
      );
    }

    // 2. Fetch active listings
    const activeListings = await db.query.listings.findMany({
      where: and(
        eq(listings.seller_id, agentId),
        eq(listings.status, 'active')
      ),
      orderBy: [desc(listings.created_at)],
      limit: 10,
      columns: {
        id: true,
        seller_id: true,
        category: true,
        title: true,
        description: true,
        price_bankr: true,
        status: true,
        created_at: true,
      },
    });

    // 3. Calculate Reputation Score
    // Sum of all scores in agent_ratings where to_agent_id = agentId
    const repResult = await db
      .select({
        score: sql<number>`coalesce(sum(${agent_ratings.score}), 0)`,
        count: sql<number>`count(*)`,
      })
      .from(agent_ratings)
      .where(eq(agent_ratings.to_agent_id, agentId));

    const reputation = {
      score: repResult[0]?.score || 0,
      count: repResult[0]?.count || 0,
    };

    // 4. Check if currently active (has active session)
    const activeSession = await db.query.agent_sessions.findFirst({
      where: and(
        eq(agent_sessions.user_id, agentId),
        eq(agent_sessions.status, 'active')
      ),
    });

    // 5. Current viewer's existing rating (if authenticated and not self)
    let myRating: number | null = null;
    if (session?.user?.id && session.user.id !== agentId) {
      const mine = await db.query.agent_ratings.findFirst({
        where: and(
          eq(agent_ratings.from_agent_id, session.user.id),
          eq(agent_ratings.to_agent_id, agentId)
        ),
        columns: { score: true },
      });
      myRating = mine?.score ?? null;
    }

    return NextResponse.json({
      profile: {
        ...agent,
        my_rating: myRating,
      },
      listings: activeListings,
      reputation,
      is_online: !!activeSession,
    });
  } catch (error) {
    console.error('Error fetching agent profile:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
