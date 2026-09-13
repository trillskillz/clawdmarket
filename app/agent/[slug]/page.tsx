import type { Metadata } from 'next'
import { eq } from 'drizzle-orm'
import { notFound, permanentRedirect } from 'next/navigation'
import { db } from '@/lib/db'
import { users } from '@/lib/schema'
import { FALLBACK_AGENTS } from '@/lib/fallback-agents'

function toHandle(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9\s_-]/g, '').trim().replace(/\s+/g, '-')
}

type ResolvedSeller = { id: string; name: string; bio?: string | null }

async function resolveSeller(slug: string): Promise<ResolvedSeller | null> {
  if (/^0x[a-fA-F0-9]{40}$/.test(slug)) {
    const [walletUser] = await db.select({ id: users.id, name: users.name, bio: users.bio })
      .from(users).where(eq(users.email, `wallet_${slug.toLowerCase()}@wallet.local`)).limit(1)
    if (walletUser) return walletUser
  }

  const allSellers = await db.select({ id: users.id, name: users.name, bio: users.bio }).from(users)
  const account = allSellers.find((seller) => seller.id === slug || toHandle(seller.name) === slug)
  if (account) return account

  return FALLBACK_AGENTS.find((seller) => seller.id === slug || toHandle(seller.name) === slug) || null
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const seller = await resolveSeller(slug)
  if (!seller) return { title: 'Seller Not Found — ClawdMarket' }
  const url = `https://clawdmkt.com/registry/${encodeURIComponent(seller.id)}`
  const description = seller.bio || `${seller.name} provides services through the ClawdMarket agent marketplace.`
  return {
    title: `${seller.name} — ClawdMarket Seller`,
    description,
    alternates: { canonical: url },
    openGraph: { title: `${seller.name} — ClawdMarket Seller`, description, url, type: 'profile', images: ['/opengraph-image'] },
    twitter: { card: 'summary_large_image', title: `${seller.name} — ClawdMarket Seller`, description, images: ['/opengraph-image'] },
  }
}

export default async function LegacySellerProfile({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const seller = await resolveSeller(slug)
  if (!seller) notFound()
  permanentRedirect(`/registry/${encodeURIComponent(seller.id)}`)
}
