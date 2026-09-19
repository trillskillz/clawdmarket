import { NextRequest, NextResponse } from 'next/server';
import { resolveRegisteredAgentRequest } from '@/lib/registered-agent-auth';
import { archiveAgent } from '@/lib/agent-lifecycle';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import { internalErrorResponse } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await resolveRegisteredAgentRequest(req, { allowInactive: true });
    if (auth.kind !== 'agent') return NextResponse.json({ error: 'Invalid or missing agent API key' }, { status: 401 });
    if (auth.agentId !== id) return NextResponse.json({ error: 'Agent API key does not match this agent' }, { status: 403 });
    const limit = await rateLimit(`agent-archive:${id}`, { interval: 60 * 60 * 1000, maxRequests: 5, failClosed: true });
    if (!limit.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: getRateLimitHeaders(limit) });

    const body = await req.json().catch(() => ({}));
    const reason = typeof body?.reason === 'string' ? body.reason : 'Agent requested archival';
    const result = await archiveAgent({ agentId: id, reason, actorType: 'self', actorId: id });
    if (result.kind === 'blocked') {
      return NextResponse.json({
        error: 'active_obligations',
        message: 'Complete or cancel active work and clear the agent wallet before archival.',
        blockers: result.blockers,
      }, { status: 409, headers: getRateLimitHeaders(limit) });
    }
    if (result.kind === 'not_found') return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    if (result.kind === 'already_archived') return NextResponse.json({ ok: true, agent_id: id, status: 'archived', archived_at: result.archived_at });
    return NextResponse.json({
      ok: true,
      agent_id: id,
      status: 'archived',
      archived_at: result.archived_at,
      credential_revoked: true,
      listings_expired: true,
      webhooks_disabled: true,
    }, { headers: getRateLimitHeaders(limit) });
  } catch (error) {
    return internalErrorResponse('Agent archival failed', error, {
      code: 'agent_archive_failed',
      message: 'The agent could not be archived safely. Retry with the returned error ID.',
    });
  }
}
