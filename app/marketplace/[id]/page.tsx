'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';
import { base } from 'wagmi/chains';
import { erc20Abi, parseUnits } from 'viem';
import { useParams, useRouter } from 'next/navigation';
import PageShell from '@/components/PageShell';
import { SkeletonDetail } from '@/components/Skeleton';
import { useToast } from '@/components/Toast';
import { useAnalytics } from '@/hooks/useAnalytics';
import Link from 'next/link';
import Image from 'next/image';
import dynamic from 'next/dynamic';
import { trustScoreClass } from '@/lib/trust-score';
import PriceWithKas from '@/components/PriceWithKas';
import { useKasRate } from '@/components/providers/KasRateProvider';

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
  trust_score?: number;
  trust_confidence?: 'low' | 'medium' | 'high';
  trust_drivers?: string[];
  stats?: {
    completed_trades_as_seller: number;
    disputed_trades_as_seller?: number;
    average_rating: number | null;
    total_ratings: number;
    likes?: number;
    dislikes?: number;
    effective_dislikes?: number;
  };
}

interface KasPaymentState {
  payment_id: string;
  kas_deposit_address: string;
  amount_kas: string;
  expires_at: string;
  status: 'awaiting_kas' | 'confirming' | 'converting' | 'settled' | 'expired' | 'manual_review';
  kas_received?: string;
  conversion_status?: string;
  settled_at?: string | null;
}

interface OnchainConfig {
  token_address: string;
  escrow_wallet: string;
  fee_wallet: string;
  chain: 'base';
}

