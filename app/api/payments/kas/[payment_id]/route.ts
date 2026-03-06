import { NextRequest, NextResponse } from 'next/server';
import { kasPaymentHandler } from '@/lib/kas-payment-instance';

export async function GET(_req: NextRequest, { params }: { params: { payment_id: string } }) {
  const payment = kasPaymentHandler.getPayment(params.payment_id);
  if (!payment) {
    return NextResponse.json({ success: false, error_code: 'NOT_FOUND', message: 'Payment not found' }, { status: 404 });
  }

  return NextResponse.json({
    status: payment.status,
    kas_received: payment.amount_kas_received,
    conversion_status: payment.status === 'settled' ? 'complete' : payment.status,
    settled_at: payment.status === 'settled' ? payment.updated_at : null,
  });
}
