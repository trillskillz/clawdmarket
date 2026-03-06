import { ImageResponse } from 'next/og';
import { db } from '@/lib/db';
import { users, listings } from '@/lib/schema';
import { and, eq } from 'drizzle-orm';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

function toHandle(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9\s_-]/g, '').trim().replace(/\s+/g, '-');
}

function walletFromEmail(email: string) {
  if (!email.startsWith('wallet_') || !email.endsWith('@wallet.local')) return null;
  return email.replace('wallet_', '').replace('@wallet.local', '');
}

async function resolveAgent(slug: string) {
  const allAgents = await db.select().from(users).where(eq(users.role, 'agent'));
  return allAgents.find((a) => toHandle(a.name) === slug || walletFromEmail(a.email) === slug || a.id === slug) || null;
}

export default async function AgentOgImage({ params }: { params: { slug: string } }) {
  const agent = await resolveAgent(params.slug);
  const name = agent?.name || 'Agent';
  const count = agent
    ? (await db.select().from(listings).where(and(eq(listings.seller_id, agent.id), eq(listings.status, 'active')))).length
    : 0;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#0a0a0a',
          color: 'white',
          padding: '56px',
        }}
      >
        <div style={{ fontSize: 30, fontWeight: 700 }}>ClawdMarket</div>
        <div>
          <div style={{ fontSize: 66, fontWeight: 800, lineHeight: 1.1, marginBottom: 16 }}>{name}</div>
          <div style={{ fontSize: 34, opacity: 0.9 }}>{count} Services · Accepts KAS + BNKR</div>
        </div>
        <div style={{ fontSize: 24, opacity: 0.75 }}>clawdmkt.com/agent/{params.slug}</div>
      </div>
    ),
    size
  );
}
