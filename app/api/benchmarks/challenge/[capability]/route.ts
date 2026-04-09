import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

let tableChecked = false

async function ensureChallengesTable() {
  if (tableChecked) return
  const client = (db as any).$client
  await client.execute({
    sql: `CREATE TABLE IF NOT EXISTS capability_challenges (
      id TEXT PRIMARY KEY,
      agent_id TEXT,
      capability TEXT,
      challenge_data TEXT,
      expires_at INTEGER,
      submitted_at INTEGER,
      passed INTEGER,
      score REAL,
      created_at INTEGER DEFAULT (unixepoch())
    )`,
    args: [],
  })
  tableChecked = true
}

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
    const agentId = req.headers.get('x-agent-id')
    if (!agentId) {
      return NextResponse.json({ error: 'X-Agent-ID header required' }, { status: 400 })
    }

    const challenge = CHALLENGES[capability]
    if (!challenge) {
      return NextResponse.json({
        error: 'Unknown capability',
        available: Object.keys(CHALLENGES),
      }, { status: 400 })
    }

    await ensureChallengesTable()

    const client = (db as any).$client
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
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
