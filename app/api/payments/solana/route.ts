import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { payment_receipts } from '@/lib/schema';
import { verifySolanaPayment } from '@/lib/solana-payment';
import { SOLANA_USDC_MINT, SOLANA_USDT_MINT } from '@/lib/constants';

function tokenSymbolFromMint(mint?: string) {
  if (!mint || mint === 'SOL') return 'SOL';
  if (mint === SOLANA_USDC_MINT) return 'USDC';
  if (mint === SOLANA_USDT_MINT) return 'USDT';
  return 'SPL';
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const signature = String(body?.signature || '').trim();
    const route = String(body?.route || '').trim();
    const amountUsd = Number(body?.amount_usd || 0);

    if (!signature || !route || !(amountUsd > 0)) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    const result = await verifySolanaPayment(signature, amountUsd);
    if (!result.verified) {
      return NextResponse.json({ ok: false, error: 'unverified' }, { status: 400 });
    }

    const receiptId = randomUUID();
    const symbol = tokenSymbolFromMint(result.mint);

    await db.insert(payment_receipts).values({
      id: receiptId,
      route,
      amount: amountUsd,
      currency: 'solana',
      tx_hash: signature,
      payer_address: result.payer || null,
      token_address: result.mint === 'SOL' ? 'SOL' : result.mint || 'SOL',
      chain_id: 999999,
      token_symbol: symbol,
      token_amount: String(result.amount || 0),
      usd_value_at_payment: amountUsd,
    });

    return NextResponse.json({ ok: true, receipt_id: receiptId, signature });
  } catch (error) {
    console.error('Solana payment POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
