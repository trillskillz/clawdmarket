import { randomBytes } from 'node:crypto';
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
        avg_rating: sql<number>`COALESCE(ROUND((SELECT AVG(r.score) FROM ratings r WHERE r.rated_id = ${users.id}), 2), 0)`,
        rating_count: sql<number>`COALESCE((SELECT COUNT(*) FROM ratings r WHERE r.rated_id = ${users.id}), 0)`,
        listings_count: sql<number>`COUNT(DISTINCT ${listings.id})`,
      })
      .from(users)
      .leftJoin(agent_ratings, eq(agent_ratings.to_agent_id, users.id))
      .leftJoin(listings, eq(listings.seller_id, users.id))
      .where(
        sql`${users.role} = 'agent'
          AND ${users.name} NOT LIKE '%Seed%'
          AND ${users.name} NOT LIKE '%Seeder%'
          AND ${users.name} NOT LIKE 'API Agent%'
          AND ${users.name} NOT LIKE 'Test%'
          AND NOT (${users.id} LIKE 'agent_%' AND ${users.id} NOT IN ('agent_clawdmarket_system') AND REPLACE(REPLACE(${users.id}, 'agent_', ''), '_', '') GLOB '[0-9]*')
          AND (${users.bio} IS NOT NULL AND LENGTH(${users.bio}) > 50)`
      )
      .groupBy(users.id)
      .orderBy(sql`COALESCE((SELECT AVG(r.score) FROM ratings r WHERE r.rated_id = ${users.id}), 0) DESC, COALESCE((SELECT COUNT(*) FROM ratings r WHERE r.rated_id = ${users.id}), 0) DESC`)
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

function paidAgentsRoute(req: NextRequest) {
  return mppx.session({ amount: '0.001', unitType: 'request' })(listAgents)(req);
}

function x402Challenge(req: NextRequest) {
  const usdc = (process.env.X402_TOKEN_ADDRESS || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913').toLowerCase(); // USDC on Base
  const id = randomBytes(16).toString('base64url');
  const recipient = process.env.DEV_FEE_WALLET_ADDRESS || process.env.MPP_RECIPIENT_ADDRESS || null;
  const request = Buffer.from(
    JSON.stringify({
      amount: '1000', // $0.001 in 6-decimal USDC
      currency: usdc,
      methodDetails: {
        supportedChains: [8453, 137, 43114, 1329, 1482601649], // Base, Polygon, Avalanche, Sei, SKALE
        preferredChain: 8453,
      },
      recipient,
    }),
  ).toString('base64url');

  return NextResponse.json(
    {
      type: 'https://x402.org',
      title: 'Payment Required',
      status: 402,
      detail: 'x402 payment required for /api/agents — chain-agnostic, supports Base, Polygon, Avalanche, Solana, Stellar, Aptos',
    },
    {
      status: 402,
      headers: {
        'WWW-Authenticate': `Payment id="${id}", realm="${req.nextUrl.host}", method="x402", intent="charge", request="${request}"`,
      },
    },
  );
}

// GET /api/agents
// Authenticated human sessions can access without payment.
// Anonymous/API callers must satisfy the MPP charge.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('auth-token')?.value;
  const paymentMethodHint = (req.headers.get('x-payment-method') || '').toLowerCase();

  if (authHeader || cookieToken) {
    const auth = await authenticateRequest(authHeader || `Bearer ${cookieToken}`);
    if (auth) {
      return listAgents(req);
    }
  }

  if (paymentMethodHint === 'x402') {
    if (!authHeader) return x402Challenge(req);
    return listAgents(req);
  }

  return paidAgentsRoute(req);
}
