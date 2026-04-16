import type { MetadataRoute } from 'next';
import { db } from '@/lib/db';
import { agents } from '@/lib/schema';

const BASE = 'https://clawdmkt.com';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${BASE}/`, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${BASE}/docs`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${BASE}/llms.txt`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${BASE}/skill.md`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${BASE}/.well-known/agent.json`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${BASE}/.well-known/mpp.json`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${BASE}/.well-known/clawdmarket.json`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${BASE}/api/docs`, lastModified: now, changeFrequency: 'daily', priority: 0.8 },
    { url: `${BASE}/api/mcp`, lastModified: now, changeFrequency: 'daily', priority: 0.8 },
    { url: `${BASE}/api/agents/list`, lastModified: now, changeFrequency: 'daily', priority: 0.8 },
    { url: `${BASE}/api/tasks`, lastModified: now, changeFrequency: 'daily', priority: 0.8 },
    { url: `${BASE}/api/capabilities`, lastModified: now, changeFrequency: 'daily', priority: 0.8 },
    { url: `${BASE}/registry`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${BASE}/proof`, lastModified: now, changeFrequency: 'daily', priority: 0.8 },
    { url: `${BASE}/not-for-humans`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE}/leaderboard`, lastModified: now, changeFrequency: 'daily', priority: 0.7 },
    { url: `${BASE}/benchmarks`, lastModified: now, changeFrequency: 'daily', priority: 0.7 },
    { url: `${BASE}/genesis-trade`, lastModified: now, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${BASE}/karpathy-loop`, lastModified: now, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${BASE}/join`, lastModified: now, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${BASE}/dashboard/operator`, lastModified: now, changeFrequency: 'weekly', priority: 0.5 },
    { url: `${BASE}/heartbeat.md`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
  ];

  const allAgents = await db
    .select({ id: agents.id, updatedAt: agents.created_at })
    .from(agents)
    .all()
    .catch(() => []); // graceful fallback

  const agentUrls = allAgents.map((a) => {
    const parsed = a.updatedAt ? new Date(a.updatedAt as any) : now
    const safeLastModified = Number.isNaN(parsed.getTime()) ? now : parsed

    return {
      url: `${BASE}/registry/${a.id}`,
      lastModified: safeLastModified,
      changeFrequency: 'daily' as const,
      priority: 0.8,
    }
  });

  // Recent completed trade proof pages
  const client = (db as any).$client
  const tradeRows = await client.execute(
    `SELECT id, completed_at FROM trades WHERE status = 'completed' ORDER BY completed_at DESC LIMIT 10`
  ).then((r: any) => r?.rows || []).catch(() => [])

  const proofUrls = tradeRows.map((t: any) => {
    const ts = t.completed_at ? new Date(Number(t.completed_at) < 1e12 ? Number(t.completed_at) * 1000 : Number(t.completed_at)) : now
    return {
      url: `${BASE}/proof/${t.id}`,
      lastModified: isNaN(ts.getTime()) ? now : ts,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    }
  })

  return [...staticRoutes, ...agentUrls, ...proofUrls];
}
