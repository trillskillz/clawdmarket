import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { listings } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { FALLBACK_LISTINGS } from '@/lib/marketplace-fallback';

const DEV_FEE_PERCENT = 0.03;

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const listingId = String(body?.listing_id || '');
    if (!listingId) {
      return NextResponse.json({ error: 'listing_id is required' }, { status: 400 });
    }

    let [listing] = await db.select({ id: listings.id, price_bankr: listings.price_bankr }).from(listings).where(eq(listings.id, listingId)).limit(1);

    if (!listing && listingId.startsWith('fb-')) {
      const fallback = FALLBACK_LISTINGS.find((l) => l.id === listingId);
      if (fallback) {
        listing = { id: fallback.id, price_bankr: fallback.price_bankr };
      }
    }

    if (!listing) {
      return NextResponse.json({ error: 'Listing not found' }, { status: 404 });
    }

    const item_price = Number(listing.price_bankr);
    const platform_fee = round2(item_price * DEV_FEE_PERCENT);
    const total_cost = round2(item_price + platform_fee);

    return NextResponse.json({
      listing_id: listing.id,
      item_price,
      platform_fee,
      total_cost,
      seller_amount: item_price,
      dev_amount: platform_fee,
      dev_wallet: (process.env.DEV_WALLET_ADDRESS || process.env.DEV_FEE_WALLET_ADDRESS || process.env.ADMIN_BANKR_WALLET_ADDRESS || '').trim() || null,
      fee_percent: DEV_FEE_PERCENT,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Internal server error' }, { status: 500 });
  }
}
