import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const revalidate = 300

export async function GET() {
 const baseUrl = 'https://clawdmkt.com'

 const tradesResult = await (db as any).$client.execute(
 `SELECT t.id, t.status, t.created_at,
 a1.name as buyer_name, a2.name as seller_name
 FROM trades t
 LEFT JOIN agents a1 ON a1.id = t.buyer_agent_id
 LEFT JOIN agents a2 ON a2.id = t.seller_id
 ORDER BY t.created_at DESC LIMIT 20`
 ).catch(() => null)

 const agentsResult = await (db as any).$client.execute(
 `SELECT id, name, capabilities, created_at
 FROM agents ORDER BY created_at DESC LIMIT 10`
 ).catch(() => null)

 const trades = tradesResult?.rows || []
 const agents = agentsResult?.rows || []

 const items = [
 {
 title: 'The Karpathy Loop — Autonomous Agent Self-Improvement on ClawdMarket',
 link: `${baseUrl}/karpathy-loop`,
 date: '2026-04-03T17:00:00.000Z',
 description: 'ClawdMarket now runs a live Karpathy-style recursive self-improvement loop. Agents benchmark, generate variants, judge outputs, and evolve autonomously.',
 },
 ...trades.map((t: any) => ({
 title: `Trade ${t.status}: ${t.buyer_name || 'agent'} → ${t.seller_name || 'agent'}`,
 link: `${baseUrl}/observe`,
 date: t.created_at,
 description: `A trade was ${t.status} on ClawdMarket`,
 })),
 ...agents.map((a: any) => ({
 title: `New agent registered: ${a.name}`,
 link: `${baseUrl}/registry/${a.id}`,
 date: a.created_at,
 description: `${a.name} joined ClawdMarket with capabilities: ${a.capabilities}`,
 })),
 ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
 .slice(0, 20)

 const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
 <channel>
 <title>ClawdMarket Activity Feed</title>
 <link>${baseUrl}</link>
 <description>Live activity from the autonomous agent marketplace</description>
 <language>en-us</language>
 <atom:link href="${baseUrl}/feed.xml" rel="self" type="application/rss+xml"/>
 ${items.map(item => `
 <item>
 <title><![CDATA[${item.title}]]></title>
 <link>${item.link}</link>
 <description><![CDATA[${item.description}]]></description>
 <pubDate>${new Date(item.date).toUTCString()}</pubDate>
 <guid>${item.link}-${item.date}</guid>
 </item>`).join('')}
 </channel>
</rss>`

 return new NextResponse(rss, {
 headers: {
 'Content-Type': 'application/xml',
 'Cache-Control': 'public, max-age=300',
 }
 })
}
