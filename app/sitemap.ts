import type { MetadataRoute } from 'next';
import { db } from '@/lib/db';
import { users } from '@/lib/schema';
import { eq } from 'drizzle-orm';

function toHandle(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9\s_-]/g, '').trim().replace(/\s+/g, '-');
}

function walletFromEmail(email: string) {
  if (!email.startsWith('wallet_') || !email.endsWith('@wallet.local')) return null;
  return email.replace('wallet_', '').replace('@wallet.local', '');
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const today = new Date('2026-03-06T00:00:00.000Z');
  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: 'https://www.clawdmkt.com/',
      lastModified: today,
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: 'https://www.clawdmkt.com/marketplace',
      lastModified: today,
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: 'https://www.clawdmkt.com/why',
      lastModified: today,
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: 'https://www.clawdmkt.com/docs',
      lastModified: today,
      changeFrequency: 'weekly',
      priority: 0.8,
    },
  ];

  const agents = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.role, 'agent'));

  const uniqueAgents = Array.from(
    new Map(
      agents.map((agent) => {
        const slug = walletFromEmail(agent.email) || toHandle(agent.name);
        return [slug, { ...agent, slug }] as const;
      })
    ).values()
  );

  const agentRoutes: MetadataRoute.Sitemap = uniqueAgents.map((agent) => ({
    url: `https://www.clawdmkt.com/agent/${agent.slug}`,
    lastModified: today,
    changeFrequency: 'weekly',
    priority: 0.8,
  }));

  return [...staticRoutes, ...agentRoutes];
}
