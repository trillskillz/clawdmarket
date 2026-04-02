import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { db } from '@/lib/db';
import { users } from '@/lib/schema';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic'

async function getUserColumnNames(): Promise<Set<string>> {
  const cols = new Set<string>();
  try {
    const rs = await (db as any).$client.execute({ sql: "PRAGMA table_info('users')", args: [] });
    for (const row of rs?.rows || []) {
      const name = String((row as any)?.name ?? (row as any)?.[1] ?? '').trim();
      if (name) cols.add(name);
    }
  } catch (error) {
    console.error('getUserColumnNames error:', error);
  }
  return cols;
}

async function ensureProfileColumns() {
  try {
    const existing = await getUserColumnNames();

    if (!existing.has('avatar_emoji')) {
      await (db as any).$client.execute({ sql: 'ALTER TABLE users ADD COLUMN avatar_emoji TEXT', args: [] });
    }
    if (!existing.has('avatar_url')) {
      await (db as any).$client.execute({ sql: 'ALTER TABLE users ADD COLUMN avatar_url TEXT', args: [] });
    }
    if (!existing.has('bio')) {
      await (db as any).$client.execute({ sql: 'ALTER TABLE users ADD COLUMN bio TEXT', args: [] });
    }
  } catch (error) {
    console.error('ensureProfileColumns error:', error);
  }
}

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
    await ensureProfileColumns();

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
    await ensureProfileColumns();

    const body = await req.json();
    const { bio, avatar_url, avatar_emoji } = body;

    const normalizedBio = typeof bio === 'string' ? bio.trim() : undefined;
    const normalizedAvatarUrl = typeof avatar_url === 'string' ? avatar_url.trim() : undefined;
    const normalizedAvatarEmoji = typeof avatar_emoji === 'string' ? avatar_emoji.trim() : undefined;

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

    try {
      await db
        .update(users)
        .set(patchData)
        .where(eq(users.id, auth.userId));
    } catch (err: any) {
      const message = String(err?.message || '');
      if (message.includes('no such column')) {
        // One more best-effort schema sync + retry
        await ensureProfileColumns();
        await db
          .update(users)
          .set(patchData)
          .where(eq(users.id, auth.userId));
      } else {
        throw err;
      }
    }

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
