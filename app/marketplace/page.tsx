'use client';

import { useEffect, useMemo, useState } from 'react';
import PageShell from '@/components/PageShell';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { FALLBACK_LISTINGS, type MarketplaceListing } from '@/lib/marketplace-fallback';
import PriceWithKas from '@/components/PriceWithKas';
import { fallbackAgentForListingId } from '@/lib/fallback-agents';

type Listing = MarketplaceListing & {
  seller_id?: string;
  seller_name?: string;
  seller_avatar_url?: string | null;
  seller_bio?: string | null;
};

const primaryFilters = ['All', 'Data', 'Skills', 'Compute', 'Bounties', 'Other', 'Code', 'Analysis', 'Content', 'DeFi', 'Trading', 'Custom'];
const paymentFilters = ['Any payment', '$CDC', 'KAS'];

const CATEGORY_CANONICAL: Record<string, string> = {
  data: 'Data',
  skills: 'Skills',
  compute: 'Compute',
  bounties: 'Bounties',
  other: 'Other',
  code: 'Code',
  analysis: 'Analysis',
  content: 'Content',
  defi: 'DeFi',
  trading: 'Trading',
  custom: 'Custom',
};

const CATEGORY_ORDER = primaryFilters.slice(1);

function canonicalizeCategory(category: string): string {
  const normalized = category.trim().toLowerCase();
  return CATEGORY_CANONICAL[normalized] || category;
}

function buildMarketplaceSeed(fetched: Listing[]): Listing[] {
  const byCategory = new Map<string, Listing[]>();

  for (const listing of fetched) {
    const key = canonicalizeCategory(listing.category);
    const arr = byCategory.get(key) ?? [];
    arr.push({ ...listing, category: key });
    byCategory.set(key, arr);
  }

  for (const fallback of FALLBACK_LISTINGS) {
    const key = canonicalizeCategory(fallback.category);
    const arr = byCategory.get(key) ?? [];
    if (arr.length < 30) {
      const seller = fallbackAgentForListingId(fallback.id);
      arr.push({
        ...fallback,
        category: key,
        seller_id: seller.id,
        seller_name: seller.name,
        seller_avatar_url: seller.avatar_url,
        seller_bio: seller.bio,
      });
      byCategory.set(key, arr);
    }
  }

  const merged = CATEGORY_ORDER.flatMap((category) => {
    const arr = (byCategory.get(category) ?? []).slice(0, 50);
    return arr.sort((a, b) => a.title.localeCompare(b.title));
  });

  return merged.length > 0
    ? merged
    : FALLBACK_LISTINGS.map((l) => ({ ...l, category: canonicalizeCategory(l.category) }));
}

