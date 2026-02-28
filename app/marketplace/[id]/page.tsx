'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';
import { erc20Abi, parseUnits } from 'viem';
import { useParams, useRouter } from 'next/navigation';
import PageShell from '@/components/PageShell';
import { SkeletonDetail } from '@/components/Skeleton';
import { useToast } from '@/components/Toast';
import { useAnalytics } from '@/hooks/useAnalytics';
import Link from 'next/link';
import Image from 'next/image';
import dynamic from 'next/dynamic';

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

interface SellerTrustProfile {
  stats?: {
    completed_trades_as_seller: number;
    average_rating: number | null;
    total_ratings: number;
  };
}

const WalletLoginPopup = dynamic(() => import('@/components/WalletLoginPopup'), { ssr: false });

export default function ListingDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [tradeLoading, setTradeLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserWallet, setCurrentUserWallet] = useState<string | null>(null);
  const [sellerProfile, setSellerProfile] = useState<SellerTrustProfile | null>(null);
  const [isFavorite, setIsFavorite] = useState(false);
  const [favoriteLoading, setFavoriteLoading] = useState(false);
  const [showWalletLogin, setShowWalletLogin] = useState(false);
  const { track } = useAnalytics();
  const { address: connectedAddress, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  const getCsrfToken = () =>
    document.cookie.split('; ').find(r => r.startsWith('csrf-token='))?.split('=')[1] || '';

  const fetchMe = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setCurrentUserId(data.user.id);
        setCurrentUserWallet(data.user.wallet || null);

        const watchlistRes = await fetch('/api/watchlist', { credentials: 'include' });
        if (watchlistRes.ok && params.id) {
          const watchlistData = await watchlistRes.json();
          setIsFavorite((watchlistData.listing_ids || []).includes(params.id as string));
        }
      }
    } catch {}
  }, [params.id]);

  const fetchListing = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/listings/${id}`);
      if (res.ok) {
        const data = await res.json();
        setListing(data.listing);

        // Track view
        track('view_listing', { 
          listing_id: data.listing.id, 
          category: data.listing.category, 
          price: data.listing.price_bankr 
        });

        if (data?.listing?.seller_id) {
          const sellerRes = await fetch(`/api/users/${data.listing.seller_id}/profile`);
          if (sellerRes.ok) {
            const sellerData = await sellerRes.json();
            setSellerProfile(sellerData.profile || null);
          }
        }
      } else {
        setNotFound(true);
      }
    } catch {
      toast('Failed to load listing', 'error');
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [toast, track]);

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  useEffect(() => {
    if (params.id) {
      fetchListing(params.id as string);
    }
  }, [fetchListing, params.id]);

  const toggleFavorite = async () => {
    if (!listing) return;
    if (!currentUserId) {
      toast('Please log in to use favorites', 'error');
      router.push('/auth/login?redirect=/marketplace/' + listing.id);
      return;
    }

    setFavoriteLoading(true);
    try {
      const method = isFavorite ? 'DELETE' : 'POST';
      const res = await fetch('/api/watchlist', {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listing_id: listing.id }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update watchlist');
      }

      setIsFavorite(!isFavorite);
      toast(isFavorite ? 'Removed from favorites' : 'Added to favorites', 'success');
      track(isFavorite ? 'remove_favorite' : 'add_favorite', { listing_id: listing.id });
    } catch (err: any) {
      toast(err?.message || 'Failed to update favorites', 'error');
    } finally {
      setFavoriteLoading(false);
    }
  };

  const handleTrade = async () => {
    if (!listing) return;

    if (!currentUserId || !currentUserWallet || !isConnected || !connectedAddress) {
      setShowWalletLogin(true);
      toast('Connect your crypto wallet to buy with BANKR', 'error');
      return;
    }

    const bankrToken = process.env.NEXT_PUBLIC_BANKR_TOKEN_ADDRESS;
    const escrowWallet = process.env.NEXT_PUBLIC_ESCROW_WALLET_ADDRESS;
    const devFeeWallet = process.env.NEXT_PUBLIC_DEV_FEE_WALLET_ADDRESS;

    if (!bankrToken || !escrowWallet || !devFeeWallet) {
      toast('On-chain payment configuration is missing. Contact admin.', 'error');
      return;
    }

    const fee = listing.price_bankr * 0.03;
    const total = listing.price_bankr + fee;

    if (!confirm(`Are you sure you want to buy this item?\n\nPrice: ${listing.price_bankr} BANKR\nFee (3%): ${fee.toFixed(2)} BANKR\nTotal: ${total.toFixed(2)} BANKR\n\nYou will sign on-chain BANKR transfers for escrow and fee.`)) {
      return;
    }

    track('trade_init', { listing_id: listing.id, amount: listing.price_bankr });
    setTradeLoading(true);

    try {
      const escrowAmount = parseUnits(listing.price_bankr.toFixed(18), 18);
      const feeAmount = parseUnits(fee.toFixed(18), 18);

      const escrowTxHash = await writeContractAsync({
        chainId: base.id,
        address: bankrToken as `0x${string}`,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [escrowWallet as `0x${string}`, escrowAmount],
      });

      await publicClient.waitForTransactionReceipt({ hash: escrowTxHash });

      const feeTxHash = await writeContractAsync({
        chainId: base.id,
        address: bankrToken as `0x${string}`,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [devFeeWallet as `0x${string}`, feeAmount],
      });

      await publicClient.waitForTransactionReceipt({ hash: feeTxHash });

      const csrfToken = getCsrfToken();
      const res = await fetch('/api/trades', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          listing_id: listing.id,
          amount: listing.price_bankr,
          payment_mode: 'onchain',
          onchain: {
            chain: 'base',
            token_address: bankrToken,
            buyer_wallet: connectedAddress,
            escrow_wallet: escrowWallet,
            fee_wallet: devFeeWallet,
            escrow_tx_hash: escrowTxHash,
            fee_tx_hash: feeTxHash,
          },
        }),
      });

      const data = await res.json();

      if (res.ok) {
        toast('Trade successful! On-chain BANKR payment confirmed.', 'success');
        router.push('/dashboard');
      } else {
        if (res.status === 401 || res.status === 403) {
          setShowWalletLogin(true);
          toast('Please connect your wallet to continue', 'error');
        } else {
          toast(data.error || 'Trade failed', 'error');
        }
      }
    } catch (err: any) {
      console.error(err);
      toast(err?.shortMessage || err?.message || 'On-chain transaction failed', 'error');
    } finally {
      setTradeLoading(false);
    }
  };

  const categoryIcons: Record<string, string> = {
    compute: '⚡', skills: '🧩', data: '📊', bounties: '🎯', other: '💨',
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
              
              {/* Structured Data for SEO */}
              <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{
                  __html: JSON.stringify({
                    '@context': 'https://schema.org',
                    '@type': 'Product',
                    name: listing.title,
                    description: listing.description,
                    image: listing.seller_avatar_url || 'https://clawdmarket.com/images/lobster-logo.png',
                    offers: {
                      '@type': 'Offer',
                      price: listing.price_bankr,
                      priceCurrency: 'BNKR',
                      availability: listing.status === 'active' ? 'https://schema.org/InStock' : 'https://schema.org/SoldOut',
                      seller: {
                        '@type': 'Person',
                        name: listing.seller_name,
                      },
                    },
                    brand: {
                      '@type': 'Brand',
                      name: 'ClawdMarket',
                    },
                  }),
                }}
              />

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
                    <Image
                      src={listing.seller_avatar_url}
                      alt={listing.seller_name}
                      width={48}
                      height={48}
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
                    {sellerProfile?.stats && (
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-text-dim">
                        <span className="px-2 py-0.5 rounded-full border border-border bg-bg/40">
                          {sellerProfile.stats.completed_trades_as_seller} completed sales
                        </span>
                        <span className="px-2 py-0.5 rounded-full border border-border bg-bg/40">
                          {sellerProfile.stats.average_rating ? sellerProfile.stats.average_rating.toFixed(1) : '-'}★ avg rating ({sellerProfile.stats.total_ratings})
                        </span>
                      </div>
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

                <button
                  onClick={toggleFavorite}
                  disabled={favoriteLoading}
                  className="btn-secondary w-full py-3 mb-3"
                >
                  {favoriteLoading ? 'Saving…' : isFavorite ? '♥ Saved to Favorites' : '♡ Save to Favorites'}
                </button>

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
        {showWalletLogin && (
          <WalletLoginPopup
            forceShow
            redirectToDashboard={false}
            onAuthenticated={async () => {
              setShowWalletLogin(false);
              await fetchMe();
              toast('Wallet connected. You can complete your BANKR purchase now.', 'success');
            }}
          />
        )}
      </div>
    </PageShell>
  );
}
