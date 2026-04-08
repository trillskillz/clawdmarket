import Nav from '@/components/Nav';
import Footer from '@/components/Footer';
import AgentProfileClient from '@/components/AgentProfileClient';
import { db } from '@/lib/db';
import { users, listings, trades, ratings, agent_ratings } from '@/lib/schema';
import { and, desc, eq, or, sql, gte } from 'drizzle-orm';
import { FALLBACK_AGENTS, fallbackAgentForListingId } from '@/lib/fallback-agents';
import { FALLBACK_LISTINGS } from '@/lib/marketplace-fallback';
import { getAgentRatingState } from '@/lib/agent-moderation';
import { computeTrustScore, trustScoreClass } from '@/lib/trust-score';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

function toHandle(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9\s_-]/g, '').trim().replace(/\s+/g, '-');
}

function walletFromEmail(email: string) {
  if (!email.startsWith('wallet_') || !email.endsWith('@wallet.local')) return null;
  return email.replace('wallet_', '').replace('@wallet.local', '');
}

type ResolvedAgent = {
  id: string;
  name: string;
  email: string;
  bio: string | null;
  avatar_url?: string | null;
  avatar_emoji?: string | null;
  created_at: Date;
  isFallback?: boolean;
};

async function resolveAgent(slug: string): Promise<ResolvedAgent | null> {
  const isWallet = /^0x[a-fA-F0-9]{40}$/.test(slug);

  if (isWallet) {
    const candidateEmail = `wallet_${slug.toLowerCase()}@wallet.local`;
    const [user] = await db.select().from(users).where(eq(users.email, candidateEmail)).limit(1);
    if (user && user.role === 'agent') return user as ResolvedAgent;
  }

  const allAgents = await db.select().from(users).where(eq(users.role, 'agent'));
  const dbAgent = allAgents.find((a) => toHandle(a.name) === slug || a.id === slug);
  if (dbAgent) return dbAgent as ResolvedAgent;

  const fallback = FALLBACK_AGENTS.find((a) => toHandle(a.name) === slug || a.id === slug);
  if (!fallback) return null;

  return {
    id: fallback.id,
    name: fallback.name,
    email: `wallet_${toHandle(fallback.name)}@wallet.local`,
    bio: fallback.bio,
    avatar_url: fallback.avatar_url,
    created_at: new Date(),
    isFallback: true,
  };
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const agent = await resolveAgent(slug);
  if (!agent) {
    return { title: 'Agent Not Found — ClawdMarket' };
  }

  const wallet = walletFromEmail(agent.email);
  const services = agent.isFallback
    ? FALLBACK_LISTINGS.filter((l) => fallbackAgentForListingId(l.id).id === agent.id).length
    : (
        await db
          .select()
          .from(listings)
          .where(and(eq(listings.seller_id, agent.id), eq(listings.status, 'active')))
      ).length;
  const name = agent.name;
  const profileSlug = wallet || toHandle(name);

  return {
    title: `${name} on ClawdMarket`,
    description: `${services} services listed · Pays via MPP and x402 · On ClawdMarket`,
    alternates: {
      canonical: `https://www.clawdmkt.com/agent/${profileSlug}`,
    },
    openGraph: {
      title: `${name} on ClawdMarket`,
      description: `${services} services listed · Pays via MPP and x402 · On ClawdMarket`,
      url: `https://www.clawdmkt.com/agent/${profileSlug}`,
      images: ['/og-image.png'],
      type: 'profile',
    },
    twitter: {
      card: 'summary_large_image',
      title: `${name} on ClawdMarket`,
      description: `${services} services listed · Pays via MPP and x402 · On ClawdMarket`,
      images: ['/og-image.png'],
    },
  };
}

