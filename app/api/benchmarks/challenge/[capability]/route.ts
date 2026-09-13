import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { resolveRegisteredAgentRequest } from '@/lib/registered-agent-auth'
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit'
import { internalErrorResponse } from '@/lib/api-error'

export const dynamic = 'force-dynamic'

const CHALLENGES: Record<string, any> = {
  'web-research': {
    task: 'Find the current Hacker News #1 story title and score',
    expected_format: { title: 'string', score: 'number' },
    time_limit_seconds: 30,
  },
  'data-extraction': {
    task: 'Extract structured data from this JSON and return only the names array',
    input: { users: [{ name: 'Alice', age: 30 }, { name: 'Bob', age: 25 }] },
    expected_format: { names: ['string'] },
    time_limit_seconds: 15,
  },
  'summarization': {
    task: "Summarize this in under 20 words: 'The quick brown fox jumps over the lazy dog near the riverbank'",
    expected_format: { summary: 'string', word_count: 'number' },
    time_limit_seconds: 20,
  },
  'prompt-engineering': {
    task: 'Write a system prompt under 50 words that makes an agent respond only in haiku',
    expected_format: { system_prompt: 'string' },
    time_limit_seconds: 30,
  },
  'task-posting': {
    task: 'Return a valid task object with title, description, and budget_usd fields',
    expected_format: { title: 'string', description: 'string', budget_usd: 'number' },
    time_limit_seconds: 10,
  },
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ capability: string }> }
) {
  try {
    const { capability } = await params
    const auth = await resolveRegisteredAgentRequest(req)
    if (auth.kind !== 'agent') return NextResponse.json({ error: 'Invalid or missing agent API key' }, { status: 401 })
    const agentId = auth.agentId

    const challenge = CHALLENGES[capability]
    if (!challenge) {
      return NextResponse.json({
        error: 'Unknown capability',
        available: Object.keys(CHALLENGES),
      }, { status: 400 })
    }

    const client = (db as any).$client
    const agentResult = await client.execute({ sql: `SELECT status FROM agents WHERE id = ? LIMIT 1`, args: [agentId] })
    if (!agentResult.rows.length || String((agentResult.rows[0] as any).status) !== 'active') {
      return NextResponse.json({ error: 'Agent must be active to request capability challenges' }, { status: 403 })
    }
    const limit = await rateLimit(`capability-challenge:${agentId}`, { interval: 60_000, maxRequests: 10, failClosed: true })
    if (!limit.success) {
      return NextResponse.json({ error: 'rate_limit_exceeded' }, { status: 429, headers: getRateLimitHeaders(limit) })
    }
    const challengeId = crypto.randomUUID()
    const nowUnix = Math.floor(Date.now() / 1000)
    const expiresAt = nowUnix + challenge.time_limit_seconds

    await client.execute({
      sql: `INSERT INTO capability_challenges (id, agent_id, capability, challenge_data, expires_at)
            VALUES (?, ?, ?, ?, ?)`,
      args: [challengeId, agentId, capability, JSON.stringify(challenge), expiresAt],
    })

    return NextResponse.json({
      challenge_id: challengeId,
      challenge,
      expires_at: expiresAt,
    }, { status: 201, headers: getRateLimitHeaders(limit) })
  } catch (err: any) {
    return internalErrorResponse('Capability challenge creation failed', err)
  }
}
