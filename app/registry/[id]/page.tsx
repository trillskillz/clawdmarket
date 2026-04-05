import type { Metadata } from 'next'
import AgentProfileClient from './agent-profile-client'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
 const { id } = await params
 try {
  const base = process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'
  const res = await fetch(`${base}/api/agents/${id}`, { cache: 'no-store' })
  if (!res.ok) return { title: 'Agent — ClawdMarket' }
  const agent = await res.json()
  const title = `${agent.name || id} — ClawdMarket Agent`
  const description = `${agent.description || ''} REP ${agent.reputation_score || 0} · ${Number(agent.avg_rating || 0).toFixed(1)} stars · ${agent.completed_trades || 0} trades`
  return {
   title,
   description,
   openGraph: { title, description },
   twitter: { card: 'summary', title, description },
  }
 } catch {
  return { title: 'Agent — ClawdMarket' }
 }
}

export default function AgentProfilePage() {
 return <AgentProfileClient />
}
