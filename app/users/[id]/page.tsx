'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import PageShell from '@/components/PageShell';
import { SkeletonListItem } from '@/components/Skeleton';
import ListingCard from '@/components/ListingCard';
import Link from 'next/link';

interface UserProfile {
  id: string;
  name: string;
  role: string;
  bio: string | null;
  avatar_url: string | null;
  joined: string;
  stats: {
    completed_trades_as_seller: number;
    active_listings: number;
    average_rating: number | null;
    total_ratings: number;
  };
}

interface Listing {
  id: string;
  title: string;
  category: string;
  price_bankr: number;
  status: string;
  created_at: string;
  seller_id: string;
  seller_name: string;
  seller_role: string;
  seller_avatar_url: string | null;
}

export default function UserProfilePage() {
  const params = useParams();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [ratings, setRatings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (params.id) fetchData(params.id as string);
  }, [params.id]);

  const fetchData = async (id: string) => {
    try {
      const [profileRes, listingsRes, ratingsRes] = await Promise.all([
        fetch(`/api/users/${id}/profile`),
        fetch(`/api/listings?seller_id=${id}`),
        fetch(`/api/users/${id}/ratings`),
      ]);

      if (profileRes.ok) {
        const d = await profileRes.json();
        setProfile(d.profile);
      }
      if (listingsRes.ok) {
        const d = await listingsRes.json();
        setListings(d.listings || []);
      }
      if (ratingsRes.ok) {
        const d = await ratingsRes.json();
        setRatings(d.ratings || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <PageShell>
        <div className="max-w-4xl mx-auto space-y-8">
          <div className="h-48 bg-surface rounded-2xl animate-pulse"></div>
          <div className="space-y-4">
            <SkeletonListItem />
            <SkeletonListItem />
          </div>
        </div>
      </PageShell>
    );
  }

  if (!profile) {
    return (
      <PageShell>
        <div className="text-center py-20">
          <div className="text-6xl mb-4">👻</div>
          <h2 className="text-2xl font-bold">User Not Found</h2>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="bg-surface border border-border rounded-2xl p-8 mb-8 flex flex-col md:flex-row items-center md:items-start gap-6 text-center md:text-left">
          {profile.avatar_url ? (
            <img src={profile.avatar_url} alt={profile.name} className="w-24 h-24 rounded-full bg-bg2 border-4 border-bg" />
          ) : (
            <div className="w-24 h-24 rounded-full bg-gradient-to-br from-accent to-purple-600 flex items-center justify-center text-3xl text-white font-bold border-4 border-bg shadow-xl">
              {profile.name[0].toUpperCase()}
            </div>
          )}
          
          <div className="flex-1">
            <div className="flex flex-col md:flex-row items-center gap-3 mb-2">
              <h1 className="text-3xl font-bold">{profile.name}</h1>
              <span className={`text-xs px-2 py-0.5 rounded-full border font-medium uppercase tracking-wider ${
                profile.role === 'agent'
                  ? 'bg-purple-400/10 border-purple-400/30 text-purple-400'
                  : 'bg-blue-400/10 border-blue-400/30 text-blue-400'
              }`}>
                {profile.role}
              </span>
            </div>
            
            {profile.bio && <p className="text-text-dim mb-4 max-w-xl">{profile.bio}</p>}
            
            <div className="flex items-center justify-center md:justify-start gap-6 text-sm">
              <div>
                <div className="font-bold text-xl text-white">{profile.stats.completed_trades_as_seller}</div>
                <div className="text-text-dim uppercase text-[10px] tracking-wider">Sales</div>
              </div>
              <div className="w-px h-8 bg-border"></div>
              <div>
                <div className="font-bold text-xl text-gold flex items-center gap-1">
                  {profile.stats.average_rating ? profile.stats.average_rating.toFixed(1) : '-'} <span className="text-sm">★</span>
                </div>
                <div className="text-text-dim uppercase text-[10px] tracking-wider">{profile.stats.total_ratings} Reviews</div>
              </div>
              <div className="w-px h-8 bg-border"></div>
              <div>
                <div className="font-bold text-xl text-white">{new Date(profile.joined).getFullYear()}</div>
                <div className="text-text-dim uppercase text-[10px] tracking-wider">Joined</div>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs / Content */}
        <div className="space-y-8">
          <div>
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
              Active Listings <span className="text-sm font-normal text-text-dim bg-bg px-2 py-0.5 rounded-full">{listings.length}</span>
            </h2>
            {listings.length > 0 ? (
              <div className="grid md:grid-cols-2 gap-4">
                {listings.map(l => (
                  <ListingCard 
                    key={l.id} 
                    id={l.id}
                    title={l.title}
                    description="[See details]" // Profile listing object doesn't have description yet, or we need to add it
                    category={l.category}
                    price_bankr={l.price_bankr}
                    seller_name={l.seller_name}
                    seller_role={l.seller_role}
                    seller_avatar_url={l.seller_avatar_url}
                    created_at={new Date(l.created_at)}
                  />
                ))}
              </div>
            ) : (
              <p className="text-text-dim italic">No active listings.</p>
            )}
          </div>

          <div>
            <h2 className="text-xl font-bold mb-4">Reviews</h2>
            {ratings.length > 0 ? (
              <div className="grid md:grid-cols-2 gap-4">
                {ratings.map(r => (
                  <div key={r.id} className="bg-bg/50 p-4 rounded-xl border border-border">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-2">
                        <div className="font-bold text-gold">{r.score} ★</div>
                        <div className="text-sm font-semibold">{r.rater_name || 'Anonymous'}</div>
                      </div>
                      <div className="text-xs text-text-dim">{new Date(r.created_at).toLocaleDateString()}</div>
                    </div>
                    {r.comment && <p className="text-sm text-text-dim">"{r.comment}"</p>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-text-dim italic">No reviews yet.</p>
            )}
          </div>
        </div>
      </div>
    </PageShell>
  );
}
