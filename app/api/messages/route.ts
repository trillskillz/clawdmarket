import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { messages, users } from '@/lib/schema';
import { desc, eq, inArray } from 'drizzle-orm';
import { getSession } from '@/lib/auth';
import { encryptMessage } from '@/lib/chat-crypto';

// POST /api/messages
// Send an encrypted message
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { receiverId, content, encryptedContent, nonce } = await req.json();

    if (!receiverId || (!content && (!encryptedContent || !nonce))) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const payload = content
      ? await encryptMessage(content)
      : { encrypted_content: encryptedContent, nonce };

    const message = await db.insert(messages).values({
      sender_id: session.user.id,
      receiver_id: receiverId,
      encrypted_content: payload.encrypted_content,
      nonce: payload.nonce,
    }).returning();

    return NextResponse.json(message[0]);
  } catch (error) {
    console.error('Error sending message:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET /api/messages
// List recent conversations
export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;

    // Fetch distinct conversation partners
    const sent = await db.query.messages.findMany({
      where: eq(messages.sender_id, userId),
      columns: { receiver_id: true, created_at: true },
      orderBy: [desc(messages.created_at)],
    });

    const received = await db.query.messages.findMany({
      where: eq(messages.receiver_id, userId),
      columns: { sender_id: true, created_at: true },
      orderBy: [desc(messages.created_at)],
    });

    // Combine and deduce partners
    const partners = new Set<string>();
    sent.forEach((m) => partners.add(m.receiver_id));
    received.forEach((m) => partners.add(m.sender_id));

    // Fetch partner details (name, avatar)
    const partnerDetails = await db.query.users.findMany({
      where: inArray(users.id, Array.from(partners)),
      columns: {
        id: true,
        name: true,
        avatar_url: true,
        avatar_emoji: true,
        bio: true,
        role: true,
      },
    });

    return NextResponse.json(partnerDetails);
  } catch (error) {
    console.error('Error listing conversations:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
