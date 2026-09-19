import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { listings } from '@/lib/schema';
import { authenticateRequest } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { createListingSchema, listingsQuerySchema } from '@/lib/validation';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import { validateCsrf } from '@/lib/csrf';
import { eq, and, sql } from 'drizzle-orm';
import { users } from '@/lib/schema';
import { ensureSyntheticAgentUser, resolveRegisteredAgentRequest } from '@/lib/registered-agent-auth';
import { loadAgentTrustMap } from '@/lib/agent-trust';
import { getRequestIp } from '@/lib/request-ip';
import { internalErrorResponse } from '@/lib/api-error';
import { isAddress } from 'viem';
import { getAgentAvailability } from '@/lib/agent-presence';

export const dynamic = 'force-dynamic'

function getSortOrder(sort?: string) {
  switch (sort) {
    case 'price_asc': return sql`${listings.price_bankr} ASC`;
    case 'price_desc': return sql`${listings.price_bankr} DESC`;
    case 'trust_desc': return sql`
      COALESCE((SELECT AVG(CAST(r.score AS REAL)) FROM ratings r WHERE r.rated_id = ${listings.seller_id}), 0) DESC,
      COALESCE((SELECT COUNT(*) FROM ratings r WHERE r.rated_id = ${listings.seller_id}), 0) DESC,
      ${listings.created_at} DESC`;
    case 'recommended': return sql`
      COALESCE((SELECT COUNT(*) FROM trades t WHERE t.seller_id = ${listings.seller_id} AND t.status IN ('completed', 'complete')), 0) DESC,
      COALESCE((SELECT COUNT(*) FROM ratings r WHERE r.rated_id = ${listings.seller_id}), 0) DESC,
      COALESCE((SELECT AVG(CAST(r.score AS REAL)) FROM ratings r WHERE r.rated_id = ${listings.seller_id}), 0) DESC,
      ${listings.created_at} DESC`;
    default: return sql`${listings.created_at} DESC`;
  }
}

async function selectListings(whereClause: any, limit: number, offset: number, sort?: string) {
  return db
    .select({
      id: listings.id,
      seller_id: listings.seller_id,
      seller_name: users.name,
      seller_role: users.role,
      seller_avatar_url: users.avatar_url,
      seller_avatar_emoji: users.avatar_emoji,
      seller_avg_rating: sql<number>`COALESCE((SELECT ROUND(AVG(r.score), 2) FROM ratings r WHERE r.rated_id = ${listings.seller_id}), 0)`,
      seller_rating_count: sql<number>`COALESCE((SELECT COUNT(*) FROM ratings r WHERE r.rated_id = ${listings.seller_id}), 0)`,
      agent_id: sql<string>`COALESCE((SELECT a.id FROM agents a WHERE ('user_agent_' || a.id) = ${listings.seller_id} LIMIT 1), ${listings.seller_id})`,
      agent_created_at: sql<string | number | null>`COALESCE((SELECT a.created_at FROM agents a WHERE ('user_agent_' || a.id) = ${listings.seller_id} LIMIT 1), ${users.created_at})`,
      agent_capabilities: sql<string>`COALESCE((SELECT a.capabilities FROM agents a WHERE ('user_agent_' || a.id) = ${listings.seller_id} LIMIT 1), '[]')`,
      seller_status: sql<string | null>`(SELECT a.status FROM agents a WHERE ('user_agent_' || a.id) = ${listings.seller_id} LIMIT 1)`,
      seller_last_seen_at: sql<number | null>`(SELECT a.last_seen_at FROM agents a WHERE ('user_agent_' || a.id) = ${listings.seller_id} LIMIT 1)`,
      seller_payout_address: sql<string | null>`COALESCE(
        (SELECT p.address FROM payout_addresses p WHERE p.user_id = ${listings.seller_id} LIMIT 1),
        CASE WHEN ${users.email} LIKE 'wallet_0x%@wallet.local' THEN SUBSTR(${users.email}, 8, 42) ELSE NULL END,
        (SELECT a.owner_address FROM agents a WHERE ('user_agent_' || a.id) = ${listings.seller_id} LIMIT 1)
      )`,
      completed_trades: sql<number>`COALESCE((SELECT COUNT(*) FROM trades t WHERE t.seller_id = ${listings.seller_id} AND t.status IN ('completed', 'complete')), 0)`,
      category: listings.category,
      title: listings.title,
      description: listings.description,
      price_bankr: listings.price_bankr,
      status: listings.status,
      created_at: listings.created_at,
    })
    .from(listings)
    .leftJoin(users, eq(listings.seller_id, users.id))
    .where(whereClause)
    .orderBy(getSortOrder(sort))
    .limit(limit)
    .offset(offset);
}

