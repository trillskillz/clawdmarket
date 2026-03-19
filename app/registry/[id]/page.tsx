import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { agents } from '@/lib/schema';

export const dynamic = 'force-dynamic';

const truncate = (v: string, left = 8, right = 6) => (v.length > left + right ? `${v.slice(0, left)}…${v.slice(-right)}` : v);

export default async function RegistryAgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [agent] = await db.select().from(agents).where(eq(agents.id, id)).limit(1).catch(() => [] as any[]);
  if (!agent) notFound();

  const caps = JSON.parse(agent.capabilities || '[]') as string[];

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-[#e8e8e8] px-6 py-10 max-w-6xl mx-auto grid md:grid-cols-2 gap-6">
      <section className="border border-[#2a2a2a] rounded-lg p-5 bg-[#0f1115]">
        <h1 className="text-2xl font-semibold mb-4">{agent.name}</h1>
        <div className="grid grid-cols-[130px_1fr] gap-2 text-sm font-mono">
          <span className="text-[#9aa0a6]">AGENT</span><span>{agent.name}</span>
          <span className="text-[#9aa0a6]">ID</span><span>{agent.id}</span>
          <span className="text-[#9aa0a6]">ENDPOINT</span><span>{agent.endpoint}</span>
          <span className="text-[#9aa0a6]">CAPABILITIES</span><span>{caps.join(', ')}</span>
          <span className="text-[#9aa0a6]">PRICE</span><span>$0.001 per call</span>
          <span className="text-[#9aa0a6]">REGISTERED</span><span>{new Date(agent.created_at).toISOString()}</span>
          <span className="text-[#9aa0a6]">OWNER</span><span>{truncate(agent.owner_address || '')}</span>
          <span className="text-[#9aa0a6]">MPP</span><span>{agent.mpp_endpoint || 'not listed'}</span>
          <span className="text-[#9aa0a6]">RATING</span><span>{agent.avg_rating && agent.rating_count ? `${agent.avg_rating} (${agent.rating_count})` : 'unrated'}</span>
        </div>
      </section>
      <section className="border border-[#2a2a2a] rounded-lg p-5 bg-[#0f1115]">
        <h2 className="text-xl font-semibold mb-3">Hire This Agent</h2>
        <p className="text-[#9aa0a6]">Price per call: $0.001</p>
        <p className="text-[#9aa0a6] text-sm mt-1">MPP endpoint: {agent.mpp_endpoint || 'not listed'}</p>
        <button className="mt-4 px-4 py-2 rounded bg-[#ff4d4d] text-black font-semibold">Hire This Agent</button>
      </section>
    </main>
  );
}
