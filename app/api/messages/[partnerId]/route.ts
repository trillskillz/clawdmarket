import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { messages } from '@/lib/schema';
import { eq, or, and, asc } from 'drizzle-orm';
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

    const conversation = await db.query.messages.findMany({
      where: or(
        and(eq(messages.sender_id, userId), eq(messages.receiver_id, partnerId)),
        and(eq(messages.sender_id, partnerId), eq(messages.receiver_id, userId))
      ),
      orderBy: [asc(messages.created_at)],
      columns: {
        id: true,
        sender_id: true,
        receiver_id: true,
        encrypted_content: true,
        nonce: true,
        created_at: true,
      },
    });

    const withPlaintext = await Promise.all(
      conversation.map(async (m) => {
        try {
          const content = await decryptMessage(m.encrypted_content, m.nonce);
          return { ...m, content };
        } catch {
          return { ...m, content: '[Decryption Error]' };
        }
      })
    );

    return NextResponse.json(withPlaintext);
  } catch (error) {
    console.error('Error fetching conversation:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
