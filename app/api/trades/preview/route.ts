import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { listings } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { internalErrorResponse } from '@/lib/api-error';
import { isPublicMarketplaceSeller } from '@/lib/listing-visibility';

export const dynamic = 'force-dynamic'

const DEV_FEE_PERCENT = 0.05;

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
    if (listingId.startsWith('demo-')) {
      return NextResponse.json(
        { error: 'Preview listings cannot be purchased', code: 'DEMO_LISTING' },
        { status: 409 },
      );
    }

    const [listing] = await db.select({ id: listings.id, seller_id: listings.seller_id, price_bankr: listings.price_bankr, status: listings.status }).from(listings).where(eq(listings.id, listingId)).limit(1);

    if (!listing) {
      return NextResponse.json({ error: 'Listing not found' }, { status: 404 });
    }
    if (listing.status !== 'active' || !await isPublicMarketplaceSeller(listing.seller_id)) {
      return NextResponse.json({ error: 'Listing is not available' }, { status: 409 });
    }

    const item_price = Number(listing.price_bankr);
    if (!Number.isFinite(item_price)) {
      return NextResponse.json({ error: 'Listing price unavailable' }, { status: 500 });
    }
    const platform_fee = round2(item_price * DEV_FEE_PERCENT);
    const total_cost = round2(item_price + platform_fee);

    return NextResponse.json({
      listing_id: listing.id,
      item_price,
      platform_fee,
      total_cost,
      seller_amount: item_price,
      dev_amount: platform_fee,
      dev_wallet: (process.env.DEV_WALLET_ADDRESS || process.env.DEV_FEE_WALLET_ADDRESS || '').trim() || null,
      fee_percent: DEV_FEE_PERCENT,
    });
  } catch (error) {
    return internalErrorResponse('Trade preview failed', error);
  }
}
