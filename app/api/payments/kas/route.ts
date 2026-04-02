import { NextRequest, NextResponse } from 'next/server';
import { kasPaymentHandler } from '@/lib/kas-payment-instance';
import { db } from '@/lib/db';
import { listings } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { FALLBACK_LISTINGS } from '@/lib/marketplace-fallback';

export const dynamic = 'force-dynamic'

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

    let [listing] = await db.select({ id: listings.id, price_bankr: listings.price_bankr }).from(listings).where(eq(listings.id, service_id)).limit(1);
    if (!listing && String(service_id).startsWith('fb-')) {
      const fallback = FALLBACK_LISTINGS.find((l) => l.id === service_id);
      if (fallback) listing = { id: fallback.id, price_bankr: fallback.price_bankr };
    }

    if (!listing) {
      return NextResponse.json({ success: false, error_code: 'LISTING_NOT_FOUND', message: 'Listing not found.' }, { status: 404 });
    }

    const item_price = Number(listing.price_bankr);
    const platform_fee = Math.round(item_price * 0.05 * 100) / 100;
    const total_cost = Math.round((item_price + platform_fee) * 100) / 100;

    const payment = await kasPaymentHandler.createPayment({
      service_id,
      buyer_agent_address,
      amount_kas,
      item_price,
      platform_fee,
      total_cost,
      dev_wallet: (process.env.DEV_KAS_WALLET_ADDRESS || process.env.DEV_WALLET_ADDRESS || process.env.DEV_FEE_WALLET_ADDRESS || process.env.ADMIN_BANKR_WALLET_ADDRESS || '').trim() || null,
    });

    return NextResponse.json({
      payment_id: payment.payment_id,
      kas_deposit_address: payment.kas_deposit_address,
      amount_kas: payment.amount_kas_expected,
      expires_at: payment.expires_at,
      status: payment.status,
      item_price: payment.item_price,
      platform_fee: payment.platform_fee,
      total_cost: payment.total_cost,
      seller_amount: payment.seller_amount,
      dev_amount: payment.dev_amount,
      dev_wallet: payment.dev_wallet,
    });
  } catch (e: any) {
    return NextResponse.json({ success: false, error_code: 'INTERNAL_ERROR', message: e?.message || 'Internal error' }, { status: 500 });
  }
}
