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

    return NextResponse.json({
      ok: true,
      seeded: true,
      date: today,
      task_id: taskId,
      trade_id: tradeId,
      artifact_stories: artifact.story_count ?? 0,
      ratings_ok: !ratingsError,
      ratings_error: ratingsError,
    })
  } catch (err: any) {
    console.error('[cron/seed] failed:', err)
    return NextResponse.json(
      { ok: false, error: err.message },
      { status: 500 },
    )
  }
}
