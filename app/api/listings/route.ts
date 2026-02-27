import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { listings } from '@/lib/schema';
import { authenticateRequest } from '@/lib/auth';
import { createListingSchema, listingsQuerySchema, sanitizeHtml } from '@/lib/validation';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import { validateCsrf } from '@/lib/csrf';
import { eq, and, desc, sql } from 'drizzle-orm';

async function hasPriceBankrColumn() {
  try {
    const columns = await (db as any).$client.execute('PRAGMA table_info(listings)');
    const values = (columns.rows as any[]).flatMap((r) => Object.values(r).map((v) => String(v)));

    if (values.includes('price_bankr')) return true;
    if (values.includes('price')) return false;

    // Default to modern schema when detection is inconclusive
    return true;
  } catch {
    return true;
  }
}

export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
  const rateLimitResult = rateLimit(`listings-get:${ip}`, { interval: 60 * 1000, maxRequests: 60 });

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

    // Get paginated results (compat with legacy schema that used `price` instead of `price_bankr`)
    const hasPriceBankr = await hasPriceBankrColumn();
    const results = await db
      .select({
        id: listings.id,
        seller_id: listings.seller_id,
        category: listings.category,
        title: listings.title,
        description: listings.description,
        price_bankr: hasPriceBankr ? listings.price_bankr : sql<number>`price`,
        status: listings.status,
        created_at: listings.created_at,
      })
      .from(listings)
      .where(whereClause)
      .orderBy(desc(listings.created_at))
      .limit(query.limit)
      .offset((query.page - 1) * query.limit);

    return NextResponse.json({
      listings: results,
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
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
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

      const hasPriceBankr = await hasPriceBankrColumn();

      for (let i = 0; i < body.length; i++) {
        try {
          const validated = createListingSchema.parse(body[i]);
          const sanitizedTitle = sanitizeHtml(validated.title);
          const sanitizedDescription = sanitizeHtml(validated.description);

          let newListing: any;

          if (hasPriceBankr) {
            [newListing] = await db
              .insert(listings)
              .values({
                seller_id: auth.userId,
                category: validated.category,
                title: sanitizedTitle,
                description: sanitizedDescription,
                price_bankr: validated.price_bankr,
              })
              .returning();
          } else {
            const id = crypto.randomUUID();
            await (db as any).$client.execute({
              sql: 'INSERT INTO listings (id, seller_id, category, title, description, price, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
              args: [id, auth.userId, validated.category, sanitizedTitle, sanitizedDescription, validated.price_bankr, 'active', new Date().toISOString()],
            });
            [newListing] = await db.select().from(listings).where(eq(listings.id, id)).limit(1);
          }

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

    const hasPriceBankr = await hasPriceBankrColumn();

    // Create listing
    let newListing: any;
    if (hasPriceBankr) {
      [newListing] = await db
        .insert(listings)
        .values({
          seller_id: auth.userId,
          category: validated.category,
          title: sanitizedTitle,
          description: sanitizedDescription,
          price_bankr: validated.price_bankr,
        })
        .returning();
    } else {
      const id = crypto.randomUUID();
      await (db as any).$client.execute({
        sql: 'INSERT INTO listings (id, seller_id, category, title, description, price, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        args: [id, auth.userId, validated.category, sanitizedTitle, sanitizedDescription, validated.price_bankr, 'active', new Date().toISOString()],
      });
      [newListing] = await db.select().from(listings).where(eq(listings.id, id)).limit(1);
    }

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
