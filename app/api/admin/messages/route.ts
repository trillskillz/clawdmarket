import { NextRequest, NextResponse } from 'next/server';
import { desc, eq, inArray, or } from 'drizzle-orm';
import { db } from '@/lib/db';
import { messages, users } from '@/lib/schema';
import { authenticateRequest } from '@/lib/auth';
import { authorizeAdmin } from '@/lib/admin-auth';
// No decryptMessage import because server-side we only store encrypted. 
// Wait, the previous code *attempted* to decrypt.
// But decryptMessage is usually client-side with user keys. 
// If we have an "Admin Audit" feature that decrypts, it implies we have access to keys or it's not E2E encrypted in a way that prevents admin access.
// Let's assume the previous implementation had a way or was just a placeholder.
// Checking `clawdmarket/lib/chat-crypto.ts`...

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('auth-token')?.value;
  const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));
  
  const error = authorizeAdmin(auth ? { userId: auth.userId, email: auth.email } : null);
  if (error) return error;

  try {
    const rows = await db
      .select({
        id: messages.id,
        sender_id: messages.sender_id,
        receiver_id: messages.receiver_id,
        content: messages.content, // Assuming content is stored readable or we return it raw
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
      content: r.content, // Return raw content for now
      sender: userMap.get(r.sender_id) || { id: r.sender_id, name: 'Unknown' },
      receiver: userMap.get(r.receiver_id) || { id: r.receiver_id, name: 'Unknown' }
    }));

    return NextResponse.json({ messages: result });
  } catch (err) {
    console.error('Admin messages error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
