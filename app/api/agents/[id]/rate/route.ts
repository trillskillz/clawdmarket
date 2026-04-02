import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { users, agent_ratings } from '@/lib/schema';
import { eq, and } from 'drizzle-orm';
import { authenticateRequest } from '@/lib/auth';
import { validateAgentInstruction } from '@/lib/agent-security';
import { verifyAgentRequestSignature, walletFromSyntheticEmail } from '@/lib/agent-signature';

export const dynamic = 'force-dynamic'

// POST /api/agents/[id]/rate
// Rate an agent (+1 or -1)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const authHeader = req.headers.get('authorization');
    const cookieToken = req.cookies.get('auth-token')?.value;
    const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));

    if (!auth) {
      return NextResponse.json({ success: false, error_code: 'UNAUTHORIZED', message: 'Unauthorized' }, { status: 401 });
    }

    const replayValidation = await validateAgentInstruction(req, auth.userId, authHeader || null);
    if (replayValidation) return replayValidation;

    const [actor] = await db.select().from(users).where(eq(users.id, auth.userId));
    if (!actor || actor.role !== 'agent') {
      return NextResponse.json(
        { success: false, error_code: 'AGENT_ROLE_REQUIRED', message: 'Only agents can rate other agents' },
        { status: 403 }
      );
    }

    const rawBody = await req.text();
    let body: any;
    try {
      body = JSON.parse(rawBody || '{}');
    } catch {
      return NextResponse.json(
        { success: false, error_code: 'INVALID_JSON', message: 'Request body must be valid JSON' },
        { status: 400 }
      );
    }

    const expectedWallet = walletFromSyntheticEmail(actor.email);
    const sigCheck = await verifyAgentRequestSignature({
      method: req.method,
      path: req.nextUrl.pathname,
      headers: Object.fromEntries(req.headers.entries()),
      bodyText: rawBody,
      expectedWallet: expectedWallet ?? undefined,
    });

    if (!sigCheck.ok) {
      return NextResponse.json(
        { success: false, error_code: sigCheck.code, message: sigCheck.message },
        { status: 401 }
      );
    }

    const fromAgentId = actor.id;
    const toAgentId = id;

    if (fromAgentId === toAgentId) {
      return NextResponse.json(
        { error: 'Cannot rate yourself' },
        { status: 400 }
      );
    }

    const { score } = body; // expect 1 or -1

    if (![1, -1].includes(score)) {
      return NextResponse.json(
        { error: 'Score must be 1 (like) or -1 (dislike)' },
        { status: 400 }
      );
    }

    // Check if rating exists
    const existingRating = await db.query.agent_ratings.findFirst({
      where: and(
        eq(agent_ratings.from_agent_id, fromAgentId),
        eq(agent_ratings.to_agent_id, toAgentId)
      ),
    });

    if (existingRating) {
      // Update existing rating
      await db
        .update(agent_ratings)
        .set({ score, created_at: new Date() })
        .where(eq(agent_ratings.id, existingRating.id));
    } else {
      // Create new rating
      await db.insert(agent_ratings).values({
        from_agent_id: fromAgentId,
        to_agent_id: toAgentId,
        score,
      });
    }

    return NextResponse.json({ success: true, score });
  } catch (error) {
    console.error('Error rating agent:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
