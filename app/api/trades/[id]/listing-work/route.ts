import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { tradeAcceptanceStatus } from '@/lib/trade-acceptance'
import { trade_deliveries } from '@/lib/schema'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { originalListingPayment } from '@/lib/organization-listing-uses'
import { purchasingHeaders, purchasingResult } from '@/lib/organization-purchasing-api'
import { PurchasingError } from '@/lib/organization-purchasing-transaction'
import { internalErrorResponse } from '@/lib/api-error'

export const dynamic = 'force-dynamic'

/** Original listing work is private to its buyer and, after funding, its seller.
 * No service lease, task assignment or new spending permission is granted. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const principal = await resolveRequestPrincipal(request)
    if (!principal) return purchasingResult({ error_code: 'UNAUTHORIZED' }, 401)
    const { id } = await params
    const original = await originalListingPayment(db, id)
    if (!original || ![original.trade.buyer_id, original.trade.seller_id].includes(principal.userId)) {
      return purchasingResult({ error_code: 'LISTING_WORK_NOT_FOUND' }, 404)
    }
    const { trade, authorization, terms } = original, seller = principal.userId === trade.seller_id
    if (seller && (!trade.funded_at || trade.status === 'pending' || trade.status === 'cancelled')) {
      return purchasingResult({ error_code: 'LISTING_WORK_NOT_FUNDED' }, 409)
    }
    const [delivery] = await db.select({ id: trade_deliveries.id, content_hash: trade_deliveries.content_hash, summary: trade_deliveries.summary, artifact_json: trade_deliveries.artifact_json, delivery_url: trade_deliveries.delivery_url })
      .from(trade_deliveries).where(eq(trade_deliveries.trade_id, trade.id)).limit(1)
    return purchasingResult({ id: authorization.listing_id, viewer: { is_buyer: !seller, is_seller: seller }, workspace: {
      trade: { id: trade.id, buyer_id: trade.buyer_id, seller_id: trade.seller_id, status: trade.status,
        payout_status: trade.payout_status, payment_rail: trade.payment_rail, funded_at: trade.funded_at },
      reviewed_listing: { authorization_id: authorization.id, authority_hash: authorization.authority_hash,
        listing_id: authorization.listing_id, buyer_id: trade.buyer_id, seller_id: trade.seller_id,
        title: terms.listing.title, description: terms.listing.description, requirements: terms.delivery,
        acceptance: { mode: 'explicit_buyer', content_hash_required: true, auto_confirm_enabled: false } },
      delivery: delivery ? { id: delivery.id, content_hash: delivery.content_hash, summary: delivery.summary, artifact: delivery.artifact_json ? JSON.parse(delivery.artifact_json) : null, delivery_url: delivery.delivery_url } : null,
      acceptance: await tradeAcceptanceStatus(trade.id),
    } })
  } catch (error) {
    if (error instanceof PurchasingError) return purchasingResult({ error_code: error.code }, error.status)
    const response: NextResponse = internalErrorResponse('Original listing work lookup failed', error)
    for (const [name, value] of Object.entries(purchasingHeaders)) response.headers.set(name, value)
    return response
  }
}
