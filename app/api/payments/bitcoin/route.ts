import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { payment_receipts } from '@/lib/schema';
import { verifyBitcoinPayment } from '@/lib/bitcoin-payment';
import { deliverWebhookEvent } from '@/lib/webhook-delivery';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const txid = String(body?.txid || '').trim();
    const route = String(body?.route || '').trim();
    const amountUsd = Number(body?.amount_usd || 0);

    if (!txid || !route || !(amountUsd > 0)) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    const result = await verifyBitcoinPayment(txid, amountUsd);

    if (!result.confirmations || result.confirmations < 1) {
      return NextResponse.json({ ok: false, pending: true, confirmations: result.confirmations || 0 }, { status: 202 });
    }

    if (!result.verified) {
      return NextResponse.json({ ok: false, error: 'unverified', confirmations: result.confirmations || 0 }, { status: 400 });
    }

    const receiptId = randomUUID();
    await db.insert(payment_receipts).values({
      id: receiptId,
      route,
      amount: amountUsd,
      currency: 'bitcoin',
      tx_hash: txid,
      payer_address: result.payer_address || null,
      token_address: 'BTC',
      chain_id: 0,
      token_symbol: 'BTC',
      token_amount: String(result.amount_btc || 0),
      usd_value_at_payment: amountUsd,
    });

    if (result.payer_address) {
      await deliverWebhookEvent(result.payer_address, 'payment.received', {
        receipt_id: receiptId,
        amount_usd: amountUsd,
        token_symbol: 'BTC',
        tx_hash: txid,
      });
    }

    return NextResponse.json({ ok: true, receipt_id: receiptId, txid, confirmations: result.confirmations || 0 });
  } catch (error) {
    console.error('Bitcoin payment POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
