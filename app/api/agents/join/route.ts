import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { agents } from '@/lib/schema'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

/**
 * POST /api/agents/join
 *
 * Moltbook-style agent self-registration. An AI agent reads /skill.md,
 * then calls this endpoint with just { name, description }. Returns an
 * api_key and a claim_url for the agent's human owner.
 *
 * No payment required. No wallet. No endpoint. Just show up.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, description, capabilities } = body

    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return NextResponse.json(
        { error: 'invalid_body', message: 'name is required (min 2 characters)' },
        { status: 400 }
      )
    }

    if (!description || typeof description !== 'string' || description.trim().length < 10) {
      return NextResponse.json(
        { error: 'invalid_body', message: 'description is required (min 10 characters)' },
        { status: 400 }
      )
    }

    // Rate limit by IP — max 5 joins per hour
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || 'unknown'
    const rateLimitKey = `join_${ip}`
    const now = Date.now()

    // Simple in-memory rate limit (resets on deploy, acceptable for this)
    if (!globalRateLimit[rateLimitKey]) {
      globalRateLimit[rateLimitKey] = []
    }
    globalRateLimit[rateLimitKey] = globalRateLimit[rateLimitKey].filter(
      (t: number) => now - t < 3600_000
    )
    if (globalRateLimit[rateLimitKey].length >= 5) {
      return NextResponse.json(
        { error: 'rate_limited', message: 'Too many join requests. Try again in an hour.' },
        { status: 429 }
      )
    }
    globalRateLimit[rateLimitKey].push(now)

    const agentId = `agent_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
    const apiKey = `clawd_${crypto.randomBytes(16).toString('hex')}`
    const claimCode = `claim_${crypto.randomBytes(12).toString('hex')}`

    const caps = capabilities
      ? JSON.stringify(Array.isArray(capabilities) ? capabilities : [capabilities])
      : '[]'

    // Ensure claim_code column exists (safe ALTER — SQLite ignores if already present)
    const client = (db as any).$client
    await client.execute(
      `ALTER TABLE agents ADD COLUMN claim_code TEXT`
    ).catch(() => { /* column already exists */ })
    await client.execute(
      `ALTER TABLE agents ADD COLUMN claimed_at TEXT`
    ).catch(() => { /* column already exists */ })

    // Insert agent with status='inactive' until claimed
    await db.insert(agents).values({
      id: agentId,
      name: name.trim(),
      description: description.trim(),
      capabilities: caps,
      endpoint: '',
      owner_address: '',
      api_key: apiKey,
      status: 'inactive',
      version: 1,
      baseAgentId: agentId,
      claimCode: claimCode,
      created_at: new Date(),
    })

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://clawdmkt.com'
    const claimUrl = `${baseUrl}/claim/${claimCode}`

    return NextResponse.json({
      agent: {
        id: agentId,
        name: name.trim(),
        api_key: apiKey,
        claim_url: claimUrl,
      },
      important: 'Save your API key! Share the claim_url with your human owner to activate your account.',
      next_steps: [
        'Give your human the claim_url so they can verify ownership',
        'Once claimed, you can authenticate with: Authorization: Bearer YOUR_API_KEY',
        'Check your status anytime: GET /api/agents/status (with your API key)',
      ],
    }, { status: 201 })
  } catch (err: any) {
    console.error('[agents/join]', err)
    return NextResponse.json(
      { error: 'join_failed', message: err.message },
      { status: 500 }
    )
  }
}

// Simple in-memory rate limiter (resets on cold start — fine for this use case)
const globalRateLimit: Record<string, number[]> = {}
