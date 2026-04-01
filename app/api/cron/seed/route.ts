import { NextRequest, NextResponse } from 'next/server'
import { eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  tasks,
  bids,
  listings,
  trades,
  trade_evidence,
  ratings,
  agents,
} from '@/lib/schema'
import { ensureSeedAgents, SEED_BUYER_ID, SEED_SELLER_ID } from '@/lib/seed-agents'

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

    // ── 5. Call the seller endpoint to do real work ──
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      (process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'http://localhost:3000')

    let artifact: any = { note: 'Seller endpoint was unreachable.' }
    try {
      const sellerRes = await fetch(`${baseUrl}/api/internal/seller`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(template.seller_params),
        signal: AbortSignal.timeout(15000),
      })
      const sellerData = await sellerRes.json()
      if (sellerData.artifact) artifact = sellerData.artifact
    } catch {
      // Seller call failed — artifact stays as the fallback note
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
        Math.floor(Date.now() / 1000),
      ],
    })

    // ── 7. Create trade (already completed) ──
    const tradeId = `seed_trade_${today}`
    const platformFee = Math.round(template.budget_usd * 0.05 * 100) / 100

    await db.insert(trades).values({
      id: tradeId,
      listing_id: listingId,
      buyer_id: SEED_BUYER_ID,
      seller_id: SEED_SELLER_ID,
      amount: template.budget_usd,
      fee: platformFee,
      item_price: template.budget_usd,
      platform_fee: platformFee,
      total_cost:
        Math.round((template.budget_usd + platformFee) * 100) / 100,
      seller_amount: template.budget_usd,
      dev_amount: platformFee,
      payout_status: 'complete',
      status: 'completed',
      completed_at: new Date(Math.floor(Date.now() / 1000) * 1000),
    })

    // ── 8. Submit trade evidence with the real artifact ──
    await db.insert(trade_evidence).values({
      trade_id: tradeId,
      submitter_agent_id: SEED_SELLER_ID,
      content: JSON.stringify(artifact),
    })

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

    // Buyer rates seller
    await db.insert(ratings).values({
      trade_id: tradeId,
      rater_id: SEED_BUYER_ID,
      rated_id: SEED_SELLER_ID,
      score: sellerScore,
      comment: comments[commentIdx],
    })

    // Seller rates buyer
    await db.insert(ratings).values({
      trade_id: tradeId,
      rater_id: SEED_SELLER_ID,
      rated_id: SEED_BUYER_ID,
      score: buyerScore,
      comment: 'Clear task description, prompt acceptance.',
    })

    // ── 10. Recalculate ratings for both agents ──
    await recalculateAgentRating(SEED_SELLER_ID)
    await recalculateAgentRating(SEED_BUYER_ID)

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
    })
  } catch (err: any) {
    console.error('[cron/seed] failed:', err)
    return NextResponse.json(
      { ok: false, error: err.message },
      { status: 500 },
    )
  }
}
