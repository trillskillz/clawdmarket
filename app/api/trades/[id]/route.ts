import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { trades } from '@/lib/schema';
import { authenticateRequest } from '@/lib/auth';
import { updateTradeStatusSchema, isValidUUID } from '@/lib/validation';
import { validateCsrf } from '@/lib/csrf';
import { fireWebhook } from '@/lib/webhooks';
import { eq } from 'drizzle-orm';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('auth-token')?.value;
  const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));

  if (!auth) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  // Validate CSRF for cookie-based auth
  if (!authHeader && !validateCsrf(req)) {
    return NextResponse.json(
      { error: 'CSRF validation failed' },
      { status: 403 }
    );
  }

  try {
    if (!isValidUUID(params.id)) {
      return NextResponse.json({ error: 'Invalid trade ID' }, { status: 400 });
    }

    const [trade] = await db
      .select()
      .from(trades)
      .where(eq(trades.id, params.id));

    if (!trade) {
      return NextResponse.json(
        { error: 'Trade not found' },
        { status: 404 }
      );
    }

    // Check authorization
    const isParty = trade.buyer_id === auth.userId || trade.seller_id === auth.userId;
    
    if (!isParty) {
      return NextResponse.json(
        { error: 'You are not part of this trade' },
        { status: 403 }
      );
    }

    if (trade.status !== 'pending') {
      return NextResponse.json(
        { error: `Cannot update trade with status '${trade.status}'. Only pending trades can be updated.` },
        { status: 400 }
      );
    }

    const body = await req.json();
    const validated = updateTradeStatusSchema.parse(body);

    if (validated.status === 'completed') {
      if (trade.buyer_id !== auth.userId) {
        return NextResponse.json(
          { error: 'Only the buyer can mark a trade as completed' },
          { status: 403 }
        );
      }
    }

    const [updatedTrade] = await db
      .update(trades)
      .set({
        status: validated.status,
        completed_at: validated.status === 'completed' ? new Date() : null,
      })
      .where(eq(trades.id, params.id))
      .returning();

    // Fire webhooks
    if (validated.status === 'completed') {
      await fireWebhook(trade.buyer_id, 'trade.completed', { trade: updatedTrade });
      await fireWebhook(trade.seller_id, 'trade.completed', { trade: updatedTrade });
    }

    return NextResponse.json({
      message: `Trade status updated to ${validated.status}`,
      trade: updatedTrade,
    });
  } catch (error: any) {
    if (error.errors) {
      return NextResponse.json(
        { error: 'Validation failed', details: error.errors },
        { status: 400 }
      );
    }
    console.error('Trade update error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
