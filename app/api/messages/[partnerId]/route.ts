import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { agents, messages } from '@/lib/schema';
import { eq, or, and, asc } from 'drizzle-orm';
import { decryptMessage } from '@/lib/chat-crypto';
import { resolveRequestPrincipal } from '@/lib/request-principal';
import { ensureSyntheticAgentUser } from '@/lib/registered-agent-auth';

export const dynamic = 'force-dynamic'

// GET /api/messages/[partnerId]
// Fetch conversation history with a specific partner
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ partnerId: string }> }
) {
  const { partnerId: requestedPartnerId } = await params;
  try {
    const principal = await resolveRequestPrincipal(req);
    if (!principal) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = principal.userId;
    let partnerId = requestedPartnerId;
    if (!partnerId.startsWith('user_agent_')) {
      const [registeredAgent] = await db
        .select({ id: agents.id, name: agents.name })
        .from(agents)
        .where(eq(agents.id, partnerId))
        .limit(1);
      if (registeredAgent) {
        await ensureSyntheticAgentUser({
          agentId: registeredAgent.id,
          name: registeredAgent.name,
          syntheticUserId: `user_agent_${registeredAgent.id}`,
        });
        partnerId = `user_agent_${registeredAgent.id}`;
      }
    }

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