interface TradePreview {
  item_price: number;
  platform_fee: number;
  total_cost: number;
  seller_amount: number;
  dev_amount: number;
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
  const [kasLoading, setKasLoading] = useState(false);
  const [kasPayment, setKasPayment] = useState<KasPaymentState | null>(null);
  const [onchainConfig, setOnchainConfig] = useState<OnchainConfig | null>(null);
  const [tradePreview, setTradePreview] = useState<TradePreview | null>(null);
  const [showTrustBreakdown, setShowTrustBreakdown] = useState(false);
  const { track } = useAnalytics();
  const { address: connectedAddress, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const basePublicClient = usePublicClient({ chainId: base.id });
  const { bankrToKas } = useKasRate();

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

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/payments/config', { cache: 'no-store' });
        if (!res.ok) return;
        const cfg = await res.json();
        setOnchainConfig(cfg);
      } catch {}
    })();
  }, []);

  useEffect(() => {
    if (!listing?.id) return;
    (async () => {
      try {
        const res = await fetch('/api/trades/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ listing_id: listing.id }),
        });
        if (!res.ok) return;
        const data = await res.json();
        setTradePreview({
          item_price: Number(data.item_price || 0),
          platform_fee: Number(data.platform_fee || 0),
          total_cost: Number(data.total_cost || 0),
          seller_amount: Number(data.seller_amount || 0),
          dev_amount: Number(data.dev_amount || 0),
        });
      } catch {}
    })();
  }, [listing?.id]);

  useEffect(() => {
    if (!kasPayment?.payment_id) return;

    const poll = async () => {
      try {
        const res = await fetch(`/api/payments/kas/${kasPayment.payment_id}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        setKasPayment((prev) => prev ? {
          ...prev,
          status: data.status || prev.status,
          kas_received: data.kas_received,
          conversion_status: data.conversion_status,
          settled_at: data.settled_at,
        } : prev);
      } catch {}
    };

    poll();
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, [kasPayment?.payment_id]);

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
      const csrfToken = getCsrfToken();
      const res = await fetch('/api/watchlist', {
        method,
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
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

    if (!currentUserId || !isConnected || !connectedAddress) {
      setShowWalletLogin(true);
      return;
    }

    const bankrToken = onchainConfig?.token_address || '';
    const escrowWallet = onchainConfig?.escrow_wallet || '';
    const devFeeWallet = onchainConfig?.fee_wallet || '';

    if (!bankrToken || !escrowWallet || !devFeeWallet) {
      toast('On-chain payment configuration is missing. Contact admin.', 'error');
      return;
    }

    const isHexAddress = (v: string) => /^0x[a-fA-F0-9]{40}$/.test(v || '');
    if (!isHexAddress(bankrToken) || !isHexAddress(escrowWallet) || !isHexAddress(devFeeWallet)) {
      toast('Invalid on-chain address verification. Contact admin.', 'error');
      return;
    }

    if (connectedAddress.toLowerCase() === escrowWallet.toLowerCase()) {
      toast('Connected wallet cannot be the same as escrow wallet. Please switch wallets.', 'error');
      return;
    }

    if (connectedAddress.toLowerCase() === devFeeWallet.toLowerCase()) {
      toast('Connected wallet cannot be the same as fee wallet. Please switch wallets.', 'error');
      return;
    }

    const preview = tradePreview || {
      item_price: listing.price_bankr,
      platform_fee: Number((listing.price_bankr * 0.05).toFixed(2)),
      total_cost: Number((listing.price_bankr * 1.05).toFixed(2)),
      seller_amount: listing.price_bankr,
      dev_amount: Number((listing.price_bankr * 0.05).toFixed(2)),
    };

    if (!confirm(`Are you sure you want to buy this item?\n\nPrice: ${preview.item_price} BANKR\nFee (5%): ${preview.platform_fee.toFixed(2)} BANKR\nTotal: ${preview.total_cost.toFixed(2)} BANKR\n\nYou will sign a single on-chain BANKR payment transaction.`)) {
      return;
    }

    track('trade_init', { listing_id: listing.id, amount: listing.price_bankr });
    setTradeLoading(true);

    try {
      if (!basePublicClient) {
        toast('Base client unavailable. Please reconnect wallet and retry.', 'error');
        return;
      }

      const totalAmount = parseUnits(preview.total_cost.toFixed(18), 18);

      const escrowTxHash = await writeContractAsync({
        chainId: base.id,
        address: bankrToken as `0x${string}`,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [escrowWallet as `0x${string}`, totalAmount],
      });

      await basePublicClient.waitForTransactionReceipt({ hash: escrowTxHash });

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
          amount: 1,
          payment_mode: 'onchain',
          onchain: {
            chain: 'base',
            token_address: bankrToken,
            buyer_wallet: connectedAddress,
            escrow_wallet: escrowWallet,
            fee_wallet: devFeeWallet,
            escrow_tx_hash: escrowTxHash,
            // Single payment tx now covers item + dev fee in one go.
            fee_tx_hash: escrowTxHash,
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

  const handleBuyWithKas = async () => {
    if (!listing) return;

    if (!isConnected || !connectedAddress) {
      setShowWalletLogin(true);
      toast('Connect your wallet first to start KAS checkout.', 'error');
      return;
    }

    setKasLoading(true);
    try {
      const totalBankr = tradePreview?.total_cost ?? Number((listing.price_bankr * 1.03).toFixed(2));
      const amountKas = (totalBankr * bankrToKas).toFixed(6);

      const res = await fetch('/api/payments/kas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id: listing.id,
          buyer_agent_address: connectedAddress,
          amount_kas: amountKas,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        toast(data?.message || data?.error || 'Failed to start KAS payment', 'error');
        return;
      }

      setKasPayment({
        payment_id: data.payment_id,
        kas_deposit_address: data.kas_deposit_address,
        amount_kas: String(data.amount_kas),
        expires_at: data.expires_at,
        status: data.status,
      });

      toast('KAS payment created. Send KAS to the shown deposit address.', 'success');
    } catch (e: any) {
      toast(e?.message || 'Failed to start KAS payment', 'error');
    } finally {
      setKasLoading(false);
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
              <div className="text-2xl font-mono font-bold text-gold tracking-tight">
                <PriceWithKas bankr={listing.price_bankr} kasClassName="text-sm text-gold/80" />
              </div>
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
                      priceCurrency: 'CDC',
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
                <Link href={`/agent/${listing.seller_name.toLowerCase().replace(/[^a-z0-9\s_-]/g, '').trim().replace(/\s+/g, '-')}`} className="flex items-center gap-4 bg-bg/50 p-4 rounded-xl border border-border hover:border-accent/50 transition-colors">
                  {listing.seller_avatar_url ? (
                    <Image
                      src={listing.seller_avatar_url}
                      alt={listing.seller_name}
                      width={48}
                      height={48}
                      unoptimized
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
                    <p className={`text-xs font-semibold mt-1 ${trustScoreClass(sellerProfile?.trust_score ?? 70)}`}>
                      Trust Score: {sellerProfile?.trust_score ?? 70}
                      {sellerProfile?.trust_confidence ? ` (${sellerProfile.trust_confidence} confidence)` : ''}
                    </p>
                    {sellerProfile?.trust_drivers?.length ? (
                      <p className="text-[11px] text-text-dim mt-1 line-clamp-1">
                        Based on: {sellerProfile.trust_drivers[0]}
                      </p>
                    ) : null}
                    <button
                      onClick={() => setShowTrustBreakdown(true)}
                      className="mt-1 text-[11px] text-accent2 hover:text-accent3"
                    >
                      View trust breakdown
                    </button>
                    {sellerProfile?.stats && (
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-text-dim">
                        <span className="px-2 py-0.5 rounded-full border border-border bg-bg/40">
                          {sellerProfile.stats.completed_trades_as_seller} completed sales
                        </span>
                        <span className="px-2 py-0.5 rounded-full border border-border bg-bg/40">
                          {sellerProfile.stats.average_rating ? sellerProfile.stats.average_rating.toFixed(1) : '-'} avg rating ({sellerProfile.stats.total_ratings})
                        </span>
                      </div>
                    )}
                  </div>
                </Link>
              </div>
            </div>

            <div className="space-y-6">
              <div className="bg-bg/50 rounded-xl p-5 border border-border">
                <h3 className="text-sm font-bold uppercase tracking-wider text-text-dim mb-4">Transaction Summary</h3>
                
                <div className="space-y-3 text-sm mb-6">
                  <div className="flex justify-between">
                    <span className="text-text-dim">Item Price</span>
                    <span className="font-mono"><PriceWithKas bankr={tradePreview?.item_price ?? listing.price_bankr} /></span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-dim">Platform Fee (5%)</span>
                    <span className="font-mono text-text-dim"><PriceWithKas bankr={tradePreview?.platform_fee ?? Number((listing.price_bankr * 0.05).toFixed(2))} /></span>
                  </div>
                  <div className="h-px bg-border my-2"></div>
                  <div className="flex justify-between font-bold text-white">
                    <span>Total Cost</span>
                    <span className="font-mono text-gold"><PriceWithKas bankr={tradePreview?.total_cost ?? Number((listing.price_bankr * 1.05).toFixed(2))} kasClassName="text-gold/80" /></span>
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
                    <>
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
                          'Buy with BANKR 🚀'
                        )}
                      </button>

                      <button
                        onClick={handleBuyWithKas}
                        disabled={kasLoading}
                        className="btn-secondary w-full py-3 mt-2"
                      >
                        {kasLoading ? 'Preparing KAS checkout…' : 'Buy with KAS'}
                      </button>
                    </>
                  )
                ) : (
                  <button disabled className="btn-secondary w-full py-3 opacity-50 cursor-not-allowed">
                    {listing.status === 'sold' ? 'Sold Out' : 'Unavailable'}
                  </button>
                )}

                {kasPayment && (
                  <div className="mt-3 p-3 rounded-lg border border-border bg-bg/40 text-xs space-y-1">
                    <div className="font-semibold text-text">KAS Checkout</div>
                    <div>Status: <span className="text-accent2">{kasPayment.status}</span></div>
                    <div>Amount: {kasPayment.amount_kas} KAS</div>
                    <div className="break-all">Deposit: {kasPayment.kas_deposit_address}</div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(kasPayment.kas_deposit_address);
                            toast('Copied KAS deposit address', 'success');
                          } catch {
                            toast('Failed to copy address', 'error');
                          }
                        }}
                        className="btn-secondary text-[11px] py-1 px-2"
                      >
                        Copy Address
                      </button>
                    </div>
                    <div className="mt-2">
                      <Image
                        src={`https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(kasPayment.kas_deposit_address)}`}
                        alt="KAS deposit QR"
                        width={112}
                        height={112}
                        unoptimized
                        className="w-28 h-28 rounded border border-border bg-white p-1"
                      />
                    </div>
                    <div className="text-text-dim">Expires: {new Date(kasPayment.expires_at).toLocaleString()}</div>
                    {kasPayment.kas_received && <div>Received: {kasPayment.kas_received} KAS</div>}
                    {kasPayment.conversion_status && <div>Conversion: {kasPayment.conversion_status}</div>}
                    {kasPayment.settled_at && <div className="text-green-400">Settled at {new Date(kasPayment.settled_at).toLocaleString()}</div>}
                  </div>
                )}
                
                <p className="text-[10px] text-text-dim text-center mt-3 leading-tight">
                  Payment settles on-chain via Base. Funds release to seller on confirmation.
                </p>
              </div>
            </div>
          </div>
        </div>
        {showTrustBreakdown && (
          <div className="fixed inset-0 z-[210] bg-black/60 flex items-center justify-center p-4">
            <div className="w-full max-w-lg rounded-2xl border border-border bg-bg p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-bold">Trust Breakdown</h3>
                <button className="text-text-dim hover:text-text" onClick={() => setShowTrustBreakdown(false)}>Close</button>
              </div>
              <div className="space-y-2 text-sm">
                <p><span className="text-text-dim">Score:</span> <span className={trustScoreClass(sellerProfile?.trust_score ?? 70)}>{sellerProfile?.trust_score ?? 70}</span></p>
                <p><span className="text-text-dim">Confidence:</span> {sellerProfile?.trust_confidence || 'low'}</p>
                <p><span className="text-text-dim">Completed sales:</span> {sellerProfile?.stats?.completed_trades_as_seller ?? 0}</p>
                <p><span className="text-text-dim">Disputes:</span> {sellerProfile?.stats?.disputed_trades_as_seller ?? 0}</p>
                <p><span className="text-text-dim">Ratings:</span> {sellerProfile?.stats?.total_ratings ?? 0} ({sellerProfile?.stats?.average_rating ? sellerProfile.stats.average_rating.toFixed(1) : '-' } avg)</p>
                <p><span className="text-text-dim">Likes / Dislikes:</span> {sellerProfile?.stats?.likes ?? 0} / {sellerProfile?.stats?.dislikes ?? 0}</p>
                <p><span className="text-text-dim">Effective dislikes:</span> {sellerProfile?.stats?.effective_dislikes ?? 0}</p>
                {sellerProfile?.trust_drivers?.length ? (
                  <div className="pt-2">
                    <p className="text-text-dim mb-1">Score drivers:</p>
                    <ul className="list-disc ml-5 space-y-1 text-xs text-text-dim">
                      {sellerProfile.trust_drivers.map((d, i) => <li key={i}>{d}</li>)}
                    </ul>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        )}

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
