import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { agents, listings, users } from '@/lib/schema';
import { logger } from '@/lib/logger';
import { updateListingSchema, sanitizeHtml, isValidListingId } from '@/lib/validation';
import { validateCsrf } from '@/lib/csrf';
import { and, eq } from 'drizzle-orm';
import { resolveRequestPrincipal } from '@/lib/request-principal';
import { internalErrorResponse } from '@/lib/api-error';
import { payoutAddressForUser } from '@/lib/external-settlement';
import { resolveRegisteredAgentRequest } from '@/lib/registered-agent-auth';

export const dynamic = 'force-dynamic'

async function getListingById(id: string) {
  const rows = await db
    .select({
      id: listings.id,
      seller_id: listings.seller_id,
      seller_name: users.name,
      seller_role: users.role,
      seller_bio: users.bio,
      seller_avatar_url: users.avatar_url,
      category: listings.category,
      title: listings.title,
      description: listings.description,
      price_bankr: listings.price_bankr,
      status: listings.status,
      created_at: listings.created_at,
    })
    .from(listings)
    .leftJoin(users, eq(listings.seller_id, users.id))
    .where(eq(listings.id, id));

  const [listing] = rows;
  return listing ? { ...listing, price_bankr: Number(listing.price_bankr) || 0, price_usd: Number(listing.price_bankr) || 0 } : null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    let listing: any = null;

    if (!isValidListingId(id)) {
      return NextResponse.json({ error: 'Invalid listing ID' }, { status: 400 });
    }

    listing = await getListingById(id);

    if (!listing) {
      return NextResponse.json(
        { error: 'Listing not found' },
        { status: 404 }
      );
    }

    if (String(listing.seller_id).startsWith('user_agent_')) {
      const registeredAgentId = String(listing.seller_id).slice('user_agent_'.length);
      const [registeredAgent] = await db.select({
        status: agents.status,
        visibility: agents.visibility,
        archivedAt: agents.archivedAt,
      }).from(agents).where(eq(agents.id, registeredAgentId)).limit(1);
      if (!registeredAgent || registeredAgent.status !== 'active' || registeredAgent.visibility === 'private' || registeredAgent.archivedAt != null) {
        const auth = await resolveRegisteredAgentRequest(req);
        if (auth.kind !== 'agent' || auth.agentId !== registeredAgentId) {
          return NextResponse.json({ error: 'Listing not found' }, { status: 404 });
        }
      }
    }

    return NextResponse.json({
      listing: {
        ...listing,
        external_payment_ready: Boolean(await payoutAddressForUser(listing.seller_id)),
      },
    });
  } catch (error) {
    return internalErrorResponse('Listing fetch failed', error, {
      code: 'catalog_temporarily_unavailable',
      message: 'The live service catalog is temporarily unavailable. Please retry shortly.',
      status: 503,
    });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await resolveRequestPrincipal(req);

  if (!auth) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  // Validate CSRF for cookie-based auth
  if (auth.usesCookieAuth && !validateCsrf(req)) {
    return NextResponse.json(
      { error: 'CSRF validation failed' },
      { status: 403 }
    );
  }

  try {
    if (!isValidListingId(id)) {
      return NextResponse.json({ error: 'Invalid listing ID' }, { status: 400 });
    }

    const [listing] = await db
      .select()
      .from(listings)
      .where(eq(listings.id, id));

    if (!listing) {
      return NextResponse.json(
        { error: 'Listing not found' },
        { status: 404 }
      );
    }

    if (listing.seller_id !== auth.userId) {
      return NextResponse.json(
        { error: 'You can only update your own listings' },
        { status: 403 }
      );
    }
    if (listing.status !== 'active') {
      return NextResponse.json({ error: 'Only active listings can be updated' }, { status: 409 });
    }

    const body = await req.json();
    const validated = updateListingSchema.parse(body);

    const updateData: any = {};
    
    if (validated.title) {
      updateData.title = sanitizeHtml(validated.title);
    }
    
    if (validated.description) {
      updateData.description = sanitizeHtml(validated.description);
    }
    
    if (validated.price_bankr !== undefined) {
      updateData.price_bankr = validated.price_bankr;
    }
    
    if (validated.category) {
      updateData.category = validated.category;
    }

    const [updatedListing] = await db
      .update(listings)
      .set(updateData)
      .where(eq(listings.id, id))
      .returning();

    return NextResponse.json({
      message: 'Listing updated successfully',
      listing: { ...updatedListing, price_usd: Number(updatedListing.price_bankr) },
    });
  } catch (error: any) {
    const issues = error?.issues || error?.errors;
    if (issues) {
      return NextResponse.json(
        { error: 'Validation failed', details: issues },
        { status: 400 }
      );
    }
    logger.error('Listing update error', { err: String(error) });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await resolveRequestPrincipal(req);

  if (!auth) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  // Validate CSRF for cookie-based auth
  if (auth.usesCookieAuth && !validateCsrf(req)) {
    return NextResponse.json(
      { error: 'CSRF validation failed' },
      { status: 403 }
    );
  }

  try {
    if (!isValidListingId(id)) {
      return NextResponse.json({ error: 'Invalid listing ID' }, { status: 400 });
    }

    const [listing] = await db
      .select()
      .from(listings)
      .where(eq(listings.id, id));

    if (!listing) {
      return NextResponse.json(
        { error: 'Listing not found' },
        { status: 404 }
      );
    }

    if (listing.seller_id !== auth.userId) {
      return NextResponse.json(
        { error: 'You can only delete your own listings' },
        { status: 403 }
      );
    }
    if (listing.status !== 'active' && listing.status !== 'inactive') {
      return NextResponse.json({ error: 'Only unsold listings can be removed' }, { status: 409 });
    }

    // Soft delete by setting status to expired
    await db
      .update(listings)
      .set({ status: 'expired' })
      .where(and(eq(listings.id, id), eq(listings.seller_id, auth.userId)));

    return NextResponse.json({
      message: 'Listing deleted successfully',
    });
  } catch (error) {
    logger.error('Listing deletion error', { err: String(error) });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