export default async function AgentProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const agent = await resolveAgent(slug);
  if (!agent) return notFound();

  const wallet = walletFromEmail(agent.email);
  const handle = toHandle(agent.name);

  // ── Listings ────────────────────────────────────────────────────────────────
  const agentListings = agent.isFallback
    ? FALLBACK_LISTINGS.filter((l) => fallbackAgentForListingId(l.id).id === agent.id).map((l) => ({
        id: l.id,
        title: l.title,
        description: l.description,
        category: l.category,
        price_bankr: l.price_bankr,
      }))
    : await db
        .select({
          id: listings.id,
          title: listings.title,
          description: listings.description,
          category: listings.category,
          price_bankr: listings.price_bankr,
        })
        .from(listings)
        .where(and(eq(listings.seller_id, agent.id), eq(listings.status, 'active')))
        .orderBy(desc(listings.created_at));

  // ── Trades ──────────────────────────────────────────────────────────────────
  const completedTrades = agent.isFallback
    ? []
    : await db
        .select({ id: trades.id, amount: trades.amount, created_at: trades.created_at })
        .from(trades)
        .where(and(eq(trades.seller_id, agent.id), or(eq(trades.status, 'completed'), eq(trades.status, 'complete'))));

  const disputedTrades = agent.isFallback
    ? []
    : await db
        .select({ id: trades.id })
        .from(trades)
        .where(and(eq(trades.seller_id, agent.id), eq(trades.status, 'disputed')));

  // ── Recent trades (both buyer & seller) for activity feed ───────────────────
  const recentTradesRaw = agent.isFallback
    ? []
    : await db
        .select({
          id: trades.id,
          amount: trades.amount,
          status: trades.status,
          created_at: trades.created_at,
          buyer_id: trades.buyer_id,
          seller_id: trades.seller_id,
        })
        .from(trades)
        .where(or(eq(trades.seller_id, agent.id), eq(trades.buyer_id, agent.id)))
        .orderBy(desc(trades.created_at))
        .limit(20);

  // Resolve counterparty names
  const counterpartyIds = new Set<string>();
  for (const t of recentTradesRaw) {
    const otherId = t.buyer_id === agent.id ? t.seller_id : t.buyer_id;
    counterpartyIds.add(otherId);
  }

  const counterpartyNames: Record<string, string> = {};
  if (counterpartyIds.size > 0) {
    const counterparties = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(or(...[...counterpartyIds].map((cid) => eq(users.id, cid))));
    for (const cp of counterparties) {
      counterpartyNames[cp.id] = cp.name;
    }
  }

  const recentTrades = recentTradesRaw.map((t) => {
    const isBuyer = t.buyer_id === agent.id;
    const otherId = isBuyer ? t.seller_id : t.buyer_id;
    return {
      id: t.id,
      amount: t.amount,
      status: t.status,
      created_at: t.created_at ? new Date(t.created_at as any).toISOString() : new Date().toISOString(),
      counterparty: counterpartyNames[otherId] || 'Unknown Agent',
      role: isBuyer ? 'buyer' as const : 'seller' as const,
    };
  });

  // ── Total volume ────────────────────────────────────────────────────────────
  const totalVolume = completedTrades.reduce((sum, t) => sum + (t.amount ?? 0), 0);

  // ── Trading partners ────────────────────────────────────────────────────────
  const partnerCounts: Record<string, number> = {};
  for (const t of recentTradesRaw) {
    const otherId = t.buyer_id === agent.id ? t.seller_id : t.buyer_id;
    partnerCounts[otherId] = (partnerCounts[otherId] || 0) + 1;
  }
  const tradingPartners = Object.entries(partnerCounts)
    .map(([id, count]) => ({ name: counterpartyNames[id] || 'Unknown', trades: count }))
    .sort((a, b) => b.trades - a.trades);

  // ── Category breakdown ──────────────────────────────────────────────────────
  const categoryCounts: Record<string, number> = {};
  for (const l of agentListings) {
    categoryCounts[l.category] = (categoryCounts[l.category] || 0) + 1;
  }
  const categoryBreakdown = Object.entries(categoryCounts)
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);

  // ── Trust score computation ─────────────────────────────────────────────────
  let likes = 0;
  let dislikes = 0;
  let totalRatingsCount = 0;
  let recentRatings90d = 0;

  let trust = computeTrustScore({
    likes: 0,
    dislikes: 0,
    effectiveDislikes: 0,
    totalRatings: 0,
    completedTrades: completedTrades.length,
    disputedTrades: disputedTrades.length,
    accountAgeDays: Math.floor((Date.now() - new Date(agent.created_at as any).getTime()) / (1000 * 60 * 60 * 24)),
    recentRatings90d: 0,
  });

  try {
    const [totalRatingsRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(ratings)
      .where(eq(ratings.rated_id, agent.id));

    const ratingState = await getAgentRatingState(agent.id);
    const [recentRatingsRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(agent_ratings)
      .where(and(eq(agent_ratings.to_agent_id, agent.id), gte(agent_ratings.created_at, new Date(Date.now() - 90 * 24 * 60 * 60 * 1000))));

    likes = ratingState.likes;
    dislikes = ratingState.dislikes;
    totalRatingsCount = totalRatingsRow?.count || 0;
    recentRatings90d = recentRatingsRow?.count || 0;

    trust = computeTrustScore({
      likes: ratingState.likes,
      dislikes: ratingState.dislikes,
      effectiveDislikes: ratingState.effectiveDislikes,
      totalRatings: totalRatingsCount,
      completedTrades: completedTrades.length,
      disputedTrades: disputedTrades.length,
      accountAgeDays: Math.floor((Date.now() - new Date(agent.created_at as any).getTime()) / (1000 * 60 * 60 * 24)),
      recentRatings90d,
    });
  } catch (err) {
    console.error('Agent trust computation fallback:', err);
  }

  return (
    <>
      <Nav />
      <main className="px-4 md:px-6 pt-32 pb-20">
        <AgentProfileClient
          agent={{
            name: agent.name,
            handle,
            wallet,
            bio: agent.bio,
            avatar_url: agent.avatar_url,
            avatar_emoji: (agent as any).avatar_emoji || null,
            created_at: new Date(agent.created_at as any).toISOString(),
            isFallback: agent.isFallback,
          }}
          trust={trust}
          stats={{
            completedTrades: completedTrades.length,
            disputedTrades: disputedTrades.length,
            totalRatings: totalRatingsCount,
            likes,
            dislikes,
            servicesCount: agentListings.length,
            totalVolume,
            recentRatings90d,
          }}
          listings={agentListings}
          recentTrades={recentTrades}
          categoryBreakdown={categoryBreakdown}
          tradingPartners={tradingPartners}
        />
      </main>
      <Footer />
    </>
  );
}
