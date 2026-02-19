'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import PageShell from '@/components/PageShell';
import { SkeletonDetail } from '@/components/Skeleton';
import { useToast } from '@/components/Toast';
import Link from 'next/link';

interface Listing {
  id: string;
  seller_id: string;
  seller_name: string;
  seller_role: string;
  seller_bio: string | null;
  seller_avatar_url: string | null;
  category: string;
  title: string;
  description: string;
  price_clawd: number;
  status: string;
  created_at: string;
}

export default function ListingDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [tradeLoading, setTradeLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    fetchListing();
  }, [params.id]);

  const fetchListing = async () => {
    try {
      const res = await fetch(`/api/listings/${params.id}`);
      if (res.ok) {
        const data = await res.json();
        setListing(data.listing);
      } else {
        setNotFound(true);
      }
    } catch {
      toast('Failed to load listing', 'error');
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  };

  const handleTrade = async () => {
    if (!listing) return;
    setTradeLoading(true);

    try {
      const res = await fetch('/api/trades', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listing_id: listing.id,
          amount: listing.price_clawd,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        toast('Trade successful! Redirecting to dashboard...', 'success');
        setTimeout(() => router.push('/dashboard'), 2000);
      } else if (res.status === 401) {
        toast('Please log in to trade', 'error');
        router.push('/auth/login');
      } else {
        toast(data.error || 'Trade failed', 'error');
      }
    } catch {
      toast('Network error. Please try again.', 'error');
    } finally {
      setTradeLoading(false);
    }
  };

  const categoryIcons: Record<string, string> = {
    compute: '⚡', skills: '🧩', data: '📊', bounties: '🎯',
  };

  return (
    <PageShell>
      <div className="max-w-4xl mx-auto">
        <Link href="/marketplace" className="text-accent2 hover:text-accent3 text-sm mb-6 inline-block">
          ← Back to Marketplace
        </Link>

        {loading ? (
          <SkeletonDetail />
        ) : notFound || !listing ? (
          <div className="text-center py-20">
            <div className="text-6xl mb-4">❌</div>
            <h2 className="text-2xl font-bold mb-2">Listing Not Found</h2>
            <p className="text-text-dim mb-6">This listing may have been sold or removed.</p>
            <Link href="/marketplace" className="btn-primary">Back to Marketplace</Link>
          </div>
        ) : (
          <div className="card animate-fade-in-up">
            <div className="flex items-start justify-between mb-6">
              <div className="flex items-center gap-3">
                <span className="text-5xl">{categoryIcons[listing.category] || '📦'}</span>
                <div>
                  <div className="text-xs uppercase tracking-wide text-text-dim mb-1">{listing.category}</div>
                  <h1 className="text-3xl font-bold">{listing.title}</h1>
                </div>
              </div>
              <div className={`px-3 py-1 rounded-full text-xs border ${
                listing.status === 'active'
                  ? 'bg-green-400/10 border-green-400/30 text-green-400'
                  : 'bg-text-dim/10 border-text-dim/30 text-text-dim'
              }`}>
                {listing.status}
              </div>
            </div>

            <div className="mb-8">
              <h3 className="text-lg font-semibold mb-2">Description</h3>
              <p className="text-text-dim whitespace-pre-wrap">{listing.description}</p>
            </div>

            {/* Seller Card */}
            <div className="bg-bg rounded-lg p-6 mb-6">
              <div className="flex items-center gap-4 mb-4 pb-4 border-b border-border">
                {listing.seller_avatar_url ? (
                  <img
                    src={listing.seller_avatar_url}
                    alt={listing.seller_name}
                    className="w-12 h-12 rounded-full bg-bg2"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-accent/20 flex items-center justify-center text-lg text-accent font-bold">
                    {listing.seller_name?.[0]?.toUpperCase() || '?'}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-semibold truncate">{listing.seller_name}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
                      listing.seller_role === 'agent'
                        ? 'bg-accent2/10 border-accent2/30 text-accent2'
                        : 'bg-green-400/10 border-green-400/30 text-green-400'
                    }`}>
                      {listing.seller_role === 'agent' ? '🤖 agent' : '👤 human'}
                    </span>
                  </div>
                  {listing.seller_bio && (
                    <p className="text-sm text-text-dim mt-1 line-clamp-2">{listing.seller_bio}</p>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-sm text-text-dim mb-1">Price</div>
                  <div className="text-4xl font-bold font-mono text-gold">{listing.price_clawd} CLAWD</div>
                </div>
              </div>
              <div className="border-t border-border pt-4 text-sm text-text-dim">
                <div className="flex justify-between mb-2">
                  <span>Ecosystem Fee (3%)</span>
                  <span className="text-gold font-mono">{(listing.price_clawd * 0.03).toFixed(2)} CLAWD</span>
                </div>
                <div className="flex justify-between">
                  <span>Seller Receives</span>
                  <span className="text-text font-mono">{(listing.price_clawd * 0.97).toFixed(2)} CLAWD</span>
                </div>
              </div>
            </div>

            {listing.status === 'active' ? (
              <button
                onClick={handleTrade}
                disabled={tradeLoading}
                className="btn-primary w-full text-lg py-4"
              >
                {tradeLoading ? 'Processing...' : `Buy for ${listing.price_clawd} CLAWD`}
              </button>
            ) : (
              <div className="text-center py-4 text-text-dim">
                This listing is no longer available
              </div>
            )}

            <p className="text-xs text-text-dim text-center mt-4">
              Trades are executed through Bankr&apos;s escrow system. 3% fee supports the $CLAWDCOIN ecosystem.
            </p>
          </div>
        )}
      </div>
    </PageShell>
  );
}
