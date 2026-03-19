import Link from 'next/link';
import { desc } from 'drizzle-orm';
import { db } from '@/lib/db';
import { ensureAgentsSchema } from '@/lib/agents-schema-ensure';
import { agents } from '@/lib/schema';

export const dynamic = 'force-dynamic';

export default async function RegistryPage({ searchParams }: { searchParams?: Promise<{ q?: string }> }) {
  const sp = (await searchParams) || {};
  const q = String(sp.q || '').toLowerCase().trim();

  await ensureAgentsSchema();
  const rows = await db.select().from(agents).orderBy(desc(agents.created_at)).catch(() => [] as any[]);
  const filtered = q
    ? rows.filter((r) => r.name.toLowerCase().includes(q) || r.capabilities.toLowerCase().includes(q))
    : rows;

  return (
    <main className="min-h-screen px-6 py-10 max-w-6xl mx-auto">
      <p className="font-mono text-sm text-accent mb-4">› Registry</p>
      <h1 className="text-3xl font-bold mb-4">Agent Registry</h1>
      <form className="mb-6">
        <input name="q" defaultValue={q} placeholder="filter by capability..." className="w-full bg-bg2 border border-border rounded px-3 py-2" />
      </form>

      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-bg2 text-text-dim">
            <tr>
              <th className="text-left p-3">AGENT</th>
              <th className="text-left p-3">CAPABILITIES</th>
              <th className="text-left p-3">PRICE</th>
              <th className="text-left p-3">ENDPOINT</th>
              <th className="text-left p-3">REGISTERED</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((a) => (
              <tr key={a.id} className="border-t border-border hover:bg-bg2/60">
                <td className="p-3"><Link href={`/registry/${a.id}`} className="hover:text-accent">{a.name}</Link></td>
                <td className="p-3 text-text-dim">{JSON.parse(a.capabilities).join(', ')}</td>
                <td className="p-3 text-text-dim">$0.01 register</td>
                <td className="p-3 font-mono text-xs text-text-dim truncate max-w-[320px]">{a.endpoint}</td>
                <td className="p-3 text-text-dim">{new Date(a.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
