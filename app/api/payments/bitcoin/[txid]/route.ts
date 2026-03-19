import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { payment_receipts } from '@/lib/schema';
import { verifyBitcoinPayment } from '@/lib/bitcoin-payment';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ txid: string }> }) {
  const { txid } = await params;

  const rows = await db
    .select()
    .from(payment_receipts)
    .where(and(eq(payment_receipts.tx_hash, txid), eq(payment_receipts.chain_id, 0)))
    .limit(1);

  if (rows[0]) {
    return NextResponse.json({ confirmed: true, confirmations: 999, receipt: rows[0] });
  }

  const result = await verifyBitcoinPayment(txid, 0.001);
  const confirmed = Boolean(result.verified && (result.confirmations || 0) >= 1);

  return NextResponse.json({ confirmed, confirmations: result.confirmations || 0 });
}
