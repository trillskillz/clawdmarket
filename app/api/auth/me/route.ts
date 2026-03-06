import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { db } from '@/lib/db';
import { users } from '@/lib/schema';
import { eq } from 'drizzle-orm';

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

  try {
    const body = await req.json();
    const { bio, avatar_url, avatar_emoji } = body;

    // Validate (basic)
    if (bio && bio.length > 500) {
      return NextResponse.json({ error: 'Bio too long (max 500 chars)' }, { status: 400 });
    }
    if (avatar_emoji && avatar_emoji.length > 4) { // Allow composite emojis
       return NextResponse.json({ error: 'Invalid emoji' }, { status: 400 });
    }

    await db
      .update(users)
      .set({
        bio: bio !== undefined ? bio : undefined,
        avatar_url: avatar_url !== undefined ? avatar_url : undefined,
        avatar_emoji: avatar_emoji !== undefined ? avatar_emoji : undefined,
      })
      .where(eq(users.id, auth.userId));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Update profile error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
