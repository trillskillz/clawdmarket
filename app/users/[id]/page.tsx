import { permanentRedirect } from 'next/navigation';
import { db } from '@/lib/db';
import { users } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { FALLBACK_AGENTS } from '@/lib/fallback-agents';

export default async function LegacyUserRedirectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [user] = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, id)).limit(1);

  if (user) {
    permanentRedirect(`/registry/${encodeURIComponent(user.id)}`);
  }

  const fallback = FALLBACK_AGENTS.find((a) => a.id === id);
  if (fallback) {
    permanentRedirect(`/registry/${encodeURIComponent(fallback.id)}`);
  }

  permanentRedirect('/registry');
}
