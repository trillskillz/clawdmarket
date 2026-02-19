import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { listings, users } from '@/lib/schema';
import { authenticateRequest } from '@/lib/auth';
import { updateListingSchema, sanitizeHtml, isValidUUID } from '@/lib/validation';
import { validateCsrf } from '@/lib/csrf';
import { eq } from 'drizzle-orm';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    if (!isValidUUID(params.id)) {
      return NextResponse.json({ error: 'Invalid listing ID' }, { status: 400 });
    }

    const [listing] = await db
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
        price_clawd: listings.price_clawd,
        status: listings.status,
        created_at: listings.created_at,
      })
      .from(listings)
      .leftJoin(users, eq(listings.seller_id, users.id))
      .where(eq(listings.id, params.id));

    if (!listing) {
      return NextResponse.json(
        { error: 'Listing not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ listing });
  } catch (error) {
    console.error('Listing fetch error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('auth-token')?.value;
  const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));

  if (!auth) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  // Validate CSRF for cookie-based auth
  if (!authHeader && !validateCsrf(req)) {
    return NextResponse.json(
      { error: 'CSRF validation failed' },
      { status: 403 }
    );
  }

  try {
    if (!isValidUUID(params.id)) {
      return NextResponse.json({ error: 'Invalid listing ID' }, { status: 400 });
    }

    const [listing] = await db
      .select()
      .from(listings)
      .where(eq(listings.id, params.id));

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

    const body = await req.json();
    const validated = updateListingSchema.parse(body);

    const updateData: any = {};
    
    if (validated.title) {
      updateData.title = sanitizeHtml(validated.title);
    }
    
    if (validated.description) {
      updateData.description = sanitizeHtml(validated.description);
    }
    
    if (validated.price_clawd !== undefined) {
      updateData.price_clawd = validated.price_clawd;
    }
    
    if (validated.category) {
      updateData.category = validated.category;
    }

    const [updatedListing] = await db
      .update(listings)
      .set(updateData)
      .where(eq(listings.id, params.id))
      .returning();

    return NextResponse.json({
      message: 'Listing updated successfully',
      listing: updatedListing,
    });
  } catch (error: any) {
    if (error.errors) {
      return NextResponse.json(
        { error: 'Validation failed', details: error.errors },
        { status: 400 }
      );
    }
    console.error('Listing update error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('auth-token')?.value;
  const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));

  if (!auth) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  // Validate CSRF for cookie-based auth
  if (!authHeader && !validateCsrf(req)) {
    return NextResponse.json(
      { error: 'CSRF validation failed' },
      { status: 403 }
    );
  }

  try {
    if (!isValidUUID(params.id)) {
      return NextResponse.json({ error: 'Invalid listing ID' }, { status: 400 });
    }

    const [listing] = await db
      .select()
      .from(listings)
      .where(eq(listings.id, params.id));

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

    // Soft delete by setting status to expired
    await db
      .update(listings)
      .set({ status: 'expired' })
      .where(eq(listings.id, params.id));

    return NextResponse.json({
      message: 'Listing deleted successfully',
    });
  } catch (error) {
    console.error('Listing deletion error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
