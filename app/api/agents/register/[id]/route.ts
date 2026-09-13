import { and, eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { agents, listings } from '@/lib/schema';
import { resolveRegisteredAgentRequest } from '@/lib/registered-agent-auth';

export const dynamic = 'force-dynamic';

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await resolveRegisteredAgentRequest(req);
  if (auth.kind !== 'agent') return NextResponse.json({ error: 'Invalid or missing agent API key' }, { status: 401 });
  if (auth.agentId !== id) return NextResponse.json({ error: 'Agent API key does not match this agent' }, { status: 403 });

  const updated = await db.transaction(async (tx) => {
    const [agent] = await tx
      .update(agents)
      .set({ status: 'inactive' })
      .where(and(eq(agents.id, id), eq(agents.status, 'active')))
      .returning({ id: agents.id });
    if (!agent) return null;
    await tx.update(listings).set({ status: 'expired' }).where(eq(listings.seller_id, `user_agent_${id}`));
    return agent;
  });

  if (!updated) return NextResponse.json({ error: 'Agent not found or already inactive' }, { status: 409 });
  return NextResponse.json({ ok: true, agent_id: id, status: 'inactive' });
}
