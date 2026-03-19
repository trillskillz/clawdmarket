import { notFound } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { agents, ratings, users } from '@/lib/schema';

export const dynamic = 'force-dynamic';

const truncate = (v: string, left = 8, right = 6) => (v.length > left + right ? `${v.slice(0, left)}…${v.slice(-right)}` : v);

function renderStars(avg?: number | null) {
  const clamped = Math.max(0, Math.min(5, Number(avg || 0)));
  const rounded = Math.round(clamped);
  return '★'.repeat(rounded).padEnd(5, '☆');
}

export default async function RegistryAgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [agent] = await db.select().from(agents).where(eq(agents.id, id)).limit(1).catch(() => [] as any[]);
  if (!agent) notFound();

  const caps = JSON.parse(agent.capabilities || '[]') as string[];

  const recentReviews = await db
    .select({
      id: ratings.id,
      score: ratings.score,
      comment: ratings.comment,
      created_at: ratings.created_at,
      rater_name: users.name,
      rater_emoji: users.avatar_emoji,
    })
    .from(ratings)
    .leftJoin(users, eq(ratings.rater_id, users.id))
    .where(eq(ratings.rated_id, id))
    .orderBy(desc(ratings.created_at))
    .limit(5);

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-[#e8e8e8] px-6 py-10 max-w-6xl mx-auto grid md:grid-cols-2 gap-6">
      <section className="border border-[#2a2a2a] rounded-lg p-5 bg-[#0f1115]">
        <h1 className="text-2xl font-semibold mb-4">{agent.name}</h1>
        <div className="grid grid-cols-[130px_1fr] gap-2 text-sm font-mono">
          <span className="text-[#9aa0a6]">AGENT</span><span>{agent.name}</span>
          <span className="text-[#9aa0a6]">ID</span><span>{agent.id}</span>
          <span className="text-[#9aa0a6]">ENDPOINT</span><span>{agent.endpoint}</span>
          <span className="text-[#9aa0a6]">CAPABILITIES</span><span>{caps.join(', ')}</span>
          <span className="text-[#9aa0a6]">PRICE</span><span>$0.001 per call</span>
          <span className="text-[#9aa0a6]">REGISTERED</span><span>{new Date(agent.created_at).toISOString()}</span>
          <span className="text-[#9aa0a6]">OWNER</span><span>{truncate(agent.owner_address || '')}</span>
          <span className="text-[#9aa0a6]">MPP</span><span>{agent.mpp_endpoint || 'not listed'}</span>
          <span className="text-[#9aa0a6]">RATING</span>
          <span>
            <span className="text-amber-300">{renderStars(agent.avg_rating)}</span>{' '}
            {agent.rating_count ? `${Number(agent.avg_rating || 0).toFixed(2)} (${agent.rating_count})` : 'unrated'}
          </span>
        </div>
      </section>
      <section className="border border-[#2a2a2a] rounded-lg p-5 bg-[#0f1115]">
        <h2 className="text-xl font-semibold mb-3">Recent Reviews</h2>
        {recentReviews.length === 0 ? (
          <p className="text-sm text-[#9aa0a6]">No reviews yet.</p>
        ) : (
          <div className="space-y-3">
            {recentReviews.map((review) => (
              <article key={review.id} className="border border-[#2a2a2a] rounded p-3">
                <div className="flex items-center justify-between text-xs text-[#9aa0a6] mb-1">
                  <span>{review.rater_emoji || '🤖'} {review.rater_name || 'anonymous'}</span>
                  <span>{new Date(review.created_at).toLocaleString()}</span>
                </div>
                <div className="text-amber-300 text-sm">{'★'.repeat(review.score).padEnd(5, '☆')}</div>
                <p className="text-sm mt-1">{review.comment || 'No written feedback.'}</p>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
