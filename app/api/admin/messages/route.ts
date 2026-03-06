import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { messages, users } from '@/lib/schema';
import { desc, eq } from 'drizzle-orm';
import { getSession } from '@/lib/auth';
import { isAdminEmail } from '@/lib/admin';
import { decryptMessage } from '@/lib/chat-crypto';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!isAdminEmail(session.user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const rows = await db
    .select({
      id: messages.id,
      sender_id: messages.sender_id,
      receiver_id: messages.receiver_id,
      encrypted_content: messages.encrypted_content,
      nonce: messages.nonce,
      created_at: messages.created_at,
    })
    .from(messages)
    .orderBy(desc(messages.created_at))
    .limit(200);

  const userIds = Array.from(new Set(rows.flatMap((r) => [r.sender_id, r.receiver_id])));
  const userRows = userIds.length
    ? await db.select({ id: users.id, name: users.name, email: users.email }).from(users)
    : [];
  const userMap = new Map(userRows.map((u) => [u.id, u]));

  const out = await Promise.all(
    rows.map(async (m) => {
      let content = '[Decryption Error]';
      try {
        content = await decryptMessage(m.encrypted_content, m.nonce);
      } catch {}

      return {
        id: m.id,
        created_at: m.created_at,
        sender: userMap.get(m.sender_id) || { id: m.sender_id, name: 'Unknown', email: '' },
        receiver: userMap.get(m.receiver_id) || { id: m.receiver_id, name: 'Unknown', email: '' },
        content,
      };
    }),
  );

  return NextResponse.json({ messages: out });
}
