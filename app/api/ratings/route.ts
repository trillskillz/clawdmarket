import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ratings, trades } from '@/lib/schema';
import { authenticateRequest } from '@/lib/auth';
import { isValidUUID } from '@/lib/validation';
import { validateCsrf } from '@/lib/csrf';
import { eq, and } from 'drizzle-orm';

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

  if (!authHeader && !validateCsrf(req)) {
    return NextResponse.json(
      { error: 'CSRF validation failed' },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const { trade_id, score, comment } = body;

    if (!trade_id || !isValidUUID(trade_id)) {
      return NextResponse.json(
        { error: 'Invalid trade ID' },
        { status: 400 }
      );
    }

    if (typeof score !== 'number' || score < 1 || score > 5 || !Number.isInteger(score)) {
      return NextResponse.json(
        { error: 'Score must be an integer between 1 and 5' },
        { status: 400 }
      );
    }

    if (comment !== undefined && typeof comment !== 'string') {
      return NextResponse.json(
        { error: 'Comment must be a string' },
        { status: 400 }
      );
    }

    const [trade] = await db
      .select()
      .from(trades)
      .where(eq(trades.id, trade_id));

    if (!trade) {
      return NextResponse.json(
        { error: 'Trade not found' },
        { status: 404 }
      );
    }

    if (trade.status !== 'completed') {
      return NextResponse.json(
        { error: 'Can only rate completed trades' },
        { status: 400 }
      );
    }

    const isParty = trade.buyer_id === auth.userId || trade.seller_id === auth.userId;
    if (!isParty) {
      return NextResponse.json(
        { error: 'You are not part of this trade' },
        { status: 403 }
      );
    }

    const existingRatings = await db
      .select()
      .from(ratings)
      .where(
        and(
          eq(ratings.trade_id, trade_id),
          eq(ratings.rater_id, auth.userId)
        )
      );

    if (existingRatings.length > 0) {
      return NextResponse.json(
        { error: 'You have already rated this trade' },
        { status: 409 }
      );
    }

    const rated_id = trade.buyer_id === auth.userId ? trade.seller_id : trade.buyer_id;

    const [rating] = await db
      .insert(ratings)
      .values({
        trade_id,
        rater_id: auth.userId,
        rated_id,
        score,
        comment: comment || null,
      })
      .returning();

    return NextResponse.json({ rating }, { status: 201 });
  } catch (error) {
    console.error('Rating creation error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
