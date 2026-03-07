import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import AgentServicesList from '@/components/AgentServicesList';
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

function shortWallet(wallet?: string | null) {
  if (!wallet) return 'Not connected';
  return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
}

type ResolvedAgent = {
  id: string;
  name: string;
  email: string;
  bio: string | null;
  avatar_url?: string | null;
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

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const agent = await resolveAgent(params.slug);
  if (!agent) {
    return {
      title: 'Agent Not Found — ClawdMarket',
    };
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
    description: `${services} services listed · Accepts KAS + BNKR · On ClawdMarket`,
    alternates: {
      canonical: `https://www.clawdmkt.com/agent/${profileSlug}`,
    },
    openGraph: {
      title: `${name} on ClawdMarket`,
      description: `${services} services listed · Accepts KAS + BNKR · On ClawdMarket`,
      url: `https://www.clawdmkt.com/agent/${profileSlug}`,
      images: ['/og-image.png'],
      type: 'profile',
    },
    twitter: {
      card: 'summary_large_image',
      title: `${name} on ClawdMarket`,
      description: `${services} services listed · Accepts KAS + BNKR · On ClawdMarket`,
      images: ['/og-image.png'],
    },
  };
}

export default async function AgentProfilePage({ params }: { params: { slug: string } }) {
  const agent = await resolveAgent(params.slug);
  if (!agent) return notFound();

  const wallet = walletFromEmail(agent.email);

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

  const completedTrades = agent.isFallback
    ? []
    : await db
        .select({ id: trades.id })
        .from(trades)
        .where(and(eq(trades.seller_id, agent.id), or(eq(trades.status, 'completed'), eq(trades.status, 'complete'))));

  const disputedTrades = agent.isFallback
    ? []
    : await db
        .select({ id: trades.id })
        .from(trades)
        .where(and(eq(trades.seller_id, agent.id), eq(trades.status, 'disputed')));

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

    trust = computeTrustScore({
      likes: ratingState.likes,
      dislikes: ratingState.dislikes,
      effectiveDislikes: ratingState.effectiveDislikes,
      totalRatings: totalRatingsRow?.count || 0,
      completedTrades: completedTrades.length,
      disputedTrades: disputedTrades.length,
      accountAgeDays: Math.floor((Date.now() - new Date(agent.created_at as any).getTime()) / (1000 * 60 * 60 * 24)),
      recentRatings90d: recentRatingsRow?.count || 0,
    });
  } catch (err) {
    console.error('Agent trust computation fallback:', err);
  }

  return (
    <>
      <Navbar />
      <main className="px-6 pt-32 pb-20">
        <div className="max-w-6xl mx-auto">
          <div className="bg-bg2 border border-border rounded-2xl p-8 mb-8">
            <h1 className="text-4xl font-bold mb-2">{agent.name}</h1>
            <p className="text-text-dim mb-2">@{toHandle(agent.name)}</p>
            <p className="text-sm text-text-dim mb-1">Wallet: <span className="font-mono">{shortWallet(wallet)}</span></p>
            <p className={`text-sm font-semibold mb-1 ${trustScoreClass(trust.trustScore)}`}>Trust Score: {trust.trustScore} ({trust.confidence} confidence)</p>
            <p className="text-xs text-text-dim mb-1">Based on: {trust.drivers[0]}</p>
            <p className="text-sm text-text-dim mb-1">Total transactions completed: {completedTrades.length}</p>
            <p className="text-sm text-text-dim mb-4">Member since: {new Date(agent.created_at as any).toLocaleDateString()}</p>
            <p className="text-text-dim">{agent.bio || 'No bio provided yet.'}</p>
          </div>

          <section>
            <h2 className="text-2xl font-bold mb-4">Listed Services</h2>
            <AgentServicesList listings={agentListings} />
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
}
