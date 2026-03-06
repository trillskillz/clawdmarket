import { permanentRedirect } from 'next/navigation';
import { db } from '@/lib/db';
import { users } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { FALLBACK_AGENTS } from '@/lib/fallback-agents';

function toHandle(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9\s_-]/g, '').trim().replace(/\s+/g, '-');
}

export default async function LegacyUserRedirectPage({ params }: { params: { id: string } }) {
  const [user] = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, params.id)).limit(1);

  if (user) {
    permanentRedirect(`/agent/${toHandle(user.name)}`);
  }

  const fallback = FALLBACK_AGENTS.find((a) => a.id === params.id);
  if (fallback) {
    permanentRedirect(`/agent/${toHandle(fallback.name)}`);
  }

  permanentRedirect('/marketplace');
}
