import { NextRequest, NextResponse } from 'next/server';
import { desc, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { messages, users } from '@/lib/schema';
import { authenticateRequest } from '@/lib/auth';
import { authorizeAdmin } from '@/lib/admin-auth';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('auth-token')?.value;
  const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));

  const error = authorizeAdmin(auth ? { userId: auth.userId, email: auth.email } : null);
  if (error) return error;

  const rl = await rateLimit(`admin:${auth!.userId}`, { interval: 60_000, maxRequests: 30 });
  if (!rl.success) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429, headers: getRateLimitHeaders(rl) });
  }

  try {
    const rows = await db
      .select({
        id: messages.id,
        sender_id: messages.sender_id,
        receiver_id: messages.receiver_id,
        encrypted_content: messages.encrypted_content, // Correct column name
        nonce: messages.nonce,
        created_at: messages.created_at,
      })
      .from(messages)
      .orderBy(desc(messages.created_at))
      .limit(50);

    // Get user details
    const userIds = Array.from(new Set(rows.flatMap(r => [r.sender_id, r.receiver_id])));
    const userMap = new Map();
    
    if (userIds.length > 0) {
      const userRows = await db
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(inArray(users.id, userIds));
      userRows.forEach(u => userMap.set(u.id, u));
    }

    const result = rows.map(r => ({
      id: r.id,
      created_at: r.created_at,
      content: r.encrypted_content, // Map encrypted_content to content for frontend consistency, or handle in frontend
      // Ideally we decrypt here if we have the key, otherwise send raw.
      // Let's send raw for now to fix the build.
      encrypted_content: r.encrypted_content,
      nonce: r.nonce,
      sender: userMap.get(r.sender_id) || { id: r.sender_id, name: 'Unknown' },
      receiver: userMap.get(r.receiver_id) || { id: r.receiver_id, name: 'Unknown' }
    }));

    return NextResponse.json({ messages: result });
  } catch (err) {
    console.error('Admin messages error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