async function insertListing(values: {
  seller_id: string;
  category: 'compute' | 'skills' | 'data' | 'code' | 'analysis' | 'bounties' | 'other';
  title: string;
  description: string;
  price_bankr: number;
}) {
  const [row] = await db
    .insert(listings)
    .values(values)
    .returning();
  return row;
}

export async function GET(req: NextRequest) {
  const ip = getRequestIp(req);
  const userAgent = req.headers.get('user-agent') || 'unknown';
  const rateKey = `listings-get:${ip}:${userAgent.slice(0, 80)}`;
  const rateLimitResult = await rateLimit(rateKey, { interval: 60 * 1000, maxRequests: 1000 });

  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      { status: 429, headers: getRateLimitHeaders(rateLimitResult) }
    );
  }

  const searchParams = req.nextUrl.searchParams;
  
  try {
    const query = listingsQuerySchema.parse({
      category: searchParams.get('category') || undefined,
      status: searchParams.get('status') || undefined,
      page: searchParams.get('page') || '1',
      limit: searchParams.get('limit') || '20',
      search: searchParams.get('search') || undefined,
      seller_id: searchParams.get('seller_id') || undefined,
      seller: searchParams.get('seller') || undefined,
      min_price: searchParams.get('min_price') || undefined,
      max_price: searchParams.get('max_price') || undefined,
      sort: searchParams.get('sort') || undefined,
    });

    const conditions = [];
    conditions.push(sql`NOT EXISTS (
      SELECT 1 FROM agents hidden_agent
      WHERE ('user_agent_' || hidden_agent.id) = ${listings.seller_id}
        AND (hidden_agent.visibility <> 'public' OR hidden_agent.archived_at IS NOT NULL)
    )`);
    
    if (query.category) {
      conditions.push(eq(listings.category, query.category));
    }
    
    if (query.status) {
      conditions.push(eq(listings.status, query.status));
    } else {
      conditions.push(eq(listings.status, 'active'));
    }

    // Handle search query
    if (query.search) {
      const term = `%${query.search.toLowerCase()}%`;
      conditions.push(
        sql`(
          LOWER(${listings.title}) LIKE ${term}
          OR LOWER(${listings.description}) LIKE ${term}
          OR LOWER(${listings.category}) LIKE ${term}
          OR LOWER(COALESCE((SELECT u.name FROM users u WHERE u.id = ${listings.seller_id} LIMIT 1), '')) LIKE ${term}
          OR LOWER(COALESCE((SELECT a.capabilities FROM agents a WHERE ('user_agent_' || a.id) = ${listings.seller_id} LIMIT 1), '')) LIKE ${term}
        )`
      );
    }

    // Handle price range
    if (query.min_price !== undefined) {
      conditions.push(sql`${listings.price_bankr} >= ${query.min_price}`);
    }
    if (query.max_price !== undefined) {
      conditions.push(sql`${listings.price_bankr} <= ${query.max_price}`);
    }

    // Handle seller query
    if (query.seller === 'me') {
      const authHeader = req.headers.get('authorization');
      const cookieToken = req.cookies.get('auth-token')?.value;
      const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));
      
      if (!auth) {
        return NextResponse.json(
          { error: 'Authentication required for seller=me' },
          { status: 401 }
        );
      }
      
      conditions.push(eq(listings.seller_id, auth.userId));
    } else if (query.seller_id) {
      conditions.push(eq(listings.seller_id, query.seller_id));
    }

    // Apply conditions
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Get total count
    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(listings)
      .where(whereClause);
    
    const totalCount = Number(countResult?.count || 0);

    const results = await selectListings(whereClause, query.limit, (query.page - 1) * query.limit, query.sort);

    const trustInputs = [...new Map(results.map((listing: any) => [String(listing.agent_id), {
      id: String(listing.agent_id),
      created_at: listing.agent_created_at,
      avg_rating: listing.seller_avg_rating,
      rating_count: listing.seller_rating_count,
    }])).values()];
    const trustMap = await loadAgentTrustMap(trustInputs);
    const normalizedResults = results.map((listing: any) => {
      const {
        agent_created_at: _agentCreatedAt,
        seller_status: sellerStatus,
        seller_last_seen_at: sellerLastSeenAt,
        seller_payout_address: sellerPayoutAddress,
        ...publicListing
      } = listing;
      const trust = trustMap.get(String(listing.agent_id));
      const sellerAvailability = listing.seller_role === 'agent' && sellerStatus
        ? getAgentAvailability(sellerStatus, sellerLastSeenAt)
        : null;
      return {
        ...publicListing,
        price_bankr: Number.isFinite(Number(listing.price_bankr))
          ? Number(listing.price_bankr)
          : 0,
        agent_trust: trust?.trustScore ?? 0,
        agent_trust_confidence: trust?.confidence ?? 'low',
        agent_trust_drivers: trust?.drivers ?? ['No verified marketplace activity'],
        external_payment_ready: Boolean(sellerPayoutAddress && isAddress(sellerPayoutAddress)),
        seller_online: sellerAvailability === null ? null : sellerAvailability === 'online',
        seller_availability: sellerAvailability,
        seller_last_seen_at: sellerLastSeenAt || null,
      };
    });

    return NextResponse.json({
      listings: normalizedResults,
      page: query.page,
      limit: query.limit,
      total: totalCount,
      total_pages: Math.ceil(totalCount / query.limit),
      has_more: query.page * query.limit < totalCount,
    });
  } catch (error: any) {
    const issues = error?.issues || error?.errors;
    if (issues) {
      return NextResponse.json(
        { error: 'Validation failed', details: issues },
        { status: 400 }
      );
    }
    const response = internalErrorResponse('Listings fetch failed', error, {
      code: 'catalog_temporarily_unavailable',
      message: 'The live service catalog is temporarily unavailable. Please retry shortly.',
      status: 503,
    });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('auth-token')?.value;
  const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));
  let sellerId = auth?.userId || '';
  let sellerAgentId: string | null = null;

  if (!auth) {
    const agentAuth = await resolveRegisteredAgentRequest(req);
    if (agentAuth.kind !== 'agent') {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    await ensureSyntheticAgentUser(agentAuth);
    sellerId = agentAuth.syntheticUserId;
    sellerAgentId = agentAuth.agentId;
  }

  // Validate CSRF for cookie-based auth (not for API keys)
  if (auth && !authHeader && !validateCsrf(req)) {
    return NextResponse.json(
      { error: 'CSRF validation failed' },
      { status: 403 }
    );
  }

  const rateLimitResult = await rateLimit(`create-listing:${sellerId}`, {
    interval: 60 * 1000, 
    maxRequests: 10,
    failClosed: true,
  });

  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: 'Too many listing creation attempts. Please try again later.' },
      { 
        status: 429,
        headers: getRateLimitHeaders(rateLimitResult),
      }
    );
  }

  try {
    const body = await req.json();

    // Support bulk creation (array of listings)
    if (Array.isArray(body)) {
      if (body.length > 50) {
        return NextResponse.json(
          { error: 'Bulk creation limited to 50 listings per request' },
          { status: 400 }
        );
      }

      const results = [];
      const errors = [];

      for (let i = 0; i < body.length; i++) {
        try {
          const validated = createListingSchema.parse(body[i]);
          const newListing = await insertListing({
            seller_id: sellerId,
            category: validated.category,
            title: validated.title,
            description: validated.description,
            price_bankr: validated.price_bankr,
          });

          results.push({ index: i, success: true, listing: newListing });
        } catch {
          errors.push({ index: i, success: false, error: 'Listing could not be created' });
        }
      }

      return NextResponse.json(
        {
          message: `Created ${results.length} of ${body.length} listings`,
          ...(sellerAgentId ? { seller_agent_id: sellerAgentId } : {}),
          results,
          errors,
        },
        { 
          status: 201,
          headers: getRateLimitHeaders(rateLimitResult),
        }
      );
    }

    // Single listing creation
    const validated = createListingSchema.parse(body);

    const newListing = await insertListing({
      seller_id: sellerId,
      category: validated.category,
      title: validated.title,
      description: validated.description,
      price_bankr: validated.price_bankr,
    });

    return NextResponse.json(
      {
        message: 'Listing created successfully',
        ...(sellerAgentId ? { seller_agent_id: sellerAgentId } : {}),
        listing: newListing,
      },
      { 
        status: 201,
        headers: getRateLimitHeaders(rateLimitResult),
      }
    );
  } catch (error: any) {
    const issues = error?.issues || error?.errors;
    if (issues) {
      return NextResponse.json(
        { error: 'Validation failed', details: issues },
        { status: 400 }
      );
    }
    logger.error('Listing creation error', { err: String(error) });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
