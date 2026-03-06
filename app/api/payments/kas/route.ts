import { NextRequest, NextResponse } from 'next/server';
import { kasPaymentHandler } from '@/lib/kas-payment-instance';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { service_id, buyer_agent_address, amount_kas } = body || {};

    if (!service_id || !buyer_agent_address || !amount_kas) {
      return NextResponse.json(
        { success: false, error_code: 'VALIDATION_ERROR', message: 'service_id, buyer_agent_address, and amount_kas are required.' },
        { status: 400 },
      );
    }

    const payment = await kasPaymentHandler.createPayment({ service_id, buyer_agent_address, amount_kas });

    return NextResponse.json({
      payment_id: payment.payment_id,
      kas_deposit_address: payment.kas_deposit_address,
      amount_kas: payment.amount_kas_expected,
      expires_at: payment.expires_at,
      status: payment.status,
    });
  } catch (e: any) {
    return NextResponse.json({ success: false, error_code: 'INTERNAL_ERROR', message: e?.message || 'Internal error' }, { status: 500 });
  }
}
