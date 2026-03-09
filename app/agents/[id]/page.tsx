'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import PageShell from '@/components/PageShell';
import ListingCard from '@/components/ListingCard';
import Image from 'next/image';
import { useAuth } from '@/hooks/useAuth'; // Hypothetical hook or context

export default function AgentProfilePage() {
  const { id } = useParams();
  const router = useRouter();
  const { user } = useAuth(); // Assume useAuth provides current user info
  const [profile, setProfile] = useState<any>(null);
  const [listings, setListings] = useState<any[]>([]);
  const [reputation, setReputation] = useState({ score: 0, count: 0 });
  const [loading, setLoading] = useState(true);
  const [ratingLoading, setRatingLoading] = useState(false);
  const [ratingError, setRatingError] = useState<string | null>(null);

  useEffect(() => {
    if (id) {
      fetch(`/api/agents/${id}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.error) {
            console.error(data.error);
            return;
          }
          setProfile(data.profile);
          setListings(data.listings);
          setReputation(data.reputation);
          setLoading(false);
        })
        .catch((err) => {
          console.error(err);
          setLoading(false);
        });
    }
  }, [id]);

  const handleRate = async (score: number) => {
    if (!user || user.role !== 'agent') return;
    setRatingLoading(true);
    setRatingError(null);
    try {
      const res = await fetch(`/api/agents/${id}/rate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRatingError(data?.message || data?.error || 'Failed to submit rating');
        return;
      }

      if (data?.reputation) {
        setReputation(data.reputation);
      }
      setProfile((p: any) => ({ ...p, my_rating: score }));
    } catch (err) {
      console.error(err);
      setRatingError('Failed to submit rating');
    } finally {
      setRatingLoading(false);
    }
  };

  const handleMessage = () => {
    router.push(`/dashboard/messages?partner=${id}`);
  };

  if (loading) return <PageShell><div className="text-center py-20">Loading...</div></PageShell>;
  if (!profile) return <PageShell><div className="text-center py-20">Agent not found</div></PageShell>;

  return (
    <PageShell>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Profile Header */}
        <div className="bg-surface border border-border rounded-2xl p-8 mb-8 flex flex-col md:flex-row items-start gap-8">
          <div className="flex-shrink-0">
            {profile.avatar_url ? (
              <Image
                src={profile.avatar_url}
                alt={profile.name}
                width={128}
                height={128}
                unoptimized
                className="w-32 h-32 rounded-full bg-bg object-cover border-4 border-accent/20"
              />
            ) : profile.avatar_emoji ? (
              <div className="w-32 h-32 rounded-full bg-accent/20 flex items-center justify-center text-6xl border-4 border-accent/20">
                {profile.avatar_emoji}
              </div>
            ) : (
              <div className="w-32 h-32 rounded-full bg-accent/20 flex items-center justify-center text-4xl text-accent border-4 border-accent/20">
                {profile.name[0].toUpperCase()}
              </div>
            )}
          </div>

          <div className="flex-grow">
            <h1 className="text-4xl font-bold text-text mb-2 flex items-center gap-3">
              {profile.name}
              <span className="bg-accent/10 text-accent text-sm px-3 py-1 rounded-full uppercase tracking-wider font-semibold border border-accent/20">
                Agent
              </span>
            </h1>
            <p className="text-text-dim text-lg mb-6 max-w-2xl">
              {profile.bio || 'No bio provided.'}
            </p>
            
            <div className="flex items-center gap-6">
              <div className="flex flex-col">
                <span className="text-xs uppercase tracking-wide text-text-dim">Reputation</span>
                <div className="flex items-center gap-2">
                  <span className={`text-3xl font-mono font-bold ${reputation.score >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {reputation.score > 0 ? '+' : ''}{reputation.score}
                  </span>
                  <span className="text-sm text-text-dim">({reputation.count} ratings)</span>
                </div>
              </div>
              
              <div className="w-px h-12 bg-border"></div>
              
              <div className="flex flex-col">
                <span className="text-xs uppercase tracking-wide text-text-dim">Joined</span>
                <span className="text-xl font-mono text-text">
                  {new Date(profile.created_at).toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 min-w-[200px]">
            {user && user.id !== profile.id && (
              <button 
                onClick={handleMessage}
                className="btn-secondary w-full flex items-center justify-center gap-2"
              >
                <span>💬</span> Message
              </button>
            )}

            {user && user.role === 'agent' && user.id !== profile.id && (
              <>
                <div className="grid grid-cols-2 gap-3 mt-2">
                  <button
                    onClick={() => handleRate(1)}
                    disabled={ratingLoading}
                    className="bg-green-500/10 hover:bg-green-500/20 text-green-400 border border-green-500/30 py-2 rounded-xl transition-all flex items-center justify-center gap-2"
                  >
                    👍 Like
                  </button>
                  <button
                    onClick={() => handleRate(-1)}
                    disabled={ratingLoading}
                    className="bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 py-2 rounded-xl transition-all flex items-center justify-center gap-2"
                  >
                    👎 Dislike
                  </button>
                </div>
                {(profile as any)?.my_rating && (
                  <p className="text-xs text-text-dim mt-2">
                    Your vote: {(profile as any).my_rating > 0 ? '👍 Like' : '👎 Dislike'}
                  </p>
                )}
                {ratingError && (
                  <p className="text-xs text-red-400 mt-2">{ratingError}</p>
                )}
              </>
            )}
          </div>
        </div>

        {/* Listings */}
        <h2 className="text-2xl font-bold mb-6 text-text">Active Listings</h2>
        {listings.length === 0 ? (
          <div className="text-center py-12 bg-surface rounded-2xl border border-border border-dashed text-text-dim">
            No active listings found for this agent.
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {listings.map((listing) => (
              <ListingCard
                key={listing.id}
                {...listing}
                seller_name={profile.name} // Reuse profile info since it's the seller
                seller_role="agent"
                seller_avatar_url={profile.avatar_url}
                seller_avatar_emoji={profile.avatar_emoji}
                showSeller={false}
              />
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}
