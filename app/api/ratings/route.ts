import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { ratings, trades, users, agents } from '@/lib/schema';
import { authenticateRequest } from '@/lib/auth';
import { validateCsrf } from '@/lib/csrf';
import { isValidUUID } from '@/lib/validation';
import { deliverWebhookEvent } from '@/lib/webhook-delivery';

const MAX_PAGE_SIZE = 50;

function parsePagination(req: NextRequest) {
  const page = Number.parseInt(req.nextUrl.searchParams.get('page') || '1', 10);
  const limit = Number.parseInt(req.nextUrl.searchParams.get('limit') || '20', 10);

  if (!Number.isInteger(page) || page < 1) {
    return { error: NextResponse.json({ error: 'Invalid page parameter' }, { status: 400 }) };
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    return { error: NextResponse.json({ error: `Invalid limit parameter (1-${MAX_PAGE_SIZE})` }, { status: 400 }) };
  }

  return { page, limit, offset: (page - 1) * limit };
}

async function recalculateAgentRating(agentId: string) {
  const [row] = await db
    .select({
      avg_rating: sql<number>`COALESCE(ROUND(AVG(${ratings.score}), 2), 0)`,
      rating_count: sql<number>`COUNT(*)`,
    })
    .from(ratings)
    .where(eq(ratings.rated_id, agentId));

  await db
    .update(agents)
    .set({
      avg_rating: row?.avg_rating ?? 0,
      rating_count: row?.rating_count ?? 0,
    })
    .where(eq(agents.id, agentId));
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('auth-token')?.value;
  const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));

  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const pagination = parsePagination(req);
  if ('error' in pagination) return pagination.error;

  const { page, limit, offset } = pagination;

  const where = eq(ratings.rated_id, auth.userId);

  const [totalRow] = await db.select({ count: sql<number>`COUNT(*)` }).from(ratings).where(where);

  const items = await db
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
    .where(where)
    .orderBy(desc(ratings.created_at))
    .limit(limit)
    .offset(offset);

  const total = totalRow?.count ?? 0;
  return NextResponse.json({
    ratings: items,
    pagination: {
      page,
      limit,
      total,
      total_pages: Math.max(1, Math.ceil(total / limit)),
      has_next: offset + items.length < total,
    },
  });
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('auth-token')?.value;
  const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));

  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!authHeader && !validateCsrf(req)) {
    return NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { trade_id, score, comment } = body;

    if (!trade_id || !isValidUUID(trade_id)) {
      return NextResponse.json({ error: 'Invalid trade ID' }, { status: 400 });
    }

    if (!Number.isInteger(score) || score < 1 || score > 5) {
      return NextResponse.json({ error: 'Score must be an integer from 1 to 5' }, { status: 400 });
    }

    if (comment !== undefined && comment !== null && typeof comment !== 'string') {
      return NextResponse.json({ error: 'Comment must be a string' }, { status: 400 });
    }

    if (typeof comment === 'string' && comment.length > 500) {
      return NextResponse.json({ error: 'Comment must be 500 characters or fewer' }, { status: 400 });
    }

    const [trade] = await db.select().from(trades).where(eq(trades.id, trade_id));

    if (!trade) {
      return NextResponse.json({ error: 'Trade not found' }, { status: 404 });
    }

    if (trade.status !== 'complete' && trade.status !== 'completed') {
      return NextResponse.json({ error: 'Can only rate completed trades' }, { status: 400 });
    }

    const isParty = trade.buyer_id === auth.userId || trade.seller_id === auth.userId;
    if (!isParty) {
      return NextResponse.json({ error: 'You are not part of this trade' }, { status: 403 });
    }

    if (!trade.completed_at) {
      return NextResponse.json({ error: 'Trade completion timestamp missing' }, { status: 409 });
    }

    if (!trade.rating_window_expires_at || new Date(trade.rating_window_expires_at).getTime() < Date.now()) {
      return NextResponse.json({ error: 'Rating window has expired' }, { status: 400 });
    }

    const [existingRating] = await db
      .select({ id: ratings.id })
      .from(ratings)
      .where(and(eq(ratings.trade_id, trade_id), eq(ratings.rater_id, auth.userId)))
      .limit(1);

    if (existingRating) {
      return NextResponse.json({ error: 'You have already rated this trade' }, { status: 409 });
    }

    const rated_id = trade.buyer_id === auth.userId ? trade.seller_id : trade.buyer_id;

    const [rating] = await db
      .insert(ratings)
      .values({
        trade_id,
        rater_id: auth.userId,
        rated_id,
        score,
        comment: comment?.trim() ? comment.trim() : null,
      })
      .returning();

    await recalculateAgentRating(rated_id);

    await deliverWebhookEvent(rated_id, 'rating.received', {
      rating_id: rating.id,
      score,
      review: comment?.trim() ? comment.trim() : null,
      from_agent_id: auth.userId,
    });

    return NextResponse.json({ rating }, { status: 201 });
  } catch (error) {
    console.error('Rating creation error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
