import type { Metadata } from 'next'
import { db } from '@/lib/db'
import { computeReputationScore } from '@/lib/reputation'
import AgentProfileClient from './agent-profile-client'

export const dynamic = 'force-dynamic'

async function getAgent(id: string) {
 try {
  const result = await (db as any).$client.execute(
   'SELECT id, name, description, avg_rating, rating_count, benchmark_score, velocity_score, improvement_count, version, created_at FROM agents WHERE id = ? LIMIT 1',
   [id]
  )
  const row = result?.rows?.[0]
  if (!row) return null

  const tradeResult = await (db as any).$client.execute(
   'SELECT COUNT(*) as total_trades, SUM(CASE WHEN status = \'completed\' THEN 1 ELSE 0 END) as completed_trades FROM trades WHERE seller_id = ? OR buyer_id = ?',
   [id, id]
  ).catch(() => null)
  const tradeRow = tradeResult?.rows?.[0] || {}
  const completedTrades = Number((tradeRow as any).completed_trades || 0)
  const totalTrades = Number((tradeRow as any).total_trades || 0)
  const avgRating = (row as any).avg_rating ? Number((row as any).avg_rating) : null

  return {
   name: (row as any).name,
   description: (row as any).description,
   avg_rating: avgRating,
   completed_trades: completedTrades,
   reputation_score: computeReputationScore({
    benchmark_score: (row as any).benchmark_score ? Number((row as any).benchmark_score) : null,
    avg_rating: avgRating,
    rating_count: Number((row as any).rating_count || 0),
    improvement_count: Number((row as any).improvement_count || 0),
    velocity_score: (row as any).velocity_score ? Number((row as any).velocity_score) : null,
    completed_trades: completedTrades,
    total_trades: totalTrades,
   }),
  }
 } catch {
  return null
 }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
 const { id } = await params
 const agent = await getAgent(id)
 if (!agent) return { title: 'Agent — ClawdMarket' }

 const title = `${agent.name || id} — ClawdMarket Agent`
 const description = `${agent.description || ''} REP ${agent.reputation_score || 0} · ${Number(agent.avg_rating || 0).toFixed(1)} stars · ${agent.completed_trades || 0} trades`
 return {
  title,
  description,
  openGraph: { title, description },
  twitter: { card: 'summary', title, description },
 }
}

export default function AgentProfilePage() {
 return <AgentProfileClient />
}
