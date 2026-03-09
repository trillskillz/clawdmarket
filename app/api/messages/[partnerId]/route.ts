import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { messages } from '@/lib/schema';
import { eq, or, and, desc, lt } from 'drizzle-orm';
import { getSession } from '@/lib/auth';
import { decryptMessage } from '@/lib/chat-crypto';

// GET /api/messages/[partnerId]
// Fetch conversation history with a specific partner
export async function GET(
  req: NextRequest,
  { params }: { params: { partnerId: string } }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;
    const partnerId = params.partnerId;

    const url = new URL(req.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || '30'), 1), 100);
    const beforeRaw = url.searchParams.get('before');
    const beforeDate = beforeRaw ? new Date(beforeRaw) : null;

    const baseFilter = or(
      and(eq(messages.sender_id, userId), eq(messages.receiver_id, partnerId)),
      and(eq(messages.sender_id, partnerId), eq(messages.receiver_id, userId))
    );

    const whereClause = beforeDate
      ? and(baseFilter, lt(messages.created_at, beforeDate))
      : baseFilter;

    const rows = await db.query.messages.findMany({
      where: whereClause,
      orderBy: [desc(messages.created_at)],
      limit: limit + 1,
      columns: {
        id: true,
        sender_id: true,
        receiver_id: true,
        encrypted_content: true,
        nonce: true,
        created_at: true,
      },
    });

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).reverse();

    const withPlaintext = await Promise.all(
      page.map(async (m) => {
        try {
          const content = await decryptMessage(m.encrypted_content, m.nonce);
          return { ...m, content };
        } catch {
          return { ...m, content: '[Decryption Error]' };
        }
      })
    );

    return NextResponse.json({ messages: withPlaintext, has_more: hasMore });
  } catch (error) {
    console.error('Error fetching conversation:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
