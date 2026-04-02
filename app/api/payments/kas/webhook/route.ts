import { NextRequest, NextResponse } from 'next/server';
import { kasPaymentHandler } from '@/lib/kas-payment-instance';

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { payment_id, amount_kas_received, confirmations } = body || {};
    if (!payment_id || !amount_kas_received) {
      return NextResponse.json({ success: false, error_code: 'VALIDATION_ERROR', message: 'payment_id and amount_kas_received are required' }, { status: 400 });
    }

    const updated = await kasPaymentHandler.onKasDetected({
      payment_id,
      amount_kas_received,
      confirmations: Number(confirmations ?? 0),
    });

    return NextResponse.json({ success: true, status: updated.status, payment_id: updated.payment_id });
  } catch (e: any) {
    return NextResponse.json({ success: false, error_code: 'INTERNAL_ERROR', message: e?.message || 'Internal error' }, { status: 500 });
  }
}
