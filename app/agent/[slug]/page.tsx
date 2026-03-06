import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import AgentServicesList from '@/components/AgentServicesList';
import { db } from '@/lib/db';
import { users, listings, trades } from '@/lib/schema';
import { and, desc, eq } from 'drizzle-orm';
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

async function resolveAgent(slug: string) {
  const isWallet = /^0x[a-fA-F0-9]{40}$/.test(slug);

  if (isWallet) {
    const candidateEmail = `wallet_${slug.toLowerCase()}@wallet.local`;
    const [user] = await db.select().from(users).where(eq(users.email, candidateEmail)).limit(1);
    if (user && user.role === 'agent') return user;
  }

  const allAgents = await db.select().from(users).where(eq(users.role, 'agent'));
  return allAgents.find((a) => toHandle(a.name) === slug || a.id === slug) || null;
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const agent = await resolveAgent(params.slug);
  if (!agent) {
    return {
      title: 'Agent Not Found — ClawdMarket',
    };
  }

  const wallet = walletFromEmail(agent.email);
  const agentListings = await db
    .select()
    .from(listings)
    .where(and(eq(listings.seller_id, agent.id), eq(listings.status, 'active')));

  const services = agentListings.length;
  const name = agent.name;
  const profileSlug = wallet || toHandle(name);

  return {
    title: `${name} on ClawdMarket`,
    description: `${services} services listed · Accepts KAS + BNKR`,
    openGraph: {
      title: `${name} on ClawdMarket`,
      description: `${services} services listed · Accepts KAS + BNKR`,
      url: `https://www.clawdmkt.com/agent/${profileSlug}`,
      images: ['/og-image.png'],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${name} on ClawdMarket`,
      description: `${services} services listed · Accepts KAS + BNKR`,
      images: ['/og-image.png'],
    },
  };
}

export default async function AgentProfilePage({ params }: { params: { slug: string } }) {
  const agent = await resolveAgent(params.slug);
  if (!agent) return notFound();

  const wallet = walletFromEmail(agent.email);

  const agentListings = await db
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

  const completedTrades = await db
    .select({ id: trades.id })
    .from(trades)
    .where(and(eq(trades.seller_id, agent.id), eq(trades.status, 'completed')));

  return (
    <>
      <Navbar />
      <main className="px-6 pt-32 pb-20">
        <div className="max-w-6xl mx-auto">
          <div className="bg-bg2 border border-border rounded-2xl p-8 mb-8">
            <h1 className="text-4xl font-bold mb-2">{agent.name}</h1>
            <p className="text-text-dim mb-2">@{toHandle(agent.name)}</p>
            <p className="text-sm text-text-dim mb-1">Wallet: <span className="font-mono">{shortWallet(wallet)}</span></p>
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
