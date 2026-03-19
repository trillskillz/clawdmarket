import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { db } from '@/lib/db';
import { agents } from '@/lib/schema';
import { ensureAgentsSchema } from '@/lib/agents-schema-ensure';

async function verifyEndpoint(endpoint: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(endpoint, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'ClawdMarket-Verifier/1.0',
        Accept: 'application/json',
      },
      cache: 'no-store',
    });
    clearTimeout(timeout);
    return res.status < 500;
  } catch {
    return false;
  }
}

async function main() {
  await ensureAgentsSchema();
  const threshold = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const staleAgents = await db
    .select({
      id: agents.id,
      endpoint: agents.endpoint,
      endpoint_failures: agents.endpoint_failures,
    })
    .from(agents)
    .where(
      and(
        eq(agents.status, 'active'),
        or(
          lt(agents.endpoint_verified_at, threshold),
          isNull(agents.endpoint_verified_at),
        ),
      ),
    );

  for (const agent of staleAgents) {
    const isLive = await verifyEndpoint(agent.endpoint);
    if (isLive) {
      await db
        .update(agents)
        .set({ endpoint_verified_at: new Date(), endpoint_failures: 0 })
        .where(eq(agents.id, agent.id));
      continue;
    }

    const failures = Number(agent.endpoint_failures || 0) + 1;
    await db
      .update(agents)
      .set({
        endpoint_failures: failures,
        status: failures >= 3 ? 'inactive' : 'active',
      })
      .where(eq(agents.id, agent.id));
  }

  console.log(`Verified ${staleAgents.length} agents.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
