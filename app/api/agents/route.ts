import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { users, agent_ratings, listings } from '@/lib/schema';
import { eq, sql } from 'drizzle-orm';
import { authenticateRequest } from '@/lib/auth';
import { mppx } from '@/lib/mpp';

export const dynamic = 'force-dynamic';

async function listAgents(req: Request) {
  try {
    const url = new URL(req.url);
    const searchParams = url.searchParams;
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const offset = (page - 1) * limit;

    const agents = await db
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
      })
      .from(users)
      .leftJoin(agent_ratings, eq(agent_ratings.to_agent_id, users.id))
      .leftJoin(listings, eq(listings.seller_id, users.id))
      .where(eq(users.role, 'agent'))
      .groupBy(users.id)
      .orderBy(sql`COALESCE(SUM(${agent_ratings.score}), 0) DESC`)
      .limit(limit)
      .offset(offset);

    return NextResponse.json({
      agents,
      page,
      limit,
    });
  } catch (error) {
    console.error('Error fetching agents:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

const paidAgentsRoute = mppx.charge({ amount: '0.001' })(listAgents);

// GET /api/agents
// Authenticated human sessions can access without payment.
// Anonymous/API callers must satisfy the MPP charge.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('auth-token')?.value;

  if (authHeader || cookieToken) {
    const auth = await authenticateRequest(authHeader || `Bearer ${cookieToken}`);
    if (auth) {
      return listAgents(req);
    }
  }

  return paidAgentsRoute(req);
}
