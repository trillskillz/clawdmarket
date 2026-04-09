import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { listings } from '@/lib/schema';
import { authenticateRequest } from '@/lib/auth';
import { createListingSchema, listingsQuerySchema, sanitizeHtml } from '@/lib/validation';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import { validateCsrf } from '@/lib/csrf';
import { eq, and, desc, sql } from 'drizzle-orm';
import { users } from '@/lib/schema';
import { FALLBACK_LISTINGS } from '@/lib/marketplace-fallback';
import { fallbackAgentForListingId } from '@/lib/fallback-agents';

export const dynamic = 'force-dynamic'

function isMissingColumnError(error: any, column: string) {
  const msg = String(error?.message || error || '').toLowerCase();
  return msg.includes('no column named') && msg.includes(column.toLowerCase());
}

function getSortOrder(sort?: string) {
  switch (sort) {
    case 'price_asc': return sql`${listings.price_bankr} ASC`;
    case 'price_desc': return sql`${listings.price_bankr} DESC`;
    default: return sql`${listings.created_at} DESC`;
  }
}

async function selectListings(whereClause: any, limit: number, offset: number, sort?: string) {
  try {
    const rows = await db
      .select({
        id: listings.id,
        seller_id: listings.seller_id,
        seller_name: users.name,
        seller_role: users.role,
        seller_avatar_url: users.avatar_url,
        seller_avatar_emoji: users.avatar_emoji,
        seller_avg_rating: sql<number>`COALESCE((SELECT ROUND(AVG(r.score), 2) FROM ratings r WHERE r.rated_id = ${listings.seller_id}), 0)`,
        seller_rating_count: sql<number>`COALESCE((SELECT COUNT(*) FROM ratings r WHERE r.rated_id = ${listings.seller_id}), 0)`,
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

    // Legacy column check logic might need adjustment if leftJoin affects it, 
    // but usually keys are checked on the result or error.
    // Assuming simple success path first.
    return rows;
  } catch (error) {
    if (!isMissingColumnError(error, 'price_bankr')) throw error;
  }

  // Fallback for legacy column names (omitted for brevity in this patch, assuming main path works or simple fallback)
  // Re-implementing fallback with join:
  try {
    return await db
      .select({
        id: listings.id,
        seller_id: listings.seller_id,
        seller_name: users.name,
        seller_role: users.role,
        seller_avatar_url: users.avatar_url,
        seller_avatar_emoji: users.avatar_emoji,
        category: listings.category,
        title: listings.title,
        description: listings.description,
        price_bankr: sql<number>`CAST(${sql.raw('price_clawd')} AS REAL)`,
        status: listings.status,
        created_at: listings.created_at,
      })
      .from(listings)
      .leftJoin(users, eq(listings.seller_id, users.id))
      .where(whereClause)
      .orderBy(desc(listings.created_at))
      .limit(limit)
      .offset(offset);
  } catch (legacyError) {
     if (!isMissingColumnError(legacyError, 'price_clawd')) throw legacyError;
     
     return await db
      .select({
        id: listings.id,
        seller_id: listings.seller_id,
        seller_name: users.name,
        seller_role: users.role,
        seller_avatar_url: users.avatar_url,
        seller_avatar_emoji: users.avatar_emoji,
        category: listings.category,
        title: listings.title,
        description: listings.description,
        price_bankr: sql<number>`CAST(${sql.raw('price')} AS REAL)`,
        status: listings.status,
        created_at: listings.created_at,
      })
      .from(listings)
      .leftJoin(users, eq(listings.seller_id, users.id))
      .where(whereClause)
      .orderBy(desc(listings.created_at))
      .limit(limit)
      .offset(offset);
  }
}

async function insertListing(values: {
  seller_id: string;
  category: 'compute' | 'skills' | 'data' | 'code' | 'analysis' | 'bounties' | 'other';
  title: string;
  description: string;
  price_bankr: number;
}) {
  try {
    const [row] = await db
      .insert(listings)
      .values(values)
      .returning();
    return row;
  } catch (error) {
    if (!isMissingColumnError(error, 'price_bankr')) throw error;

    const id = crypto.randomUUID();

    try {
      await (db as any).$client.execute({
        sql: 'INSERT INTO listings (id, seller_id, category, title, description, price_clawd, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        args: [id, values.seller_id, values.category, values.title, values.description, values.price_bankr, 'active', new Date().toISOString()],
      });
    } catch (legacyError) {
      if (!isMissingColumnError(legacyError, 'price_clawd')) throw legacyError;

      await (db as any).$client.execute({
        sql: 'INSERT INTO listings (id, seller_id, category, title, description, price, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        args: [id, values.seller_id, values.category, values.title, values.description, values.price_bankr, 'active', new Date().toISOString()],
      });
    }

    const [row] = await db.select().from(listings).where(eq(listings.id, id)).limit(1);
    return row;
  }
}

export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || req.headers.get('cf-connecting-ip') || 'unknown';
  const userAgent = req.headers.get('user-agent') || 'unknown';
  const rateKey = `listings-get:${ip}:${userAgent.slice(0, 80)}`;
  const rateLimitResult = rateLimit(rateKey, { interval: 60 * 1000, maxRequests: 1000 });

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

    let conditions = [];
    
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
        sql`(LOWER(${listings.title}) LIKE ${term} OR LOWER(${listings.description}) LIKE ${term})`
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
    
    const totalCount = countResult?.count || 0;

    const results = await selectListings(whereClause, query.limit, (query.page - 1) * query.limit, query.sort);

    const normalizedResults = results.map((listing: any) => ({
      ...listing,
      price_bankr: Number.isFinite(Number(listing.price_bankr))
        ? Number(listing.price_bankr)
        : 0,
    }));

    return NextResponse.json({
      listings: normalizedResults,
      page: query.page,
      limit: query.limit,
      total: totalCount,
    });
  } catch (error: any) {
    if (error.errors) {
      return NextResponse.json(
        { error: 'Validation failed', details: error.errors },
        { status: 400 }
      );
    }
    console.error('Listings fetch error:', error);

    const fallbackRows = FALLBACK_LISTINGS.slice(0, 50).map((l) => {
      const agent = fallbackAgentForListingId(l.id);
      return {
        ...l,
        seller_id: agent.id,
        seller_name: agent.name,
        seller_role: 'agent',
        seller_avatar_url: agent.avatar_url,
        seller_avatar_emoji: null,
        seller_bio: agent.bio,
        status: 'active',
        created_at: new Date().toISOString(),
      };
    });

    return NextResponse.json({
      listings: fallbackRows,
      page: 1,
      limit: 50,
      total: fallbackRows.length,
      fallback: true,
    });
  }
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('auth-token')?.value;
  const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));

  if (!auth) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  // Validate CSRF for cookie-based auth (not for API keys)
  if (!authHeader && !validateCsrf(req)) {
    return NextResponse.json(
      { error: 'CSRF validation failed' },
      { status: 403 }
    );
  }

  const rateLimitResult = rateLimit(`create-listing:${auth.userId}`, { 
    interval: 60 * 1000, 
    maxRequests: 10 
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
          const sanitizedTitle = sanitizeHtml(validated.title);
          const sanitizedDescription = sanitizeHtml(validated.description);

          const newListing = await insertListing({
            seller_id: auth.userId,
            category: validated.category,
            title: sanitizedTitle,
            description: sanitizedDescription,
            price_bankr: validated.price_bankr,
          });

          results.push({ index: i, success: true, listing: newListing });
        } catch (error: any) {
          errors.push({ index: i, success: false, error: error.message || 'Validation failed' });
        }
      }

      return NextResponse.json(
        {
          message: `Created ${results.length} of ${body.length} listings`,
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

    // Sanitize text inputs
    const sanitizedTitle = sanitizeHtml(validated.title);
    const sanitizedDescription = sanitizeHtml(validated.description);

    const newListing = await insertListing({
      seller_id: auth.userId,
      category: validated.category,
      title: sanitizedTitle,
      description: sanitizedDescription,
      price_bankr: validated.price_bankr,
    });

    return NextResponse.json(
      {
        message: 'Listing created successfully',
        listing: newListing,
      },
      { 
        status: 201,
        headers: getRateLimitHeaders(rateLimitResult),
      }
    );
  } catch (error: any) {
    if (error.errors) {
      return NextResponse.json(
        { error: 'Validation failed', details: error.errors },
        { status: 400 }
      );
    }
    console.error('Listing creation error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
