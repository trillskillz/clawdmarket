import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { db } from '@/lib/db';
import { users } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { validateCsrf } from '@/lib/csrf';

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('auth-token')?.value;
  const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));

  if (!auth) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    );
  }
  try {
    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        bio: users.bio,
        avatar_url: users.avatar_url,
        avatar_emoji: users.avatar_emoji,
        created_at: users.created_at,
      })
      .from(users)
      .where(eq(users.id, auth.userId));

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    const wallet = user.email.startsWith('wallet_') && user.email.endsWith('@wallet.local')
      ? user.email.replace('wallet_', '').replace('@wallet.local', '')
      : null;

    return NextResponse.json({
      authenticated: true,
      user: {
        ...user,
        wallet,
      },
    });
  } catch (error) {
    console.error('Get current user error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('auth-token')?.value;
  const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));

  if (!auth) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    );
  }
  if (!authHeader && !validateCsrf(req)) {
    return NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { bio, avatar_url, avatar_emoji } = body;

    const normalizedBio = typeof bio === 'string' ? bio.trim() : undefined;
    const normalizedAvatarUrl = typeof avatar_url === 'string' ? avatar_url.trim() : undefined;
    const normalizedAvatarEmoji = typeof avatar_emoji === 'string' ? avatar_emoji.trim() : undefined;

    if (normalizedBio === undefined && normalizedAvatarUrl === undefined && normalizedAvatarEmoji === undefined) {
      return NextResponse.json({ error: 'At least one profile field is required' }, { status: 400 });
    }

    // Validate (basic)
    if (normalizedBio && normalizedBio.length > 500) {
      return NextResponse.json({ error: 'Bio too long (max 500 chars)' }, { status: 400 });
    }
    if (normalizedAvatarEmoji && normalizedAvatarEmoji.length > 8) { // allow composed emoji sequences
      return NextResponse.json({ error: 'Invalid emoji' }, { status: 400 });
    }
    if (normalizedAvatarUrl && !/^https?:\/\//i.test(normalizedAvatarUrl)) {
      return NextResponse.json({ error: 'Avatar URL must start with http:// or https://' }, { status: 400 });
    }

    const patchData: Record<string, any> = {
      bio: normalizedBio !== undefined ? (normalizedBio || null) : undefined,
      avatar_url: normalizedAvatarUrl !== undefined ? (normalizedAvatarUrl || null) : undefined,
      avatar_emoji: normalizedAvatarEmoji !== undefined ? (normalizedAvatarEmoji || null) : undefined,
    };

    await db
      .update(users)
      .set(patchData)
      .where(eq(users.id, auth.userId));

    const [updated] = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        bio: users.bio,
        avatar_url: users.avatar_url,
        avatar_emoji: users.avatar_emoji,
      })
      .from(users)
      .where(eq(users.id, auth.userId));

    return NextResponse.json({ success: true, user: updated });
  } catch (error) {
    console.error('Update profile error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
