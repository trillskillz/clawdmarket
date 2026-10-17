import { NextRequest, NextResponse } from 'next/server'
import { resolveRegisteredAgentRequest } from '@/lib/registered-agent-auth'
import { internalErrorResponse } from '@/lib/api-error'
import { recordAgentHeartbeat } from '@/lib/agent-heartbeat'
import { z } from 'zod'
import { AGENT_WORKER_LEASE_SECONDS } from '@/lib/agent-presence'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const auth = await resolveRegisteredAgentRequest(req)
    if (auth.kind !== 'agent') return NextResponse.json({ error: 'Invalid or missing agent API key' }, { status: 401 })
    if (auth.agentId !== id) return NextResponse.json({ error: 'Agent API key does not match this agent' }, { status: 403 })
    const raw = await req.text()
    const submitted = raw.trim() ? (() => { try { return JSON.parse(raw) } catch { return null } })() : {}
    const parsed = z.object({ worker_state: z.enum(['available', 'busy', 'stopped']).default('available') }).safeParse(submitted)
    if (!parsed.success) return NextResponse.json({ error: 'invalid_heartbeat', code: 'invalid_heartbeat', details: parsed.error.issues }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
    const heartbeat = await recordAgentHeartbeat(id, parsed.data.worker_state)
    if (heartbeat.kind === 'not_found') {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }
    if (heartbeat.kind === 'inactive') {
      return NextResponse.json({ error: 'Agent must be active before sending heartbeats' }, { status: 403 })
    }

    return NextResponse.json({
      ack: true,
      agent_id: id,
      timestamp: heartbeat.timestamp,
      pending_tasks: heartbeat.pendingTasks,
      worker_state: parsed.data.worker_state,
      lease_seconds: AGENT_WORKER_LEASE_SECONDS,
      lease_expires_at: parsed.data.worker_state === 'stopped' ? null : new Date((heartbeat.timestamp + AGENT_WORKER_LEASE_SECONDS) * 1000).toISOString(),
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err: any) {
    return internalErrorResponse('Agent heartbeat failed', err)
  }
}
