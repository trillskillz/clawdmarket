import type { MetadataRoute } from 'next';
import { db } from '@/lib/db';
import { agents } from '@/lib/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { publicTradeWhereSql } from '@/lib/public-trade-visibility';

// Rendered at request time so DB-backed URLs are always included. A static
// build-time sitemap has no production DB access and silently dropped every
// /registry/{id} and /proof/{id} entry.
export const dynamic = 'force-dynamic';

const BASE = 'https://clawdmkt.com';
const PROOF_LIMIT = 500;
const TEST_NAME_PATTERN = /\b(test|canary)\b|letta-test/i;

function toDate(value: unknown, fallback: Date): Date {
  if (value === null || value === undefined || value === '') return fallback;
  const numeric = typeof value === 'number' ? value : Number(value);
  const parsed = Number.isFinite(numeric)
    ? new Date(numeric < 1e12 ? numeric * 1000 : numeric)
    : new Date(value as string | Date);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${BASE}/`, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${BASE}/why`, lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE}/docs`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${BASE}/registry`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${BASE}/marketplace`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${BASE}/taskboard`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${BASE}/observe`, lastModified: now, changeFrequency: 'daily', priority: 0.8 },
    { url: `${BASE}/proof`, lastModified: now, changeFrequency: 'daily', priority: 0.8 },
    { url: `${BASE}/work`, lastModified: now, changeFrequency: 'daily', priority: 0.6 },
  ];

  let agentUrls: MetadataRoute.Sitemap = [];
  try {
    const allAgents = await db
      .select({ id: agents.id, name: agents.name, updatedAt: agents.created_at })
      .from(agents)
      .where(and(eq(agents.status, 'active'), eq(agents.visibility, 'public'), isNull(agents.archivedAt)))
      .all();
    agentUrls = allAgents
      .filter((a) => !TEST_NAME_PATTERN.test(String(a.name ?? '')))
      .map((a) => ({
        url: `${BASE}/registry/${encodeURIComponent(a.id)}`,
        lastModified: toDate(a.updatedAt, now),
        changeFrequency: 'daily' as const,
        priority: 0.8,
      }));
  } catch (error) {
    console.error('[sitemap] failed to load public agents', error);
  }

  let proofUrls: MetadataRoute.Sitemap = [];
  try {
    const client = (db as any).$client;
    const result = await client.execute({
      sql: `SELECT t.id, t.completed_at FROM trades t
        WHERE t.status IN ('completed', 'complete') AND ${publicTradeWhereSql('t')}
        ORDER BY t.completed_at DESC LIMIT ?`,
      args: [PROOF_LIMIT],
    });
    proofUrls = (result?.rows || []).map((t: any) => ({
      url: `${BASE}/proof/${encodeURIComponent(String(t.id))}`,
      lastModified: toDate(t.completed_at, now),
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    }));
  } catch (error) {
    console.error('[sitemap] failed to load proof pages', error);
  }

  return [...staticRoutes, ...agentUrls, ...proofUrls];
}
