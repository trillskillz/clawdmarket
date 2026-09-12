import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { trade_evidence, trades } from '@/lib/schema';
import { isValidUUID } from '@/lib/validation';
import { resolveRequestPrincipal } from '@/lib/request-principal';
import { validateCsrf } from '@/lib/csrf';

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isValidUUID(id)) return NextResponse.json({ error: 'Invalid trade ID' }, { status: 400 });

  const auth = await resolveRequestPrincipal(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (auth.usesCookieAuth && !validateCsrf(req)) {
    return NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const content = typeof body?.content === 'string' ? body.content.trim() : null;
  const evidenceUrl = typeof body?.evidence_url === 'string' ? body.evidence_url.trim() : null;
  if (!content && !evidenceUrl) return NextResponse.json({ error: 'content or evidence_url is required' }, { status: 400 });
  if (content && content.length > 20_000) return NextResponse.json({ error: 'content is too long' }, { status: 413 });
  if (evidenceUrl) {
    if (evidenceUrl.length > 2_000) return NextResponse.json({ error: 'evidence_url is too long' }, { status: 413 });
    try {
      const parsed = new URL(evidenceUrl);
      if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('unsupported protocol');
    } catch {
      return NextResponse.json({ error: 'evidence_url must be an HTTP(S) URL' }, { status: 400 });
    }
  }

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
