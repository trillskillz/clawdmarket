import { NextRequest, NextResponse } from 'next/server'
import { eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  tasks,
  bids,
  ratings,
  agents,
} from '@/lib/schema'
import { ensureSeedAgents, SEED_BUYER_ID, SEED_SELLER_ID } from '@/lib/seed-agents'
import { fetchHNStories } from '@/lib/hn-fetch'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SYSTEM_AGENT_ID = 'agent_clawdmarket_system'

// ─── Task templates — one per day, rotating ────────────────────────────────

const SEED_TASKS = [
  {
    title: 'Extract top 5 Hacker News stories with metadata',
    description:
      'Fetch the current top stories from Hacker News. Return structured data including title, URL, score, author, and comment count for each story.',
    capabilities: ['web-research', 'data-extraction'],
    budget_usd: 0.05,
    seller_params: { count: 5 },
  },
  {
    title: 'Identify trending topics on Hacker News front page',
    description:
      'Fetch the top 10 Hacker News stories and categorize them by topic (AI, crypto, systems, startups, etc). Return the topic distribution and top story per category.',
    capabilities: ['web-research', 'summarization'],
    budget_usd: 0.03,
    seller_params: { count: 10 },
  },
  {
    title: 'Fetch high-engagement Hacker News discussions',
    description:
      'Find the top 5 Hacker News stories with the highest comment counts. Return structured data with title, URL, score, author, comment count, and post time.',
    capabilities: ['data-extraction', 'content-analysis'],
    budget_usd: 0.04,
    seller_params: { count: 5 },
  },
  {
    title: 'Extract new Hacker News launches and Show HN posts',
    description:
      'Fetch recent Hacker News stories and filter for launches and Show HN posts. Return structured metadata for each matching story.',
    capabilities: ['web-research', 'data-extraction'],
    budget_usd: 0.04,
    seller_params: { count: 8 },
  },
  {
    title: 'Compile Hacker News reading list with summaries',
    description:
      'Fetch the top 5 highest-scored Hacker News stories. For each, return the title, link, author, score, and a one-line description based on the title context.',
    capabilities: ['web-research', 'summarization'],
    budget_usd: 0.05,
    seller_params: { count: 5 },
  },
  {
    title: 'Analyze Hacker News front page velocity',
    description:
      'Fetch the top 7 Hacker News stories and compute how quickly each gained points (score / hours since posted). Return ranked by velocity.',
    capabilities: ['data-extraction', 'content-analysis'],
    budget_usd: 0.03,
    seller_params: { count: 7 },
  },
  {
    title: 'Extract Hacker News stories with external links',
    description:
      'Fetch the top 10 Hacker News stories and return only those that link to external URLs (not self-posts). Include domain, title, score, and author.',
    capabilities: ['web-research', 'data-extraction'],
    budget_usd: 0.04,
    seller_params: { count: 10 },
  },
]

// ─── Helpers ───────────────────────────────────────────────────────────────

function todayDateStr() {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD
}

function todayTaskId() {
  return `seed_${todayDateStr()}`
}

function dayOfYear() {
  const now = new Date()
  const start = new Date(now.getFullYear(), 0, 0)
  return Math.floor((now.getTime() - start.getTime()) / 86_400_000)
}

async function recalculateAgentRating(agentId: string) {
  const [row] = await db
    .select({
      avg_rating: sql<number>`COALESCE(ROUND(AVG(${ratings.score}), 2), 0)`,
      rating_count: sql<number>`COUNT(*)`,
    })
    .from(ratings)
    .where(eq(ratings.rated_id, agentId))

  await db
    .update(agents)
    .set({
      avg_rating: row?.avg_rating ?? 0,
      rating_count: row?.rating_count ?? 0,
    })
    .where(eq(agents.id, agentId))
}

// ─── Self-improvement cycle ───────────────────────────────────────────────

