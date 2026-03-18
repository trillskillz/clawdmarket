import { NextRequest, NextResponse } from 'next/server';
import { kasPaymentHandler } from '@/lib/kas-payment-instance';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ payment_id: string }> }) {
  const { payment_id } = await params;
  const payment = kasPaymentHandler.getPayment(payment_id);
  if (!payment) {
    return NextResponse.json({ success: false, error_code: 'NOT_FOUND', message: 'Payment not found' }, { status: 404 });
  }

  return NextResponse.json({
    status: payment.status,
    payout_status: payment.payout_status,
    kas_received: payment.amount_kas_received,
    conversion_status: payment.status === 'settled' ? 'complete' : payment.status,
    settled_at: payment.status === 'settled' ? payment.updated_at : null,
    item_price: payment.item_price,
    platform_fee: payment.platform_fee,
    total_cost: payment.total_cost,
    seller_amount: payment.seller_amount,
    dev_amount: payment.dev_amount,
    dev_wallet: payment.dev_wallet,
    fee_tx_hash: payment.fee_tx_hash || null,
  });
}
