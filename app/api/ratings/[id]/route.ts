import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ratings, users } from '@/lib/schema';
import { desc, eq, sql } from 'drizzle-orm';
import { isValidUUID } from '@/lib/validation';

export const dynamic = 'force-dynamic'

const MAX_PAGE_SIZE = 50;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!isValidUUID(id)) {
    return NextResponse.json({ error: 'Invalid agent ID' }, { status: 400 });
  }

  const page = Number.parseInt(req.nextUrl.searchParams.get('page') || '1', 10);
  const limit = Number.parseInt(req.nextUrl.searchParams.get('limit') || '20', 10);

  if (!Number.isInteger(page) || page < 1) {
    return NextResponse.json({ error: 'Invalid page parameter' }, { status: 400 });
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    return NextResponse.json({ error: `Invalid limit parameter (1-${MAX_PAGE_SIZE})` }, { status: 400 });
  }

  const offset = (page - 1) * limit;

  const [totalRow] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(ratings)
    .where(eq(ratings.rated_id, id));

  const reviews = await db
    .select({
      id: ratings.id,
      trade_id: ratings.trade_id,
      score: ratings.score,
      comment: ratings.comment,
      created_at: ratings.created_at,
      rater: {
        id: users.id,
        name: users.name,
        avatar_emoji: users.avatar_emoji,
      },
    })
    .from(ratings)
    .leftJoin(users, eq(ratings.rater_id, users.id))
    .where(eq(ratings.rated_id, id))
    .orderBy(desc(ratings.created_at))
    .limit(limit)
    .offset(offset);

  const total = totalRow?.count ?? 0;

  return NextResponse.json({
    ratings: reviews,
    pagination: {
      page,
      limit,
      total,
      total_pages: Math.max(1, Math.ceil(total / limit)),
      has_next: offset + reviews.length < total,
    },
  });
}
