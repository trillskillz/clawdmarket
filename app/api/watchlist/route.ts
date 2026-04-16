import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { getRateLimitHeaders, rateLimit } from '@/lib/rate-limit';
import { validateCsrf } from '@/lib/csrf';
import { listings, watchlist } from '@/lib/schema';
import { watchlistItemSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic'

async function getAuthedUser(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('auth-token')?.value;
  return authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));
}

async function ensureWatchlistTable() {
  await (db as any).$client.execute({
    sql: `CREATE TABLE IF NOT EXISTS watchlist (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      listing_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(listing_id) REFERENCES listings(id) ON DELETE CASCADE
    )`,
    args: [],
  });
}

export async function GET(req: NextRequest) {
  await ensureWatchlistTable();
  const auth = await getAuthedUser(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rows = await db
    .select({ listing_id: watchlist.listing_id })
    .from(watchlist)
    .where(eq(watchlist.user_id, auth.userId));

  return NextResponse.json({ listing_ids: rows.map((r) => r.listing_id) });
}

export async function POST(req: NextRequest) {
  await ensureWatchlistTable();
  const auth = await getAuthedUser(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!req.headers.get('authorization') && !validateCsrf(req)) {
    return NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 });
  }

  const limit = await rateLimit(`watchlist-add:${auth.userId}`, { interval: 60 * 1000, maxRequests: 30 });
  if (!limit.success) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: getRateLimitHeaders(limit) });
  }

  try {
    const body = await req.json();
    const { listing_id } = watchlistItemSchema.parse(body);

    const [listing] = await db.select({ id: listings.id }).from(listings).where(eq(listings.id, listing_id)).limit(1);
    if (!listing) return NextResponse.json({ error: 'Listing not found' }, { status: 404 });

    const [existing] = await db
      .select({ id: watchlist.id })
      .from(watchlist)
      .where(and(eq(watchlist.user_id, auth.userId), eq(watchlist.listing_id, listing_id)))
      .limit(1);

    if (!existing) {
      await db.insert(watchlist).values({ user_id: auth.userId, listing_id });
    }

    return NextResponse.json({ success: true }, { headers: getRateLimitHeaders(limit) });
  } catch (error: any) {
    if (error?.errors) return NextResponse.json({ error: 'Validation failed', details: error.errors }, { status: 400 });
    console.error('Watchlist add error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  await ensureWatchlistTable();
  const auth = await getAuthedUser(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!req.headers.get('authorization') && !validateCsrf(req)) {
    return NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 });
  }

  const limit = await rateLimit(`watchlist-remove:${auth.userId}`, { interval: 60 * 1000, maxRequests: 30 });
  if (!limit.success) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: getRateLimitHeaders(limit) });
  }

  try {
    const body = await req.json();
    const { listing_id } = watchlistItemSchema.parse(body);

    await db
      .delete(watchlist)
      .where(and(eq(watchlist.user_id, auth.userId), eq(watchlist.listing_id, listing_id)));

    return NextResponse.json({ success: true }, { headers: getRateLimitHeaders(limit) });
  } catch (error: any) {
    if (error?.errors) return NextResponse.json({ error: 'Validation failed', details: error.errors }, { status: 400 });
    console.error('Watchlist remove error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
