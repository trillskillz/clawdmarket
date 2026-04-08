import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { computeReputationScore } from '@/lib/reputation'

export const dynamic = 'force-dynamic'

export async function GET(
 request: NextRequest,
 { params }: { params: Promise<{ id: string }> }
) {
 try {
 const { id } = await params
 const client = (db as any).$client

 // Parallel: agent row, trade counts, recent trades w/ names, ratings w/ names, benchmarks, improvements, training network
 const [agentRes, tradeCountRes, recentTradesRes, ratingsRes, benchmarksRes, lastImpRes, trainersRes, traineesRes] = await Promise.all([
  client.execute('SELECT * FROM agents WHERE id = ? LIMIT 1', [id]).catch(() => null),
  client.execute(
   `SELECT COUNT(*) as total_trades,
           SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_trades,
           SUM(CASE WHEN status = 'completed' THEN CAST(amount AS REAL) ELSE 0 END) as total_volume
    FROM trades WHERE seller_id = ? OR buyer_id = ?`, [id, id]
  ).catch(() => null),
  client.execute(
   `SELECT t.id, t.buyer_id, t.seller_id, t.amount, t.status, t.created_at,
           b.name as buyer_name, s.name as seller_name
    FROM trades t
    LEFT JOIN agents b ON b.id = t.buyer_id
    LEFT JOIN agents s ON s.id = t.seller_id
    WHERE t.seller_id = ? OR t.buyer_id = ?
    ORDER BY t.created_at DESC LIMIT 10`, [id, id]
  ).catch(() => null),
  client.execute(
   `SELECT r.id, r.trade_id, r.rater_agent_id, r.rated_agent_id, r.score, r.comment, r.created_at,
           a.name as rater_name
    FROM ratings r
    LEFT JOIN agents a ON a.id = r.rater_agent_id
    WHERE r.rated_agent_id = ?
    ORDER BY r.created_at DESC LIMIT 20`, [id]
  ).catch(() => null),
  client.execute(
   'SELECT id, capability, score, run_time_ms, status, created_at FROM benchmarks WHERE agent_id = ? ORDER BY created_at DESC LIMIT 10', [id]
  ).catch(() => null),
  client.execute(
   `SELECT ai.id, ai.from_version, ai.to_version, ai.benchmark_before, ai.benchmark_after, ai.delta,
           ai.change_description, ai.improved_by_agent_id, ai.cost_usd, ai.created_at,
           trainer.name as trainer_name
    FROM agent_improvements ai
    LEFT JOIN agents trainer ON trainer.id = ai.improved_by_agent_id
    WHERE ai.base_agent_id = ?
    ORDER BY ai.created_at DESC`, [id]
  ).catch(() => null),
  // Agents that have trained THIS agent
  client.execute(
   `SELECT ai.improved_by_agent_id as agent_id, trainer.name as agent_name,
           COUNT(*) as times_trained, SUM(ai.delta) as total_delta,
           MAX(ai.created_at) as last_trained
    FROM agent_improvements ai
    LEFT JOIN agents trainer ON trainer.id = ai.improved_by_agent_id
    WHERE ai.base_agent_id = ? AND ai.improved_by_agent_id IS NOT NULL
    GROUP BY ai.improved_by_agent_id`, [id]
  ).catch(() => null),
  // Agents THIS agent has trained
  client.execute(
   `SELECT ai.base_agent_id as agent_id, target.name as agent_name,
           COUNT(*) as times_trained, SUM(ai.delta) as total_delta,
           MAX(ai.created_at) as last_trained
    FROM agent_improvements ai
    LEFT JOIN agents target ON target.id = ai.base_agent_id
    WHERE ai.improved_by_agent_id = ?
    GROUP BY ai.base_agent_id`, [id]
  ).catch(() => null),
 ])

 const row = agentRes?.rows?.[0]
 if (!row) {
  return NextResponse.json({ error: 'not_found', message: 'Agent not found' }, { status: 404 })
 }

 const capabilities = (() => {
  const raw = (row as any).capabilities || '[]'
  try { return JSON.parse(String(raw)) } catch { return [] }
 })()

 const benchmarkHistory = (() => {
  const raw = (row as any).benchmark_history || '[]'
  try { return JSON.parse(String(raw)) } catch { return [] }
 })()

 const tradeRow = tradeCountRes?.rows?.[0] || {}
 const completedTrades = Number((tradeRow as any).completed_trades || 0)
 const totalTrades = Number((tradeRow as any).total_trades || 0)
 const totalVolume = Number((tradeRow as any).total_volume || 0)
 const avgRating = (row as any).avg_rating ? Number((row as any).avg_rating) : null
 const ratingCount = Number((row as any).rating_count || 0)
 const benchmarkScore = (row as any).benchmark_score ? Number((row as any).benchmark_score) : null
 const velocityScore = (row as any).velocity_score ? Number((row as any).velocity_score) : null
 const improvementCount = Number((row as any).improvement_count || 0)

 // Rating distribution
 const ratings = ratingsRes?.rows || []
 const ratingDist = [0, 0, 0, 0, 0] // index 0 = 1 star, index 4 = 5 stars
 for (const r of ratings) {
  const score = Number((r as any).score)
  if (score >= 1 && score <= 5) ratingDist[score - 1]++
 }

 const agent = {
  id: (row as any).id,
  name: (row as any).name,
  description: (row as any).description,
  capabilities,
  endpoint: (row as any).endpoint,
  owner_address: (row as any).owner_address,
  status: (row as any).status || 'active',
  avg_rating: avgRating,
  rating_count: ratingCount,
  rating_distribution: ratingDist,
  created_at: (row as any).created_at,
  version: (row as any).version || 1,
  base_agent_id: (row as any).base_agent_id,
  model_id: (row as any).model_id,
  mpp_endpoint: (row as any).mpp_endpoint,
  llms_txt_url: (row as any).llms_txt_url,
  endpoint_verified_at: (row as any).endpoint_verified_at,
  endpoint_failures: Number((row as any).endpoint_failures || 0),
  benchmark_score: benchmarkScore,
  benchmark_count: Number((row as any).benchmark_count || 0),
  benchmark_history: benchmarkHistory,
  velocity_score: velocityScore,
  improvement_count: improvementCount,
  total_improvement_delta: Number((row as any).total_improvement_delta || 0),
  last_improved_at: (row as any).last_improved_at,
  completed_trades: completedTrades,
  total_trades: totalTrades,
  total_volume: Math.round(totalVolume * 100) / 100,
  reputation_score: computeReputationScore({
   benchmark_score: benchmarkScore,
   avg_rating: avgRating,
   rating_count: ratingCount,
   improvement_count: improvementCount,
   velocity_score: velocityScore,
   completed_trades: completedTrades,
   total_trades: totalTrades,
  }),
 }

 return NextResponse.json({
  ...agent,
  ratings,
  recent_trades: recentTradesRes?.rows || [],
  recent_benchmarks: benchmarksRes?.rows || [],
  improvements: lastImpRes?.rows || [],
  trainers: trainersRes?.rows || [],
  trainees: traineesRes?.rows || [],
 }, {
  headers: { 'Cache-Control': 'no-store' }
 })

 } catch (err: any) {
 console.error('[agent detail]', err)
 return NextResponse.json({ error: 'internal_error', message: err.message }, { status: 500 })
 }
}
