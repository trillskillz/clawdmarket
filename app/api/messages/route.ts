import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { messages, users } from '@/lib/schema';
import { desc, eq, inArray, and, or } from 'drizzle-orm';
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

    const partnerIds = Array.from(partners);
    if (partnerIds.length === 0) {
      return NextResponse.json([]);
    }

    // Fetch partner details (name, avatar)
    const partnerDetails = await db.query.users.findMany({
      where: inArray(users.id, partnerIds),
      columns: {
        id: true,
        name: true,
        avatar_url: true,
        avatar_emoji: true,
        bio: true,
        role: true,
      },
    });

    // Sort by most recent interaction (sent or received)
    const latestByPartner = new Map<string, number>();
    sent.forEach((m) => {
      const ts = new Date(m.created_at).getTime();
      latestByPartner.set(m.receiver_id, Math.max(ts, latestByPartner.get(m.receiver_id) ?? 0));
    });
    received.forEach((m) => {
      const ts = new Date(m.created_at).getTime();
      latestByPartner.set(m.sender_id, Math.max(ts, latestByPartner.get(m.sender_id) ?? 0));
    });

    const sortedPartners = [...partnerDetails].sort(
      (a, b) => (latestByPartner.get(b.id) ?? 0) - (latestByPartner.get(a.id) ?? 0)
    );

    // Attach lightweight conversation metadata (last message sender/time)
    const partnersWithMeta = await Promise.all(
      sortedPartners.map(async (partner) => {
        const [lastMessage] = await db.query.messages.findMany({
          where: or(
            and(eq(messages.sender_id, userId), eq(messages.receiver_id, partner.id)),
            and(eq(messages.sender_id, partner.id), eq(messages.receiver_id, userId))
          ),
          orderBy: [desc(messages.created_at)],
          limit: 1,
          columns: {
            sender_id: true,
            created_at: true,
            encrypted_content: true,
          },
        });

        return {
          ...partner,
          last_message_at: lastMessage?.created_at ?? null,
          last_message_sender_id: lastMessage?.sender_id ?? null,
          last_message_preview: lastMessage?.encrypted_content ? 'Encrypted message' : null,
        };
      })
    );

    return NextResponse.json(partnersWithMeta);
  } catch (error) {
    console.error('Error listing conversations:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
