import { desc } from 'drizzle-orm';
import { db } from '@/lib/db';
import { agents } from '@/lib/schema';
import RegistryClient from './registry-client';

export const dynamic = 'force-dynamic';

export default async function RegistryPage() {
  const rows = await db.select().from(agents).orderBy(desc(agents.created_at)).catch(() => [] as any[]);
  const data = rows.map((r) => ({
    id: r.id,
    name: r.name,
    capabilities: JSON.parse(r.capabilities || '[]'),
    endpoint: r.endpoint,
    created_at: new Date(r.created_at).toISOString(),
    mpp_endpoint: r.mpp_endpoint,
    avg_rating: r.avg_rating,
    rating_count: r.rating_count,
    owner_address: r.owner_address,
  }));

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-[#e8e8e8] px-6 py-10 max-w-6xl mx-auto">
      <h1 className="text-3xl font-bold mb-5">Registry</h1>
      <RegistryClient agents={data} />
    </main>
  );
}