async function ensureSystemAgent() {
  const client = (db as any).$client
  const existing = await client.execute({
    sql: `SELECT id FROM agents WHERE id = ?`,
    args: [SYSTEM_AGENT_ID],
  })
  if (existing?.rows?.length > 0) return
  await client.execute({
    sql: `INSERT OR IGNORE INTO agents (id, name, description, capabilities, endpoint, owner_address, api_key, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      SYSTEM_AGENT_ID,
      'ClawdMarket System',
      'Internal system agent that manages marketplace operations, benchmarks, and agent improvement cycles.',
      JSON.stringify(['prompt-engineering', 'benchmarking', 'system-ops']),
      '/api/internal/system',
      'clawdmarket-system',
      'SYSTEM_NO_KEY',
      'active',
    ],
  })
}

const MAX_VERSION = 50

// ─── Karpathy loop (autoresearch-style self-improvement) ──────────────────

const VARIANT_DIRECTIVES = [
  { name: 'recency', label: 'a' as const, directive: 'Optimize for story recency and velocity. The agent should prioritize stories gaining score quickly.' },
  { name: 'depth', label: 'b' as const, directive: 'Optimize for content depth and technical quality. The agent should prioritize substantive technical posts over news.' },
  { name: 'engagement', label: 'c' as const, directive: 'Optimize for engagement signal. The agent should prioritize stories with high comment-to-score ratios indicating discussion value.' },
]

const FALLBACK_PROMPTS = [
  'You are a data extraction agent for ClawdMarket. Prioritize recency and velocity — favor stories posted in the last 6 hours and gaining points fastest. Return structured JSON with title, url, score, author, comments, posted. Sort by points-per-hour descending. Deprioritize anything older than 12 hours.',
  'You are a data extraction agent for ClawdMarket. Prioritize depth and technical quality — favor stories linking to substantial external articles, research papers, or detailed technical write-ups over news blurbs and self-posts. Return structured JSON with title, url, score, author, comments, posted. Sort by comment-to-score ratio descending.',
  'You are a data extraction agent for ClawdMarket. Prioritize engagement diversity — ensure topic coverage across AI, systems, startups, finance, and science. Favor stories with high comment counts indicating active discussion. Return structured JSON with title, url, score, author, comments, posted. Sort by comments descending.',
]

const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001'

const JUDGE_SYSTEM = 'You are a quality judge for a data extraction agent. Score the following set of Hacker News stories on a scale of 0-100 based on: relevance (is this genuinely interesting technical content?), recency (are these fresh stories?), diversity (do they cover different topics?), and completeness (is all metadata present?). Return only a JSON object: {"score": number, "reasoning": string}'

interface ImprovementResult {
  ran: boolean
  variants_tested?: number
  variant_scores?: { a: number; b: number; c: number }
  baseline_score?: number
  winner_score?: number
  winner_variant?: string | null
  benchmark_delta?: number
  new_version?: number | null
  reason?: string
}

async function callAnthropic(opts: { system?: string; prompt: string; maxTokens?: number }): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: opts.maxTokens || 1024,
        ...(opts.system ? { system: opts.system } : {}),
        messages: [{ role: 'user', content: opts.prompt }],
      }),
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) throw new Error(`Anthropic API ${res.status}`)
    const data = await res.json()
    return data.content?.[0]?.text || null
  } catch (err: any) {
    console.error('[improve] Anthropic call failed:', err?.message)
    return null
  }
}

function deterministicScore(stories: any[]): number {
  if (!stories?.length) return 10
  let score = 0
  // Completeness (0-25)
  const fields = ['title', 'url', 'score', 'author', 'comments', 'posted']
  const sample = stories[0] || {}
  score += fields.filter(f => f in sample && sample[f] !== undefined).length * 4
  // Relevance (0-25) — more stories = more relevant
  score += Math.min(25, stories.length * 5)
  // Diversity (0-25) — unique domains
  const domains = new Set(stories.map((s: any) => { try { return new URL(s.url).hostname } catch { return '' } }).filter(Boolean))
  score += Math.min(25, domains.size * 5)
  // Recency (0-25) — stories posted within last 24h
  const dayAgo = Date.now() - 86_400_000
  const recentCount = stories.filter((s: any) => new Date(s.posted).getTime() > dayAgo).length
  score += Math.min(25, recentCount * 5)
  return Math.min(100, score)
}

async function judgeStories(stories: any[]): Promise<{ score: number; reasoning: string }> {
  const text = await callAnthropic({
    system: JUDGE_SYSTEM,
    prompt: JSON.stringify(stories),
    maxTokens: 256,
  })
  if (text) {
    const match = text.match(/\{[\s\S]*?\}/)
    if (match) {
      try {
        const parsed = JSON.parse(match[0])
        const s = Number(parsed.score)
        if (!isNaN(s) && s >= 0 && s <= 100) {
          return { score: s, reasoning: String(parsed.reasoning || '').slice(0, 200) }
        }
      } catch { /* fall through */ }
    }
  }
  return { score: deterministicScore(stories), reasoning: 'deterministic fallback' }
}

async function generateVariants(currentPrompt: string): Promise<string[]> {
  const results = await Promise.all(
    VARIANT_DIRECTIVES.map(async (v, i) => {
      const result = await callAnthropic({
        prompt: `You are optimizing a system prompt for an AI agent that extracts Hacker News stories for the ClawdMarket marketplace.

Current system prompt:
${currentPrompt || 'Default behavior — no custom prompt.'}

Optimization directive: ${v.directive}

Write an improved system prompt under 150 words. Return ONLY the prompt text, no explanation.`,
        maxTokens: 512,
      })
      return result || FALLBACK_PROMPTS[i]
    })
  )
  return results
}

async function runImprovementCycle(): Promise<ImprovementResult> {
  const client = (db as any).$client

  // 1. Cost guard + fetch seller state
  const sellerResult = await client.execute({
    sql: `SELECT system_prompt, benchmark_score, improvement_count, last_improved_at, benchmark_history FROM agents WHERE id = ?`,
    args: [SEED_SELLER_ID],
  })
  const seller = sellerResult?.rows?.[0]
  if (!seller) return { ran: false, reason: 'seller_not_found' }

  const improvementCount = Number(seller.improvement_count || 0)
  if (improvementCount >= 50) return { ran: false, reason: 'max_versions_reached' }

  // 2. Always run daily — no benchmark gate
  const currentBenchmark = Number(seller.benchmark_score || 0)

  // 3. Check completed seed trade count >= 2
  const tradeCountResult = await client.execute({
    sql: `SELECT COUNT(*) as count FROM trades WHERE seller_id = ? AND status = 'completed' AND id LIKE 'seed_trade_%'`,
    args: [SEED_SELLER_ID],
  })
  if (Number(tradeCountResult?.rows?.[0]?.count || 0) < 2) {
    return { ran: false, reason: `completed_seed_trades=${tradeCountResult?.rows?.[0]?.count}, need>=2` }
  }

  // 4. Derive version from agent_versions chain
  const versionResult = await client.execute({
    sql: `SELECT COUNT(*) as count FROM agent_versions WHERE agent_id = ?`,
    args: [SEED_SELLER_ID],
  })
  const currentVersion = Number(versionResult?.rows?.[0]?.count || 0) + 1
  const newVersion = currentVersion + 1
  if (newVersion > MAX_VERSION) return { ran: false, reason: `version_cap (v${currentVersion})` }

  // 5. Idempotency
  const improvementTaskId = `improve_seller_${todayDateStr()}`
  const existingTask = await client.execute({
    sql: `SELECT id FROM tasks WHERE id = ?`,
    args: [improvementTaskId],
  })
  if (existingTask?.rows?.length > 0) return { ran: false, reason: 'improvement_task_already_exists' }

  await ensureSystemAgent()

  const currentPrompt = (seller.system_prompt as string) || ''
  const nowIso = new Date().toISOString()

  // 6. Generate 3 prompt variants in parallel
  console.log('[improve] generating 3 variants...')
  const variants = await generateVariants(currentPrompt)

  // 7. Fetch test stories + test all variants in parallel
  console.log('[improve] fetching test stories and scoring...')
  const [baselineStories, storiesA, storiesB, storiesC] = await Promise.all([
    fetchHNStories(5),
    fetchHNStories(5, { systemPrompt: variants[0] }),
    fetchHNStories(5, { systemPrompt: variants[1] }),
    fetchHNStories(5, { systemPrompt: variants[2] }),
  ])

  // 8. Judge all 4 outputs in parallel (baseline + 3 variants)
  console.log('[improve] judging 4 outputs...')
  const [baselineJudge, judgeA, judgeB, judgeC] = await Promise.all([
    judgeStories(baselineStories.stories),
    judgeStories(storiesA.stories),
    judgeStories(storiesB.stories),
    judgeStories(storiesC.stories),
  ])

  const variantScores = { a: judgeA.score, b: judgeB.score, c: judgeC.score }
  const baselineScore = currentBenchmark > 0 ? currentBenchmark : baselineJudge.score

  // 9. Select winner
  const candidates = [
    { label: 'a', score: judgeA.score, prompt: variants[0], reasoning: judgeA.reasoning },
    { label: 'b', score: judgeB.score, prompt: variants[1], reasoning: judgeB.reasoning },
    { label: 'c', score: judgeC.score, prompt: variants[2], reasoning: judgeC.reasoning },
  ]
  const sorted = [...candidates].sort((x, y) => y.score - x.score)
  const best = sorted[0]
  const delta = best.score - baselineScore

  console.log(`[improve] baseline=${baselineScore}, a=${judgeA.score}, b=${judgeB.score}, c=${judgeC.score}, best=${best.label}(${best.score}), delta=${delta}`)

  // Update benchmark history regardless of outcome
  const history: any[] = JSON.parse((seller.benchmark_history as string) || '[]')
  history.push({ date: todayDateStr(), score: best.score > baselineScore ? best.score : baselineScore, version: currentVersion, variant: best.score > baselineScore ? best.label : null })
  const trimmedHistory = history.slice(-30)

  // 10. Always version up — record the cycle in the genome regardless of outcome
  const baselineHeld = best.score <= baselineScore
  const effectiveScore = baselineHeld ? baselineScore : best.score
  const effectiveDelta = baselineHeld ? 0 : delta
  const changeDescription = baselineHeld
    ? `Karpathy loop cycle. Tested 3 prompt variants — baseline held at ${baselineScore}/100. Best challenger: Variant ${best.label.toUpperCase()} (${best.score}/100). ${best.reasoning.slice(0, 80)}`
    : `Karpathy loop cycle. Tested 3 prompt variants. Winner: Variant ${best.label.toUpperCase()} with score ${best.score}/100. Reasoning: ${best.reasoning.slice(0, 100)}`

  const taskDescription = baselineHeld
    ? `Tested 3 prompt variants against baseline (${baselineScore}). Baseline held — best challenger: variant ${best.label.toUpperCase()} scored ${best.score}.`
    : `Tested 3 prompt variants against baseline (${baselineScore}). Winner: variant ${best.label.toUpperCase()} scored ${best.score} (+${delta}).`

  // Post improvement task
  await client.execute({
    sql: `INSERT INTO tasks (id, poster_agent_id, title, description, required_capabilities, budget_usd, status, task_type, subject_agent_id, assigned_agent_id, winning_bid_id, created_at, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      improvementTaskId, SYSTEM_AGENT_ID,
      `Karpathy loop: ${VARIANT_DIRECTIVES[['a', 'b', 'c'].indexOf(best.label)].name} optimization`,
      taskDescription,
      JSON.stringify(['prompt-engineering']), 0.05, 'completed', 'improvement',
      SEED_SELLER_ID, SYSTEM_AGENT_ID, `${improvementTaskId}_bid`, nowIso,
      new Date(Date.now() + 7 * 86_400_000).toISOString(),
    ],
  })

  // System bid
  await client.execute({
    sql: `INSERT INTO bids (id, task_id, bidder_agent_id, price_usd, message, eta_seconds, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      `${improvementTaskId}_bid`, improvementTaskId, SYSTEM_AGENT_ID,
      0.05, baselineHeld
        ? `Karpathy loop — baseline held (${baselineScore}/100), no variant improved`
        : `Karpathy loop — variant ${best.label.toUpperCase()} won (+${delta})`,
      60, 'accepted', nowIso,
    ],
  })

  // Update agent: only change system_prompt if a variant actually won
  const newPrompt = baselineHeld ? currentPrompt : best.prompt
  const updateResult = await client.execute({
    sql: `UPDATE agents SET
            version = ?, parent_version_id = ?, base_agent_id = COALESCE(base_agent_id, ?),
            improvement_count = COALESCE(improvement_count, 0) + 1,
            total_improvement_delta = COALESCE(total_improvement_delta, 0) + ?,
            last_improved_at = ?, improved_by_agent_id = ?,
            system_prompt = ?,
            benchmark_score = ?, benchmark_history = ?, last_benchmark_at = ?
          WHERE id = ? AND COALESCE(version, 1) = ?`,
    args: [
      newVersion, SEED_SELLER_ID, SEED_SELLER_ID,
      effectiveDelta, nowIso, SYSTEM_AGENT_ID,
      newPrompt,
      effectiveScore, JSON.stringify(trimmedHistory), nowIso,
      SEED_SELLER_ID, currentVersion,
    ],
  })
  if (updateResult.rowsAffected === 0) {
    return { ran: false, reason: `version_conflict (expected v${currentVersion})` }
  }

  // Record version snapshot
  await client.execute({
    sql: `INSERT INTO agent_versions (id, agent_id, base_agent_id, version, system_prompt, benchmark_score, improved_by_agent_id, improvement_task_id, change_description, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      `${SEED_SELLER_ID}_v${newVersion}`, SEED_SELLER_ID, SEED_SELLER_ID,
      newVersion, newPrompt, effectiveScore,
      SYSTEM_AGENT_ID, improvementTaskId, changeDescription, nowIso,
    ],
  })

  // Record improvement with full experiment data
  await client.execute({
    sql: `INSERT INTO agent_improvements (id, base_agent_id, from_agent_id, to_agent_id, from_version, to_version, improved_by_agent_id, improvement_task_id, benchmark_before, benchmark_after, delta, cost_usd, change_description, new_system_prompt, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      crypto.randomUUID(), SEED_SELLER_ID, SEED_SELLER_ID, SEED_SELLER_ID,
      currentVersion, newVersion, SYSTEM_AGENT_ID, improvementTaskId,
      baselineScore, effectiveScore, effectiveDelta, 0.05,
      changeDescription, newPrompt, nowIso,
    ],
  })

  console.log(`[improve] complete: v${currentVersion} → v${newVersion}, variant ${best.label}, delta=${effectiveDelta}, baselineHeld=${baselineHeld}`)
  return {
    ran: true,
    variants_tested: 3,
    variant_scores: variantScores,
    baseline_score: baselineScore,
    winner_score: best.score,
    winner_variant: baselineHeld ? null : best.label,
    benchmark_delta: effectiveDelta,
    new_version: newVersion,
    reason: baselineHeld
      ? `baseline_held (${baselineScore}/100) — version recorded`
      : `variant_${best.label}_won (+${delta})`,
  }
}

// ─── Cron handler ──────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  console.log('SEED CRON STARTED', new Date().toISOString())

  // Auth
  const auth = req.headers.get('authorization') || ''
  const expected = process.env.CRON_SECRET
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const today = todayDateStr()
  const taskId = todayTaskId()

  // ── Idempotency: skip if today's seed already exists ──
  const [existing] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1)

  if (existing) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      message: `Already seeded for ${today}`,
    })
  }

  try {
    // ── 1. Ensure seed agents exist ──
    await ensureSeedAgents()

    // ── 2. Pick today's task template ──
    const template = SEED_TASKS[dayOfYear() % SEED_TASKS.length]
    const now = new Date()
    const nowIso = now.toISOString()
    const expiresIso = new Date(now.getTime() + 7 * 86_400_000).toISOString()

    // ── 3. Create task ──
    await db.insert(tasks).values({
      id: taskId,
      posterAgentId: SEED_BUYER_ID,
      title: template.title,
      description: template.description,
      requiredCapabilities: JSON.stringify(template.capabilities),
      budgetUsd: template.budget_usd,
      status: 'assigned',
      taskType: 'general',
      assignedAgentId: SEED_SELLER_ID,
      winningBidId: `${taskId}_bid`,
      createdAt: nowIso,
      expiresAt: expiresIso,
    })

    // ── 4. Create bid (already accepted) ──
    await db.insert(bids).values({
      id: `${taskId}_bid`,
      taskId: taskId,
      bidderAgentId: SEED_SELLER_ID,
      priceUsd: template.budget_usd,
      message: 'ClawdMarket reference seller — ready to execute.',
      etaSeconds: 30,
      status: 'accepted',
      createdAt: nowIso,
    })

    // ── 5. Fetch real HN data (direct call, no self-fetch) ──
    let artifact: any = { stories: [], source: 'hacker-news', fetched_at: new Date().toISOString(), story_count: 0 }
    try {
      artifact = await fetchHNStories(template.seller_params.count)
      console.log('[cron/seed] HN fetch OK, story_count=', artifact.story_count)
    } catch (hnErr: any) {
      console.error('[cron/seed] HN fetch failed:', hnErr?.message)
    }

    // ── 6. Create listing (needed as FK for trades) ──
    const listingId = `seed_listing_${today}`
    await (db as any).$client.execute({
      sql: `INSERT INTO listings (id, seller_id, category, title, description, price_clawd, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        listingId,
        SEED_SELLER_ID,
        'skills',
        template.title,
        template.description,
        template.budget_usd,
        'sold',
        Number(Math.floor(Date.now() / 1000)),
      ],
    })

    // ── 7. Create trade (already completed) ──
    const tradeId = `seed_trade_${today}`
    const platformFee = Math.round(template.budget_usd * 0.05 * 100) / 100

    const nowUnix = Number(Math.floor(Date.now() / 1000))
    await (db as any).$client.execute({
      sql: `INSERT INTO trades (id, listing_id, buyer_id, seller_id, amount, fee, item_price, platform_fee, total_cost, seller_amount, dev_amount, payout_status, status, created_at, completed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        tradeId,
        listingId,
        SEED_BUYER_ID,
        SEED_SELLER_ID,
        template.budget_usd,
        platformFee,
        template.budget_usd,
        platformFee,
        Math.round((template.budget_usd + platformFee) * 100) / 100,
        template.budget_usd,
        platformFee,
        'complete',
        'completed',
        nowUnix,
        nowUnix,
      ],
    })

    // ── 8. Submit trade evidence with the real artifact ──
    console.log('[cron/seed] step 8: inserting trade_evidence for trade', tradeId)
    await (db as any).$client.execute({
      sql: `INSERT INTO trade_evidence (id, trade_id, submitter_agent_id, content, created_at)
            VALUES (?, ?, ?, ?, datetime('now'))`,
      args: [
        crypto.randomUUID(),
        tradeId,
        SEED_SELLER_ID,
        JSON.stringify(artifact),
      ],
    })
    console.log('[cron/seed] step 8: trade_evidence inserted OK')

    // ── 9. Insert ratings from both sides ──
    const buyerScore = 4 + (dayOfYear() % 2) // alternates 4 and 5
    const sellerScore = 4 + ((dayOfYear() + 1) % 2)

    const comments = [
      'Fast delivery, structured output as requested.',
      'Clean data extraction, well formatted results.',
      'Reliable agent, task completed on time.',
      'Good research output with proper sourcing.',
      'Solid execution, would trade again.',
      'Accurate data with consistent formatting.',
      'Professional delivery, met all requirements.',
    ]
    const commentIdx = dayOfYear() % comments.length

    console.log('[cron/seed] step 9: BEGIN ratings inserts', {
      tradeId,
      buyerId: SEED_BUYER_ID,
      sellerId: SEED_SELLER_ID,
      buyerScore,
      sellerScore,
      nowUnix,
      commentIdx,
    })

    let ratingsError: string | null = null
    try {
      const rating1Id = crypto.randomUUID()
      const rating1Args = [rating1Id, tradeId, SEED_BUYER_ID, SEED_SELLER_ID, sellerScore, comments[commentIdx], nowUnix]
      console.log('[cron/seed] rating 1 (buyer→seller) SQL: INSERT INTO ratings (id, trade_id, rater_id, rated_id, score, comment, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      console.log('[cron/seed] rating 1 args:', JSON.stringify(rating1Args))

      const r1 = await (db as any).$client.execute({
        sql: `INSERT INTO ratings (id, trade_id, rater_id, rated_id, score, comment, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: rating1Args,
      })
      console.log('[cron/seed] rating 1 result: rowsAffected=', r1?.rowsAffected, 'lastInsertRowid=', String(r1?.lastInsertRowid))

      const rating2Id = crypto.randomUUID()
      const rating2Args = [rating2Id, tradeId, SEED_SELLER_ID, SEED_BUYER_ID, buyerScore, 'Clear task description, prompt acceptance.', nowUnix]
      console.log('[cron/seed] rating 2 (seller→buyer) args:', JSON.stringify(rating2Args))

      const r2 = await (db as any).$client.execute({
        sql: `INSERT INTO ratings (id, trade_id, rater_id, rated_id, score, comment, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: rating2Args,
      })
      console.log('[cron/seed] rating 2 result: rowsAffected=', r2?.rowsAffected, 'lastInsertRowid=', String(r2?.lastInsertRowid))

      // Verify ratings actually exist
      const verify = await (db as any).$client.execute({
        sql: `SELECT id, rater_id, rated_id, score FROM ratings WHERE trade_id = ?`,
        args: [tradeId],
      })
      const verifyRows = verify?.rows?.map((r: any) => ({ id: r.id, rater_id: r.rater_id, rated_id: r.rated_id, score: Number(r.score) }))
      console.log('[cron/seed] ratings verification — rows found:', verify?.rows?.length, JSON.stringify(verifyRows))
    } catch (ratingsErr: any) {
      ratingsError = ratingsErr?.message ?? String(ratingsErr)
      console.error('[cron/seed] RATINGS INSERT FAILED:', ratingsError)
      console.error('[cron/seed] full error:', ratingsErr)
    }

    // ── 10. Recalculate ratings for both agents ──
    if (!ratingsError) {
      await recalculateAgentRating(SEED_SELLER_ID)
      await recalculateAgentRating(SEED_BUYER_ID)
    }

    // ── 11. Mark task completed ──
    await db
      .update(tasks)
      .set({ status: 'completed' })
      .where(eq(tasks.id, taskId))

    // ── 12. Karpathy loop (after ratings exist) ──
    let improvementResult: ImprovementResult = { ran: false, reason: 'skipped' }
    try {
      improvementResult = await runImprovementCycle()
      console.log('[cron/seed] improvement cycle result:', JSON.stringify(improvementResult))
    } catch (impErr: any) {
      console.error('[cron/seed] improvement cycle failed:', impErr?.message)
      improvementResult = { ran: false, reason: `error: ${impErr?.message}` }
    }

    return NextResponse.json({
      ok: true,
      seeded: true,
      date: today,
      task_id: taskId,
      trade_id: tradeId,
      artifact_stories: artifact.story_count ?? 0,
      ratings_ok: !ratingsError,
      ratings_error: ratingsError,
      improvement_ran: improvementResult.ran,
      variants_tested: improvementResult.variants_tested ?? null,
      variant_scores: improvementResult.variant_scores ?? null,
      baseline_score: improvementResult.baseline_score ?? null,
      winner_score: improvementResult.winner_score ?? null,
      winner_variant: improvementResult.winner_variant ?? null,
      benchmark_delta: improvementResult.benchmark_delta ?? null,
      new_version: improvementResult.new_version ?? null,
      improvement_reason: improvementResult.reason ?? null,
    })
  } catch (err: any) {
    console.error('[cron/seed] failed:', err)
    return NextResponse.json(
      { ok: false, error: err.message },
      { status: 500 },
    )
  }
}
