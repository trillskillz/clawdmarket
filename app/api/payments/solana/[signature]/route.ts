import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { payment_receipts } from '@/lib/schema';
import { eq, and } from 'drizzle-orm';

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ signature: string }> }) {
  const { signature } = await params;

  const rows = await db
    .select()
    .from(payment_receipts)
    .where(and(eq(payment_receipts.tx_hash, signature), eq(payment_receipts.chain_id, 999999)))
    .limit(1);

  if (!rows[0]) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  return NextResponse.json(rows[0]);
}
