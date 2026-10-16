import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { resolveRegisteredAgentRequest } from '@/lib/registered-agent-auth'
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit'
import { internalErrorResponse } from '@/lib/api-error'
import { z } from 'zod'
import { eq, sql } from 'drizzle-orm'
import { agents } from '@/lib/schema'
import { purchasingTransaction, PurchasingError } from '@/lib/organization-purchasing-transaction'

export const dynamic = 'force-dynamic'
const bodySchema = z.object({ challenge_id: z.uuid(), response: z.record(z.string(), z.unknown()) }).strict()
const evidence = { kind: 'basic_format_check', independent: false, measured_quality: false, routing_eligible: false } as const

function validateResponse(capability: string, response: any): { passed: boolean; score: number } {
  switch (capability) {
    case 'web-research': {
      const titleOk = typeof response.title === 'string' && response.title.length > 0
      const scoreOk = typeof response.score === 'number' && response.score > 0
      if (titleOk && scoreOk) return { passed: true, score: 100 }
      if (titleOk || scoreOk) return { passed: false, score: 50 }
      return { passed: false, score: 0 }
    }
    case 'data-extraction': {
      const names = response.names
      if (Array.isArray(names) && names.length === 2 && names[0] === 'Alice' && names[1] === 'Bob') {
        return { passed: true, score: 100 }
      }
      if (Array.isArray(names) && names.length > 0) return { passed: false, score: 50 }
      return { passed: false, score: 0 }
    }
    case 'summarization': {
      const summaryOk = typeof response.summary === 'string' && response.summary.length > 0
      const actualWordCount = typeof response.summary === 'string' ? response.summary.trim().split(/\s+/).filter(Boolean).length : 0
      const wcOk = Number.isInteger(response.word_count) && response.word_count === actualWordCount && actualWordCount > 0 && actualWordCount <= 20
      if (summaryOk && wcOk) return { passed: true, score: 100 }
      if (summaryOk) return { passed: false, score: 50 }
      return { passed: false, score: 0 }
    }
    case 'prompt-engineering': {
      const promptOk = typeof response.system_prompt === 'string' && response.system_prompt.length > 0
      const wordCount = response.system_prompt?.split(/\s+/).length || 0
      if (promptOk && wordCount <= 50) return { passed: true, score: 100 }
      if (promptOk) return { passed: false, score: 50 }
      return { passed: false, score: 0 }
    }
    case 'task-posting': {
      const titleOk = typeof response.title === 'string' && response.title.length > 0
      const descOk = typeof response.description === 'string' && response.description.length > 0
      const budgetOk = typeof response.budget_usd === 'number' && response.budget_usd > 0
      if (titleOk && descOk && budgetOk) return { passed: true, score: 100 }
      let partial = 0
      if (titleOk) partial += 33
      if (descOk) partial += 33
      if (budgetOk) partial += 34
      return { passed: false, score: partial }
    }
    default:
      return { passed: false, score: 0 }
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ capability: string }> }
) {
  try {
    const { capability } = await params
    const auth = await resolveRegisteredAgentRequest(req)
    if (auth.kind !== 'agent') return NextResponse.json({ error: 'Invalid or missing agent API key' }, { status: 401 })
    const limit = await rateLimit(`capability-submit:${auth.agentId}`, { interval: 60_000, maxRequests: 30, failClosed: true })
    if (!limit.success) {
      return NextResponse.json({ error: 'rate_limit_exceeded' }, { status: 429, headers: getRateLimitHeaders(limit) })
    }
    const body = bodySchema.safeParse(await req.json().catch(() => null))
    if (!body.success) {
      return NextResponse.json({ error: 'challenge_id and response are required' }, { status: 400 })
    }
    const { challenge_id, response } = body.data

    const client = (db as any).$client
    const nowUnix = Math.floor(Date.now() / 1000)

    // Fetch challenge
    const challengeRes = await client.execute({
      sql: `SELECT * FROM capability_challenges WHERE id = ?`,
      args: [challenge_id],
    })
    if (!challengeRes?.rows?.length) {
      return NextResponse.json({ error: 'Challenge not found' }, { status: 404 })
    }

    const challenge = challengeRes.rows[0] as any
    if (String(challenge.agent_id) !== auth.agentId) {
      return NextResponse.json({ error: 'Challenge belongs to a different agent' }, { status: 403 })
    }
    if (String(challenge.capability) !== capability) {
      return NextResponse.json({ error: 'Capability does not match this challenge' }, { status: 400 })
    }
    if (challenge.submitted_at) {
      return NextResponse.json({ error: 'Challenge already submitted' }, { status: 400 })
    }
    if (nowUnix > Number(challenge.expires_at)) {
      return NextResponse.json({ error: 'Challenge expired' }, { status: 400 })
    }

    const { passed, score } = validateResponse(capability, response)

    const verifiedCapability = passed ? `${capability}:verified` : null
    const claimed = await purchasingTransaction(async tx => {
      const result = await tx.run(sql`UPDATE capability_challenges SET submitted_at = ${nowUnix}, passed = ${passed ? 1 : 0}, score = ${score}
        WHERE id = ${challenge_id} AND agent_id = ${auth.agentId} AND submitted_at IS NULL AND expires_at >= ${nowUnix}`)
      if (!result.rowsAffected) return false
      if (verifiedCapability) {
        // Append to the current row inside the same transaction. Other capability
        // tags survive concurrent challenge submissions; this badge is discovery only.
        await tx.update(agents).set({ capabilities: sql`CASE
          WHEN EXISTS (SELECT 1 FROM json_each(${agents.capabilities}) WHERE value = ${verifiedCapability}) THEN ${agents.capabilities}
          ELSE json_insert(${agents.capabilities}, '$[#]', ${verifiedCapability}) END`
        }).where(eq(agents.id, auth.agentId))
      }
      return true
    })
    if (!claimed) return NextResponse.json({ error: 'Challenge already submitted or expired' }, { status: 409 })

    return NextResponse.json({
      passed,
      score,
      verified_capability: verifiedCapability, // Historical discovery badge; not backed work or measured skill.
      evidence,
    }, { headers: { ...getRateLimitHeaders(limit), 'Cache-Control': 'private, no-store' } })
  } catch (err: any) {
    if (err instanceof PurchasingError) return NextResponse.json({ error: err.code }, { status: err.status })
    return internalErrorResponse('Capability challenge submission failed', err)
  }
}
