import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { loadAgentTrust } from '@/lib/agent-trust'

export const dynamic = 'force-dynamic'

export async function GET(
 request: NextRequest,
 { params }: { params: Promise<{ id: string }> }
) {
 try {
 const { id } = await params
 const principalId = `user_agent_${id}`
 const client = (db as any).$client

 // Parallel: agent row, trade counts, recent trades w/ names, ratings w/ names, benchmarks, improvements, training network
 const [agentRes, tradeCountRes, recentTradesRes, ratingsRes, benchmarksRes, lastImpRes, trainersRes, traineesRes] = await Promise.all([
  client.execute('SELECT * FROM agents WHERE id = ? LIMIT 1', [id]).catch(() => null),
  client.execute(
   `SELECT COUNT(*) as total_trades,
           SUM(CASE WHEN status IN ('completed', 'complete') THEN 1 ELSE 0 END) as completed_trades,
           SUM(CASE WHEN status IN ('completed', 'complete') THEN CAST(amount AS REAL) ELSE 0 END) as total_volume
    FROM trades WHERE seller_id IN (?, ?) OR buyer_id IN (?, ?)`, [id, principalId, id, principalId]
  ).catch(() => null),
  client.execute(
   `SELECT t.id, t.buyer_id, t.seller_id, t.amount, t.status, t.created_at,
           b.name as buyer_name, s.name as seller_name
    FROM trades t
    LEFT JOIN agents b ON b.id = t.buyer_id OR ('user_agent_' || b.id) = t.buyer_id
    LEFT JOIN agents s ON s.id = t.seller_id OR ('user_agent_' || s.id) = t.seller_id
    WHERE t.seller_id IN (?, ?) OR t.buyer_id IN (?, ?)
    ORDER BY t.created_at DESC LIMIT 10`, [id, principalId, id, principalId]
  ).catch(() => null),
  client.execute(
   `SELECT r.id, r.trade_id, r.rater_id, r.rated_id, r.score, r.comment, r.created_at,
           a.name as rater_name
    FROM ratings r
    LEFT JOIN agents a ON a.id = r.rater_id OR ('user_agent_' || a.id) = r.rater_id
    WHERE r.rated_id IN (?, ?)
    ORDER BY r.created_at DESC LIMIT 20`, [id, principalId]
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
 const totalVolume = Number((tradeRow as any).total_volume || 0)
 const benchmarkScore = (row as any).benchmark_score ? Number((row as any).benchmark_score) : null
 const velocityScore = (row as any).velocity_score ? Number((row as any).velocity_score) : null
 const improvementCount = Number((row as any).improvement_count || 0)
 const trust = await loadAgentTrust({
  id,
  created_at: (row as any).created_at,
  avg_rating: (row as any).avg_rating,
  rating_count: (row as any).rating_count,
 })

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
  avg_rating: trust.components.averageRating,
  rating_count: trust.components.ratingCount,
  rating_distribution: ratingDist,
  created_at: (row as any).created_at,
  version: (row as any).version || 1,
  base_agent_id: (row as any).base_agent_id,
  model_id: (row as any).model_id,
  mpp_endpoint: (row as any).mpp_endpoint,
  llms_txt_url: (row as any).llms_txt_url,
  is_online: (row as any).is_online ? 1 : 0,
  last_seen_at: (row as any).last_seen_at || null,
  endpoint_verified_at: (row as any).endpoint_verified_at,
  endpoint_failures: Number((row as any).endpoint_failures || 0),
  benchmark_score: benchmarkScore,
  benchmark_count: Number((row as any).benchmark_count || 0),
  benchmark_history: benchmarkHistory,
  velocity_score: velocityScore,
  improvement_count: improvementCount,
  total_improvement_delta: Number((row as any).total_improvement_delta || 0),
  last_improved_at: (row as any).last_improved_at,
  moltbook_handle: (row as any).moltbook_handle || null,
  completed_trades: trust.components.completedTrades,
  total_trades: trust.components.totalTrades,
  total_volume: Math.round(totalVolume * 100) / 100,
  trust_score: trust.trustScore,
  trust_confidence: trust.confidence,
  trust_evidence_points: trust.evidencePoints,
  trust_drivers: trust.drivers,
  trust_components: trust.components,
  trust: {
   score: trust.trustScore,
   band: trust.band,
   confidence: trust.confidence,
   evidence_points: trust.evidencePoints,
   drivers: trust.drivers,
   components: trust.components,
  },
  reputation_score: trust.trustScore,
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
