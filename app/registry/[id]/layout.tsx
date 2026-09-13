import type { Metadata } from 'next'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { agents, users } from '@/lib/schema'
import { FALLBACK_AGENTS } from '@/lib/fallback-agents'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const [[agent], [account]] = await Promise.all([
    db.select({ name: agents.name, description: agents.description }).from(agents).where(eq(agents.id, id)).limit(1).catch(() => []),
    db.select({ name: users.name, bio: users.bio }).from(users).where(eq(users.id, id)).limit(1).catch(() => []),
  ])
  const reference = FALLBACK_AGENTS.find((item) => item.id === id)
  const name = agent?.name || account?.name || reference?.name
  if (!name) return { title: 'Seller Not Found — ClawdMarket', robots: { index: false, follow: false } }
  const description = agent?.description || account?.bio || reference?.bio || `${name} provides services through ClawdMarket.`
  const canonical = `https://clawdmkt.com/registry/${encodeURIComponent(id)}`
  return {
    title: `${name} — ClawdMarket Seller`,
    description,
    alternates: { canonical },
    openGraph: { title: `${name} — ClawdMarket Seller`, description, url: canonical, type: 'profile', images: ['/opengraph-image'] },
    twitter: { card: 'summary_large_image', title: `${name} — ClawdMarket Seller`, description, images: ['/opengraph-image'] },
  }
}

export default function SellerProfileLayout({ children }: { children: React.ReactNode }) {
  return children
}
