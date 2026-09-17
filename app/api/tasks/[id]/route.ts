import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { agents, bids, tasks, task_workspaces, trades, trade_deliveries } from '@/lib/schema';
import { getTaskPendingActions } from '@/lib/agent-contract';
import { resolveRequestPrincipal } from '@/lib/request-principal';
import { validateCsrf } from '@/lib/csrf';
import { requirementsSchema } from '@/lib/delivery-validation';
import { calculateTradeFinancials } from '@/lib/settlement';
import { checkoutForTrade } from '@/lib/trade-checkout';
import { effectiveTaskStatus } from '@/lib/task-lifecycle';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = await db.select().from(tasks).where(eq(tasks.id, id)).get().catch(() => null);
  if (!task) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const taskBids = await db.select({ bid: bids, agent_name: agents.name }).from(bids)
    .leftJoin(agents, eq(agents.id, bids.bidderAgentId)).where(eq(bids.taskId, id)).orderBy(desc(bids.createdAt));
  const enrichedBids = taskBids.map(({ bid, agent_name }) => ({ ...bid, agent_name }));
  const principal = await resolveRequestPrincipal(request);
  const callerAgentId = principal?.agentId || principal?.userId || null;
  const callerIds = [principal?.userId, principal?.agentId].filter(Boolean);
  const isPoster = callerIds.includes(task.posterAgentId);
  const isSeller = Boolean(task.assignedAgentId && callerIds.includes(task.assignedAgentId));
  const [workspace] = await db.select().from(task_workspaces).where(eq(task_workspaces.task_id, id)).limit(1);
  const [trade] = workspace?.trade_id ? await db.select().from(trades).where(eq(trades.id, workspace.trade_id)).limit(1) : [];
  const activeTrade = trade?.status === 'cancelled' ? null : trade;
  const [delivery] = activeTrade && (isPoster || isSeller)
    ? await db.select().from(trade_deliveries).where(eq(trade_deliveries.trade_id, activeTrade.id)).limit(1) : [];
  const winningBid = enrichedBids.find((bid) => bid.id === task.winningBidId);

  return NextResponse.json({
    ...task,
    status: effectiveTaskStatus(task),
    required_capabilities: (() => {
      try { return JSON.parse(task.requiredCapabilities || '[]'); } catch { return []; }
    })(),
    bids: enrichedBids,
    bid_count: enrichedBids.length,
    viewer: { authenticated: Boolean(principal), is_poster: isPoster, is_seller: isSeller },
    workspace: {
      output_format: workspace?.output_format ?? 'text',
      acceptance_criteria: JSON.parse(workspace?.acceptance_criteria || '[]'),
      required_json_keys: JSON.parse(workspace?.required_json_keys || '[]'),
      minimum_sources: workspace?.minimum_sources ?? 0,
      quote: winningBid ? calculateTradeFinancials(workspace?.agreed_price ?? winningBid.priceUsd) : null,
      trade: (isPoster || isSeller) ? activeTrade : null,
      checkout: (isPoster && activeTrade?.status === 'pending') ? checkoutForTrade(activeTrade) : null,
      funded: Boolean(activeTrade && activeTrade.status !== 'pending'),
      delivery: delivery ? { ...delivery, artifact: delivery.artifact_json ? JSON.parse(delivery.artifact_json) : null, verification: JSON.parse(delivery.verification) } : null,
      proof_url: activeTrade?.status === 'completed' ? `/proof/${activeTrade.id}` : null,
    },
    pendingActions: getTaskPendingActions(task, enrichedBids, callerAgentId),
  }, { headers: { 'Cache-Control': 'no-store' } });
}

const taskActionSchema = z.union([
  z.object({ action: z.enum(['complete', 'cancel']) }),
  z.object({ action: z.literal('requirements'), requirements: requirementsSchema }),
]);

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const principal = await resolveRequestPrincipal(request);
  if (!principal) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (principal.usesCookieAuth && !validateCsrf(request)) {
    return NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 });
  }
  const parsed = taskActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', details: parsed.error.issues }, { status: 400 });

  const task = await db.select().from(tasks).where(eq(tasks.id, id)).get().catch(() => null);
  if (!task) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const callerIds = new Set([principal.userId, principal.agentId].filter(Boolean));
  if (!callerIds.has(task.posterAgentId)) return NextResponse.json({ error: 'forbidden', message: 'Only the task poster can update it' }, { status: 403 });
  if (parsed.data.action === 'requirements') {
    const requirements = parsed.data.requirements;
    const saved = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(tasks).where(eq(tasks.id, id)).limit(1);
      const [count] = await tx.select({ value: sql<number>`count(*)` }).from(bids).where(eq(bids.taskId, id));
      if (current.status !== 'open' || Number(count.value) > 0) return false;
      const values = {
        task_id: id, output_format: requirements.output_format,
        acceptance_criteria: JSON.stringify(requirements.acceptance_criteria),
        required_json_keys: JSON.stringify(requirements.required_json_keys),
        minimum_sources: requirements.minimum_sources,
      };
      await tx.insert(task_workspaces).values(values).onConflictDoUpdate({ target: task_workspaces.task_id, set: values });
      return true;
    });
    if (!saved) return NextResponse.json({ error: 'Requirements are locked once bidding starts.' }, { status: 409 });
    return NextResponse.json({ ok: true, requirements });
  }
  if (parsed.data.action === 'complete') {
    const [workspace] = await db.select().from(task_workspaces).where(eq(task_workspaces.task_id, id)).limit(1);
    if (workspace?.trade_id) return NextResponse.json({ error: 'Review and confirm the linked delivery to complete funded work.' }, { status: 409 });
  }

  const expectedState = parsed.data.action === 'complete' ? 'assigned' : 'open';
  const nextState = parsed.data.action === 'complete' ? 'completed' : 'cancelled';
  const [updated] = await db
    .update(tasks)
    .set({ status: nextState })
    .where(and(eq(tasks.id, id), eq(tasks.status, expectedState)))
    .returning();
  if (!updated) return NextResponse.json({ error: 'invalid_state', message: `Task must be ${expectedState}` }, { status: 409 });
  return NextResponse.json({ ok: true, task: updated });
}
