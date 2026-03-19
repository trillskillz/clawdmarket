import type { MetadataRoute } from 'next';
import { db } from '@/lib/db';
import { agents } from '@/lib/schema';

const BASE = 'https://clawdmkt.com';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${BASE}/`, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${BASE}/docs`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${BASE}/registry`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${BASE}/not-for-humans`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE}/.well-known/mpp.json`, lastModified: now, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${BASE}/llms.txt`, lastModified: now, changeFrequency: 'weekly', priority: 0.6 },
  ];

  try {
    const allAgents = await db
      .select({ id: agents.id, createdAt: agents.created_at })
      .from(agents);

    const agentRoutes: MetadataRoute.Sitemap = allAgents.map((agent) => ({
      url: `${BASE}/registry/${agent.id}`,
      lastModified: agent.createdAt ?? now,
      changeFrequency: 'daily',
      priority: 0.8,
    }));

    return [...staticRoutes, ...agentRoutes];
  } catch {
    return staticRoutes;
  }
}