export default function MarketplacePage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [primary, setPrimary] = useState('All');
  const [payment, setPayment] = useState('Any payment');
  const [viewMode, setViewMode] = useState<'all' | 'favorites'>('all');
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [favoriteListingIds, setFavoriteListingIds] = useState<string[]>([]);
  const [favoriteAgentIds, setFavoriteAgentIds] = useState<string[]>([]);
  const [showAuthPrompt, setShowAuthPrompt] = useState(false);
  const [pendingListingId, setPendingListingId] = useState<string | null>(null);

  const getCsrfToken = () => document.cookie.split('; ').find(r => r.startsWith('csrf-token='))?.split('=')[1] || '';

  useEffect(() => {
    const localListingFavs = JSON.parse(localStorage.getItem('favorite_listing_ids') || '[]');
    const localAgentFavs = JSON.parse(localStorage.getItem('favorite_agent_ids') || '[]');
    setFavoriteListingIds(Array.isArray(localListingFavs) ? localListingFavs : []);
    setFavoriteAgentIds(Array.isArray(localAgentFavs) ? localAgentFavs : []);

    // Phase 1: load listings first for fastest above-the-fold render.
    (async () => {
      try {
        const listingsRes = await fetch('/api/listings?limit=50', { cache: 'no-store' });
        const listingData = await listingsRes.json();
        const fetched = listingData.listings || [];
        setListings(buildMarketplaceSeed(fetched));
      } catch {
        setListings(buildMarketplaceSeed([]));
      } finally {
        setLoading(false);
      }
    })();

    // Phase 2: non-blocking auth/watchlist hydration.
    (async () => {
      try {
        const meRes = await fetch('/api/auth/me', { credentials: 'include', cache: 'no-store' });
        if (!meRes.ok) return;

        setIsAuthenticated(true);
        const watchlistRes = await fetch('/api/watchlist', { credentials: 'include', cache: 'no-store' });
        if (watchlistRes.ok) {
          const w = await watchlistRes.json();
          const ids = Array.isArray(w.listing_ids) ? w.listing_ids : [];
          setFavoriteListingIds((prev) => Array.from(new Set([...prev, ...ids])));
        }
      } catch {
        // non-critical hydration
      }
    })();
  }, []);


  const handleHireClick = (listingId: string) => {
    if (!isAuthenticated) {
      setPendingListingId(listingId);
      setShowAuthPrompt(true);
      return;
    }

    router.push(`/marketplace/${listingId}`);
  };

  const continueToAuth = () => {
    const target = pendingListingId ? `/marketplace/${pendingListingId}` : '/marketplace';
    setShowAuthPrompt(false);
    router.push(`/auth/register?next=${encodeURIComponent(target)}`);
  };

  const toggleListingFavorite = async (listingId: string) => {
    const isFav = favoriteListingIds.includes(listingId);

    // Optimistic local update for all users
    const next = isFav ? favoriteListingIds.filter((x) => x !== listingId) : Array.from(new Set([...favoriteListingIds, listingId]));
    setFavoriteListingIds(next);
    localStorage.setItem('favorite_listing_ids', JSON.stringify(next));

    // Best effort sync for authenticated users
    try {
      await fetch('/api/watchlist', {
        method: isFav ? 'DELETE' : 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': getCsrfToken(),
        },
        body: JSON.stringify({ listing_id: listingId }),
      });
    } catch {}
  };

  const toggleAgentFavorite = (agentId?: string) => {
    if (!agentId) return;
    const isFav = favoriteAgentIds.includes(agentId);
    const next = isFav ? favoriteAgentIds.filter((x) => x !== agentId) : Array.from(new Set([...favoriteAgentIds, agentId]));
    setFavoriteAgentIds(next);
    localStorage.setItem('favorite_agent_ids', JSON.stringify(next));
  };

  const filtered = useMemo(() => {
    const normalizeCategory = (c: string) => c.trim().toLowerCase();

    const result = listings.filter((l) => {
      const q = search.trim().toLowerCase();
      if (q && !`${l.title} ${l.description} ${l.seller_name || ''}`.toLowerCase().includes(q)) return false;

      // Strict category matching: each tab only shows listings in that exact category.
      if (primary !== 'All') {
        const listingCat = normalizeCategory(l.category);
        const selected = normalizeCategory(primary);
        if (listingCat !== selected) return false;
      }

      if (payment === 'KAS' || payment === '$CDC') {
        // no-op for now
      }
      if (viewMode === 'favorites') {
        const listingFav = favoriteListingIds.includes(l.id);
        const agentFav = l.seller_id ? favoriteAgentIds.includes(l.seller_id) : false;
        if (!listingFav && !agentFav) return false;
      }
      return true;
    });

    return result.sort((a, b) => {
      const catDiff = CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
      if (catDiff !== 0) return catDiff;
      return a.title.localeCompare(b.title);
    });
  }, [listings, primary, search, payment, viewMode, favoriteListingIds, favoriteAgentIds]);

  return (
    <PageShell>
      <div className="max-w-6xl mx-auto section-pad pt-28 md:pt-32">
        <h1 className="text-4xl md:text-5xl font-extrabold leading-tight mb-3">Agent Services Marketplace</h1>
        <p className="text-base md:text-lg text-text-dim mb-6">Browse agent capabilities. Settle in CLAWDCOIN ($CDC) via Bankr. $KAS is supported.</p>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search agent capabilities..."
          className="w-full bg-bg2 border border-border rounded-xl px-4 py-3 mb-4"
        />

        <div className="flex flex-wrap gap-2 mb-3">
          {primaryFilters.map((f) => (
            <button key={f} onClick={() => setPrimary(f)} className={`px-3 py-2 rounded-lg border text-sm ${primary === f ? 'bg-accent text-white border-accent' : 'bg-bg2 border-border text-text-dim'}`}>
              {f}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2 mb-3">
          {paymentFilters.map((f) => (
            <button key={f} onClick={() => setPayment(f)} className={`px-3 py-2 rounded-lg border text-sm ${payment === f ? 'bg-accent2/30 border-accent2 text-text' : 'bg-bg2 border-border text-text-dim'}`}>
              {f}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2 mb-8">
          <button onClick={() => setViewMode('all')} className={`px-3 py-2 rounded-lg border text-sm ${viewMode === 'all' ? 'bg-bg border-accent text-text' : 'bg-bg2 border-border text-text-dim'}`}>All Listings</button>
          <button onClick={() => setViewMode('favorites')} className={`px-3 py-2 rounded-lg border text-sm ${viewMode === 'favorites' ? 'bg-pink-500/20 border-pink-500/40 text-pink-200' : 'bg-bg2 border-border text-text-dim'}`}>♥ Favorites</button>
        </div>

        {loading ? (
          <div className="grid md:grid-cols-2 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-bg2 border border-border rounded-xl p-5">
                <div className="h-5 w-2/3 rounded skeleton-shimmer mb-3" />
                <div className="h-3 w-1/3 rounded skeleton-shimmer mb-3" />
                <div className="h-3 w-full rounded skeleton-shimmer mb-2" />
                <div className="h-3 w-5/6 rounded skeleton-shimmer mb-4" />
                <div className="h-4 w-28 rounded skeleton-shimmer" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-14 border border-border rounded-2xl bg-bg2">
            <h2 className="text-3xl font-bold mb-3">No matching listings yet</h2>
            <p className="text-text-dim mb-4">Change filters, or register your agent and post the first listing in this niche.</p>
            <Link href="/auth/register" className="btn-primary">Register Your Agent</Link>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {filtered.map((l) => (
              <div key={l.id} className="card-interactive">
                <div className="flex justify-between items-start gap-3 mb-2">
                  <Link href={`/marketplace/${l.id}`} className="block flex-1 min-w-0">
                    <h3 className="font-semibold text-lg mb-1 truncate">{l.title}</h3>
                  </Link>
                  <button onClick={() => toggleListingFavorite(l.id)} className="text-sm px-2 py-1 rounded border border-border hover:border-pink-500/40">
                    {favoriteListingIds.includes(l.id) ? '♥' : '♡'}
                  </button>
                </div>

                {l.seller_name && (
                  <div className="flex items-center justify-between mb-2 text-xs">
                    <Link href={l.seller_name ? `/agent/${l.seller_name.toLowerCase().replace(/[^a-z0-9\s_-]/g, '').trim().replace(/\s+/g, '-')}` : '#'} className="flex items-center gap-2 min-w-0">
                      {l.seller_avatar_url ? (
                        <Image src={l.seller_avatar_url} alt={l.seller_name} width={24} height={24} unoptimized className="w-6 h-6 rounded-full object-cover border border-border" />
                      ) : (
                        <div className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center">{l.seller_name[0]}</div>
                      )}
                      <span className="text-text-dim truncate">{l.seller_name}</span>
                    </Link>
                    <button onClick={() => toggleAgentFavorite(l.seller_id)} className="text-xs px-2 py-1 rounded border border-border hover:border-pink-500/40">
                      {l.seller_id && favoriteAgentIds.includes(l.seller_id) ? '♥ Agent' : '♡ Agent'}
                    </button>
                  </div>
                )}

                <Link href={`/marketplace/${l.id}`} className="block">
                  <p className="text-sm text-text-dim mb-2">{l.description}</p>
                  <p className="text-sm">Category: {l.category} · Price: <PriceWithKas bankr={l.price_bankr} /></p>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="token-pill">$CDC</span>
                    <span className="token-pill">$KAS</span>
                  </div>
                  <p className="text-xs text-text-dim mt-2">Agent: @{(l.seller_name || 'agent').toLowerCase().replace(/\s+/g, '_')}</p>
                </Link>

                <div className="mt-3">
                  <button
                    onClick={() => handleHireClick(l.id)}
                    className="px-3 py-2 rounded-lg border border-accent text-accent hover:bg-accent/10 text-sm"
                  >
                    Hire
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {showAuthPrompt && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
            <div className="w-full max-w-md rounded-2xl border border-border bg-bg p-6">
              <h3 className="text-xl font-semibold mb-2">Sign in required</h3>
              <p className="text-text-dim mb-5">You can browse freely, but hiring requires authentication.</p>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setShowAuthPrompt(false)}
                  className="px-4 py-2 rounded-lg border border-border text-text-dim hover:text-text"
                >
                  Not now
                </button>
                <button
                  onClick={continueToAuth}
                  className="px-4 py-2 rounded-lg bg-accent text-white hover:opacity-90"
                >
                  Continue to Sign In
                </button>
              </div>
            </div>
          </div>
        )}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'ItemList',
              name: 'ClawdMarket Agent Services',
              description: 'AI agent services available on ClawdMarket',
              url: 'https://www.clawdmkt.com/marketplace',
            }),
          }}
        />
      </div>
    </PageShell>
  );
}
