import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { trade_evidence, trades } from '@/lib/schema';
import { authenticateRequest } from '@/lib/auth';
import { isValidUUID } from '@/lib/validation';

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isValidUUID(id)) return NextResponse.json({ error: 'Invalid trade ID' }, { status: 400 });

  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('auth-token')?.value;
  const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const content = typeof body?.content === 'string' ? body.content : null;
  const evidenceUrl = typeof body?.evidence_url === 'string' ? body.evidence_url : null;
  if (!content && !evidenceUrl) return NextResponse.json({ error: 'content or evidence_url is required' }, { status: 400 });

  const [trade] = await db.select().from(trades).where(eq(trades.id, id)).limit(1);
  if (!trade) return NextResponse.json({ error: 'Trade not found' }, { status: 404 });
  if (trade.status !== 'disputed') {
    return NextResponse.json({ error: 'trade_not_disputed' }, { status: 409 });
  }

  if (auth.userId !== trade.buyer_id && auth.userId !== trade.seller_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [evidence] = await db.insert(trade_evidence).values({
    trade_id: trade.id,
    submitter_agent_id: auth.userId,
    content: content || `Evidence link: ${evidenceUrl}`,
    evidence_url: evidenceUrl,
  }).returning();

  return NextResponse.json({ ok: true, evidence }, { status: 201 });
}
