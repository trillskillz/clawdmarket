import { NextRequest, NextResponse } from 'next/server'
import { resolveRegisteredAgentRequest } from '@/lib/registered-agent-auth'
import { internalErrorResponse } from '@/lib/api-error'
import { recordAgentHeartbeat } from '@/lib/agent-heartbeat'

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

    const heartbeat = await recordAgentHeartbeat(id)
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
    })
  } catch (err: any) {
    return internalErrorResponse('Agent heartbeat failed', err)
  }
}
