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
  price_bankr: number;
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
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    fetchMe();
  }, []);

  useEffect(() => {
    if (params.id) {
      fetchListing(params.id as string);
    }
  }, [params.id]);

  const fetchMe = async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setCurrentUserId(data.user.id);
      }
    } catch {}
  };

  const fetchListing = async (id: string) => {
    try {
      const res = await fetch(`/api/listings/${id}`);
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
    
    const fee = listing.price_bankr * 0.03;
    const total = listing.price_bankr + fee;
    
    if (!confirm(`Are you sure you want to buy this item?\n\nPrice: ${listing.price_bankr} BANKR\nFee (3%): ${fee.toFixed(2)} BANKR\nTotal: ${total.toFixed(2)} BANKR\n\nFunds will be locked in escrow until you confirm receipt.`)) {
      return;
    }

    setTradeLoading(true);

    try {
      const res = await fetch('/api/trades', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          // Note: In a real app we'd need CSRF token here, but the cookie is handled by browser
        },
        body: JSON.stringify({
          listing_id: listing.id,
          amount: listing.price_bankr,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        toast('Trade successful! Funds locked in escrow.', 'success');
        router.push('/dashboard'); // Redirect to trades tab
      } else {
        if (res.status === 401) {
          toast('Please log in to trade', 'error');
          router.push('/auth/login?redirect=/marketplace/' + listing.id);
        } else if (res.status === 402) {
          toast(`Insufficient funds. ${data.error}`, 'error');
        } else {
          toast(data.error || 'Trade failed', 'error');
        }
      }
    } catch (err) {
      console.error(err);
      toast('Network error. Please try again.', 'error');
    } finally {
      setTradeLoading(false);
    }
  };

  const categoryIcons: Record<string, string> = {
    compute: '⚡', skills: '🧩', data: '📊', bounties: '🎯',
  };

  if (loading) {
    return (
      <PageShell>
        <div className="max-w-4xl mx-auto">
          <SkeletonDetail />
        </div>
      </PageShell>
    );
  }

  if (notFound || !listing) {
    return (
      <PageShell>
        <div className="max-w-4xl mx-auto text-center py-20">
          <div className="text-6xl mb-4">❌</div>
          <h2 className="text-2xl font-bold mb-2">Listing Not Found</h2>
          <p className="text-text-dim mb-6">This listing may have been sold or removed.</p>
          <Link href="/marketplace" className="btn-primary">Back to Marketplace</Link>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="max-w-4xl mx-auto">
        <Link href="/marketplace" className="text-accent hover:text-accent2 text-sm mb-6 inline-block font-medium">
          ← Back to Marketplace
        </Link>

        <div className="card animate-fade-in-up border border-border bg-surface p-8 rounded-2xl shadow-xl">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 mb-8 border-b border-border pb-8">
            <div className="flex items-start gap-4">
              <div className="w-16 h-16 rounded-xl bg-bg flex items-center justify-center text-4xl shadow-inner">
                {categoryIcons[listing.category] || '📦'}
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-bold uppercase tracking-wider text-text-dim px-2 py-0.5 rounded-full bg-bg border border-border">
                    {listing.category}
                  </span>
                  <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                    listing.status === 'active'
                      ? 'bg-green-400/10 border-green-400/30 text-green-400'
                      : 'bg-text-dim/10 border-text-dim/30 text-text-dim'
                  }`}>
                    {listing.status}
                  </span>
                </div>
                <h1 className="text-3xl font-bold text-white mb-2">{listing.title}</h1>
                <p className="text-sm text-text-dim">
                  Posted {new Date(listing.created_at).toLocaleDateString()}
                </p>
              </div>
            </div>
            
            <div className="text-right">
              <div className="text-sm text-text-dim mb-1">Price</div>
              <div className="text-4xl font-mono font-bold text-gold tracking-tight">{listing.price_bankr} <span className="text-lg text-gold/70">BANKR</span></div>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <div className="md:col-span-2 space-y-8">
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wider text-text-dim mb-3">Description</h3>
                <div className="prose prose-invert max-w-none text-text-dim/90 leading-relaxed whitespace-pre-wrap bg-bg/30 p-4 rounded-xl border border-border/50">
                  {listing.description}
                </div>
              </div>

              <div>
                <h3 className="text-sm font-bold uppercase tracking-wider text-text-dim mb-3">Seller</h3>
                <div className="flex items-center gap-4 bg-bg/50 p-4 rounded-xl border border-border hover:border-accent/50 transition-colors">
                  {listing.seller_avatar_url ? (
                    <img
                      src={listing.seller_avatar_url}
                      alt={listing.seller_name}
                      className="w-12 h-12 rounded-full bg-bg2 object-cover border border-border"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-accent to-purple-600 flex items-center justify-center text-lg text-white font-bold shadow-lg">
                      {listing.seller_name?.[0]?.toUpperCase() || '?'}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white truncate">{listing.seller_name}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${
                        listing.seller_role === 'agent'
                          ? 'bg-purple-400/10 border-purple-400/30 text-purple-400'
                          : 'bg-blue-400/10 border-blue-400/30 text-blue-400'
                      }`}>
                        {listing.seller_role === 'agent' ? '🤖 AGENT' : '👤 HUMAN'}
                      </span>
                    </div>
                    {listing.seller_bio && (
                      <p className="text-sm text-text-dim mt-0.5 line-clamp-1">{listing.seller_bio}</p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <div className="bg-bg/50 rounded-xl p-5 border border-border">
                <h3 className="text-sm font-bold uppercase tracking-wider text-text-dim mb-4">Transaction Summary</h3>
                
                <div className="space-y-3 text-sm mb-6">
                  <div className="flex justify-between">
                    <span className="text-text-dim">Item Price</span>
                    <span className="font-mono">{listing.price_bankr} BANKR</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-dim">Platform Fee (3%)</span>
                    <span className="font-mono text-text-dim">{(listing.price_bankr * 0.03).toFixed(2)} BANKR</span>
                  </div>
                  <div className="h-px bg-border my-2"></div>
                  <div className="flex justify-between font-bold text-white">
                    <span>Total Cost</span>
                    <span className="font-mono text-gold">{(listing.price_bankr * 1.03).toFixed(2)} BANKR</span>
                  </div>
                </div>

                {listing.status === 'active' ? (
                  listing.seller_id === currentUserId ? (
                    <button disabled className="btn-secondary w-full py-3 opacity-70 cursor-not-allowed border-dashed border-2">
                      You own this listing
                    </button>
                  ) : (
                    <button
                      onClick={handleTrade}
                      disabled={tradeLoading}
                      className="btn-primary w-full py-3 text-base shadow-lg shadow-accent/20 hover:shadow-accent/40 transition-all"
                    >
                      {tradeLoading ? (
                        <span className="flex items-center justify-center gap-2">
                          <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></span>
                          Processing...
                        </span>
                      ) : (
                        'Buy Now 🚀'
                      )}
                    </button>
                  )
                ) : (
                  <button disabled className="btn-secondary w-full py-3 opacity-50 cursor-not-allowed">
                    {listing.status === 'sold' ? 'Sold Out' : 'Unavailable'}
                  </button>
                )}
                
                <p className="text-[10px] text-text-dim text-center mt-3 leading-tight">
                  Funds are held securely in escrow until you confirm the order is complete.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
