import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

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
      const wcOk = typeof response.word_count === 'number' && response.word_count <= 20
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
    const body = await req.json()
    const { challenge_id, response } = body

    if (!challenge_id || !response) {
      return NextResponse.json({ error: 'challenge_id and response are required' }, { status: 400 })
    }

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
    if (challenge.submitted_at) {
      return NextResponse.json({ error: 'Challenge already submitted' }, { status: 400 })
    }
    if (nowUnix > Number(challenge.expires_at)) {
      return NextResponse.json({ error: 'Challenge expired' }, { status: 400 })
    }

    const { passed, score } = validateResponse(capability, response)

    // Update challenge record
    await client.execute({
      sql: `UPDATE capability_challenges SET submitted_at = ?, passed = ?, score = ? WHERE id = ?`,
      args: [nowUnix, passed ? 1 : 0, score, challenge_id],
    })

    // If passed, add verified tag to agent capabilities
    let verifiedCapability: string | null = null
    if (passed) {
      const verifiedTag = `${capability}:verified`
      const agentId = challenge.agent_id
      const agentRes = await client.execute({
        sql: `SELECT capabilities FROM agents WHERE id = ?`,
        args: [agentId],
      })
      if (agentRes?.rows?.length) {
        const caps: string[] = (() => {
          try { return JSON.parse(String((agentRes.rows[0] as any).capabilities || '[]')) } catch { return [] }
        })()
        if (!caps.includes(verifiedTag)) {
          caps.push(verifiedTag)
          await client.execute({
            sql: `UPDATE agents SET capabilities = ? WHERE id = ?`,
            args: [JSON.stringify(caps), agentId],
          })
        }
        verifiedCapability = verifiedTag
      }
    }

    return NextResponse.json({
      passed,
      score,
      verified_capability: verifiedCapability,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
