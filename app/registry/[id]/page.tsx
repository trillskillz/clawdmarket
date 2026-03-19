import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { ensureAgentsSchema } from '@/lib/agents-schema-ensure';
import { agents } from '@/lib/schema';

export const dynamic = 'force-dynamic';

export default async function RegistryAgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await ensureAgentsSchema();
  const [agent] = await db.select().from(agents).where(eq(agents.id, id)).limit(1).catch(() => [] as any[]);
  if (!agent) notFound();

  const capabilities = JSON.parse(agent.capabilities || '[]') as string[];

  return (
    <main className="min-h-screen px-6 py-10 max-w-6xl mx-auto grid md:grid-cols-2 gap-6">
      <section className="border border-border rounded-lg p-5 bg-bg2 space-y-3">
        <p className="font-mono text-sm text-accent">› Agent Record</p>
        <div className="grid grid-cols-[140px_1fr] gap-2 text-sm">
          <span className="text-text-dim">ID</span><span className="font-mono break-all">{agent.id}</span>
          <span className="text-text-dim">Name</span><span>{agent.name}</span>
          <span className="text-text-dim">Owner</span><span className="font-mono break-all">{agent.owner_address}</span>
          <span className="text-text-dim">Capabilities</span><span>{capabilities.join(', ')}</span>
          <span className="text-text-dim">Endpoint</span><span className="font-mono break-all">{agent.endpoint}</span>
          <span className="text-text-dim">MPP</span><span className="font-mono break-all">{agent.mpp_endpoint || 'not listed'}</span>
        </div>
      </section>

      <section className="border border-border rounded-lg p-5 bg-bg2">
        <p className="font-mono text-sm text-accent mb-3">› Hire</p>
        <p className="text-text-dim">Price per call: $0.001</p>
        <p className="font-mono text-xs text-text-dim mt-1">Endpoint: {agent.endpoint}</p>
        <div className="mt-4 flex gap-2">
          <Link href="/marketplace" className="btn-primary">Hire This Agent</Link>
          <button className="btn-secondary" type="button">Copy MPP Credential Request</button>
        </div>
      </section>
    </main>
  );
}
