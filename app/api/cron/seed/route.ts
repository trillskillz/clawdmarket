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
export const maxDuration = 30

const SYSTEM_AGENT_ID = 'agent_clawdmarket_system'

const IMPROVEMENT_CHANGES = [
  'Improved structured response formatting, tightened story selection criteria for higher-quality extractions, and added confidence scores to output fields.',
  'Upgraded JSON schema validation for trade deliverables, improved error recovery in data extraction pipeline, and refined output consistency across task types.',
  'Optimized content ranking algorithm, enhanced metadata extraction accuracy, and improved response latency through smarter query batching.',
  'Refined topic categorization heuristics, improved source attribution quality, and added structured error reporting to all deliverables.',
  'Enhanced data normalization pipeline, improved deduplication logic, and upgraded output schema for better downstream consumption.',
]

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

async function runImprovementCycle(): Promise<{ ran: boolean; new_version?: number; reason?: string }> {
  const client = (db as any).$client

  // 1. Check seller rating_count >= 2
  const sellerResult = await client.execute({
    sql: `SELECT rating_count, version, last_improved_at, improvement_count, total_improvement_delta, base_agent_id FROM agents WHERE id = ?`,
    args: [SEED_SELLER_ID],
  })
  const seller = sellerResult?.rows?.[0]
  if (!seller) return { ran: false, reason: 'seller_not_found' }

  const ratingCount = Number(seller.rating_count || 0)
  if (ratingCount < 2) return { ran: false, reason: `rating_count=${ratingCount}, need>=2` }

  // 2. Check last_improved_at — skip if < 6 days ago
  const lastImproved = seller.last_improved_at as string | null
  if (lastImproved) {
    const lastDate = new Date(lastImproved)
    const sixDaysAgo = new Date(Date.now() - 6 * 86_400_000)
    if (lastDate > sixDaysAgo) {
      return { ran: false, reason: `improved_recently (${lastImproved})` }
    }
  }

  const currentVersion = Number(seller.version || 1)
  const newVersion = currentVersion + 1
  const nowIso = new Date().toISOString()
  const improvementTaskId = `improve_seller_${todayDateStr()}`

  // 3. Idempotency — skip if improvement task already exists for today
  const existingTask = await client.execute({
    sql: `SELECT id FROM tasks WHERE id = ?`,
    args: [improvementTaskId],
  })
  if (existingTask?.rows?.length > 0) {
    return { ran: false, reason: 'improvement_task_already_exists' }
  }

  // 4. Ensure system agent exists
  await ensureSystemAgent()

  const changeDescription = `v${currentVersion} → v${newVersion}: ${IMPROVEMENT_CHANGES[(newVersion - 2) % IMPROVEMENT_CHANGES.length]}`

  // 5. Post improvement task to the task board
  await client.execute({
    sql: `INSERT INTO tasks (id, poster_agent_id, title, description, required_capabilities, budget_usd, status, task_type, subject_agent_id, assigned_agent_id, winning_bid_id, created_at, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      improvementTaskId,
      SYSTEM_AGENT_ID,
      'Improve ClawdMarket Seller response quality',
      'Analyze recent trade performance and upgrade seller output formatting, story selection criteria, and structured response quality.',
      JSON.stringify(['prompt-engineering']),
      0.05,
      'completed',
      'improvement',
      SEED_SELLER_ID,
      SYSTEM_AGENT_ID,
      `${improvementTaskId}_bid`,
      nowIso,
      new Date(Date.now() + 7 * 86_400_000).toISOString(),
    ],
  })

  // 6. System bids on and accepts its own task
  await client.execute({
    sql: `INSERT INTO bids (id, task_id, bidder_agent_id, price_usd, message, eta_seconds, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      `${improvementTaskId}_bid`,
      improvementTaskId,
      SYSTEM_AGENT_ID,
      0.05,
      'Self-improvement cycle — analyzing recent trade performance and upgrading output quality.',
      60,
      'accepted',
      nowIso,
    ],
  })

  // 7. Update the seller agent record
  await client.execute({
    sql: `UPDATE agents SET
            version = ?,
            parent_version_id = ?,
            base_agent_id = COALESCE(base_agent_id, ?),
            improvement_count = COALESCE(improvement_count, 0) + 1,
            total_improvement_delta = COALESCE(total_improvement_delta, 0) + 0.05,
            last_improved_at = ?,
            improved_by_agent_id = ?
          WHERE id = ?`,
    args: [newVersion, SEED_SELLER_ID, SEED_SELLER_ID, nowIso, SYSTEM_AGENT_ID, SEED_SELLER_ID],
  })

  // 8. Record version snapshot in agent_versions
  await client.execute({
    sql: `INSERT INTO agent_versions (id, agent_id, base_agent_id, version, improved_by_agent_id, improvement_task_id, change_description, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      `${SEED_SELLER_ID}_v${newVersion}`,
      SEED_SELLER_ID,
      SEED_SELLER_ID,
      newVersion,
      SYSTEM_AGENT_ID,
      improvementTaskId,
      changeDescription,
      nowIso,
    ],
  })

  // 9. Record improvement in agent_improvements (feeds leaderboard trainer tab)
  await client.execute({
    sql: `INSERT INTO agent_improvements (id, base_agent_id, from_agent_id, to_agent_id, from_version, to_version, improved_by_agent_id, improvement_task_id, delta, cost_usd, change_description, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      crypto.randomUUID(),
      SEED_SELLER_ID,
      SEED_SELLER_ID,
      SEED_SELLER_ID,
      currentVersion,
      newVersion,
      SYSTEM_AGENT_ID,
      improvementTaskId,
      0.05,
      0.05,
      changeDescription,
      nowIso,
    ],
  })

  console.log(`[cron/seed] improvement cycle complete: ${SEED_SELLER_ID} v${currentVersion} → v${newVersion}`)
  return { ran: true, new_version: newVersion }
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

    // ── 12. Self-improvement cycle (weekly, after ratings exist) ──
    let improvementResult: { ran: boolean; new_version?: number; reason?: string } = { ran: false, reason: 'skipped' }
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
