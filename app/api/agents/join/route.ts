import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

let columnsEnsured = false
async function ensureColumns(client: any) {
  if (columnsEnsured) return
  await client.execute(`ALTER TABLE agents ADD COLUMN claim_code TEXT`).catch(() => {})
  await client.execute(`ALTER TABLE agents ADD COLUMN claimed_at TEXT`).catch(() => {})
  await client.execute(`ALTER TABLE agents ADD COLUMN api_key TEXT`).catch(() => {})
  columnsEnsured = true
}

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
    const claimCode = `claim_${crypto.randomBytes(16).toString('hex')}`

    const caps = capabilities
      ? JSON.stringify(Array.isArray(capabilities) ? capabilities : [capabilities])
      : '[]'

    const client = (db as any).$client
    const nowIso = new Date().toISOString()

    await ensureColumns(client)

    // Use raw SQL matching the actual production table structure
    // Production agents table uses TEXT for created_at and has no api_key column by default
    await client.execute({
      sql: `INSERT INTO agents (id, name, description, capabilities, endpoint, owner_address, status, version, base_agent_id, rating_count, benchmark_count, benchmark_history, improvement_count, total_improvement_delta, claim_code, api_key, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        agentId,
        name.trim(),
        description.trim(),
        caps,
        '',
        '',
        'inactive',
        1,
        agentId,
        0,
        0,
        '[]',
        0,
        0,
        claimCode,
        apiKey,
        nowIso,
      ],
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

const globalRateLimit: Record<string, number[]> = {}
