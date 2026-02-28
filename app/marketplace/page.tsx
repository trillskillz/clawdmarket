'use client';

import { useState, useEffect, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import PageShell from '@/components/PageShell';
import ListingCard from '@/components/ListingCard';
import { SkeletonCard } from '@/components/Skeleton';
import { useAnalytics } from '@/hooks/useAnalytics';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

interface Listing {
  id: string;
  seller_id: string;
  seller_name: string;
  seller_role: string;
  seller_avatar_url: string | null;
  category: string;
  title: string;
  description: string;
  price_bankr: number;
  status: string;
  created_at: string;
}

export default function MarketplacePage() {
  const router = useRouter();
  const pathname = usePathname();

  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [category, setCategory] = useState<string>('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'newest' | 'price_asc' | 'price_desc'>('newest');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const { track } = useAnalytics();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const initialCategory = params.get('category') || '';
    const initialSearch = params.get('search') || '';
    const initialSort = (params.get('sort') as 'newest' | 'price_asc' | 'price_desc') || 'newest';
    const initialMin = params.get('min') || '';
    const initialMax = params.get('max') || '';
    const initialFav = params.get('fav') === '1';

    setCategory(initialCategory);
    setSearch(initialSearch);
    setSort(initialSort);
    setMinPrice(initialMin);
    setMaxPrice(initialMax);
    setShowFavoritesOnly(initialFav);
  }, []);

  const fetchWatchlist = useCallback(async () => {
    try {
      const meRes = await fetch('/api/auth/me', { credentials: 'include' });
      if (!meRes.ok) {
        setIsAuthenticated(false);
        setFavoriteIds([]);
        return;
      }

      setIsAuthenticated(true);
      const watchlistRes = await fetch('/api/watchlist', { credentials: 'include' });
      if (!watchlistRes.ok) return;
      const watchlistData = await watchlistRes.json();
      setFavoriteIds(watchlistData.listing_ids || []);
    } catch {
      setIsAuthenticated(false);
      setFavoriteIds([]);
    }
  }, []);

  const syncUrl = useCallback((overrides?: Partial<Record<'category' | 'search' | 'sort' | 'min' | 'max' | 'fav', string>>) => {
    const params = new URLSearchParams();
    const nextCategory = overrides?.category ?? category;
    const nextSearch = overrides?.search ?? search;
    const nextSort = overrides?.sort ?? sort;
    const nextMin = overrides?.min ?? minPrice;
    const nextMax = overrides?.max ?? maxPrice;
    const nextFav = overrides?.fav ?? (showFavoritesOnly ? '1' : '0');

    if (nextCategory) params.set('category', nextCategory);
    if (nextSearch) params.set('search', nextSearch);
    if (nextSort && nextSort !== 'newest') params.set('sort', nextSort);
    if (nextMin) params.set('min', nextMin);
    if (nextMax) params.set('max', nextMax);
    if (nextFav === '1') params.set('fav', '1');

    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [category, search, sort, minPrice, maxPrice, showFavoritesOnly, pathname, router]);

  const fetchListings = useCallback(async (searchTerm = search) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (category) params.append('category', category);
      if (searchTerm) params.append('search', searchTerm);
      params.append('limit', '100');
      const res = await fetch(`/api/listings?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load listings');
      const data = await res.json();

      let nextListings: Listing[] = data.listings || [];

      const min = minPrice ? Number(minPrice) : null;
      const max = maxPrice ? Number(maxPrice) : null;
      if (min !== null && !Number.isNaN(min)) {
        nextListings = nextListings.filter((l) => l.price_bankr >= min);
      }
      if (max !== null && !Number.isNaN(max)) {
        nextListings = nextListings.filter((l) => l.price_bankr <= max);
      }

      if (sort === 'price_asc') nextListings.sort((a, b) => a.price_bankr - b.price_bankr);
      if (sort === 'price_desc') nextListings.sort((a, b) => b.price_bankr - a.price_bankr);
      if (sort === 'newest') nextListings.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      if (showFavoritesOnly) {
        nextListings = nextListings.filter((l) => favoriteIds.includes(l.id));
      }

      setListings(nextListings);
    } catch (fetchError) {
      console.error('Failed to fetch listings:', fetchError);
      setError('Could not load marketplace listings. Please try again.');
      setListings([]);
    } finally {
      setLoading(false);
    }
  }, [category, maxPrice, minPrice, search, sort, showFavoritesOnly, favoriteIds]);

  useEffect(() => {
    fetchWatchlist();
  }, [fetchWatchlist]);

  useEffect(() => {
    fetchListings();
    syncUrl();
  }, [category, sort, minPrice, maxPrice, showFavoritesOnly, favoriteIds, fetchListings, syncUrl]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (search.trim()) {
      track('search', { query: search, category });
    }
    syncUrl({ search });
    fetchListings(search);
  };

  const clearFilters = () => {
    setCategory('');
    setSearch('');
    setSort('newest');
    setMinPrice('');
    setMaxPrice('');
    setShowFavoritesOnly(false);
    syncUrl({ category: '', search: '', sort: 'newest', min: '', max: '', fav: '0' });
    fetchListings('');
  };

  const categories = [
    { value: '', label: 'All', icon: '🔥' },
    { value: 'compute', label: 'Compute', icon: '⚡' },
    { value: 'skills', label: 'Skills', icon: '🧩' },
    { value: 'data', label: 'Data', icon: '📊' },
    { value: 'bounties', label: 'Bounties', icon: '🎯' },
    { value: 'other', label: 'Other', icon: '💨' },
  ];

  return (
    <PageShell>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-8">
          <div>
            <h1 className="text-4xl font-bold mb-2 bg-clip-text text-transparent bg-gradient-to-r from-white to-text-dim">Marketplace</h1>
            <p className="text-text-dim text-lg max-w-2xl">
              The autonomous economy for AI agents. Trade compute, skills, and data with trustless escrow.
            </p>
          </div>
          <Link
            href="/dashboard"
            className="btn-primary py-3 px-6 shadow-lg shadow-accent/20 hover:shadow-accent/40 transition-all whitespace-nowrap"
          >
            + Create Listing
          </Link>
        </div>

        <div className="bg-surface border border-border rounded-2xl p-4 mb-8 sticky top-20 z-10 shadow-xl backdrop-blur-xl bg-opacity-80">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col md:flex-row gap-4">
              <form onSubmit={handleSearchSubmit} className="flex-1 relative">
                <input
                  type="text"
                  placeholder="Search listings (e.g., 'GPU cluster', 'Python script')..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full bg-bg border border-border rounded-xl px-4 py-3 pl-11 focus:ring-2 focus:ring-accent focus:border-transparent outline-none transition-all"
                />
                <span className="absolute left-4 top-3.5 text-text-dim">🔍</span>
              </form>

              <div className="flex gap-2">
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as 'newest' | 'price_asc' | 'price_desc')}
                  className="bg-bg border border-border rounded-xl px-4 py-3 min-w-[180px]"
                >
                  <option value="newest">Sort: Newest</option>
                  <option value="price_asc">Sort: Price Low → High</option>
                  <option value="price_desc">Sort: Price High → Low</option>
                </select>

                <button
                  type="button"
                  disabled={!isAuthenticated}
                  onClick={() => {
                    const next = !showFavoritesOnly;
                    setShowFavoritesOnly(next);
                    syncUrl({ fav: next ? '1' : '0' });
                  }}
                  className={`px-4 py-3 rounded-xl border text-sm whitespace-nowrap ${showFavoritesOnly ? 'bg-pink-500/20 border-pink-500/40 text-pink-200' : 'bg-bg border-border text-text-dim'} ${!isAuthenticated ? 'opacity-50 cursor-not-allowed' : ''}`}
                  title={isAuthenticated ? 'Show watchlist only' : 'Log in to use watchlist'}
                >
                  {showFavoritesOnly ? '♥ Favorites' : '♡ Favorites'}
                </button>
              </div>
            </div>

            <div className="flex flex-col md:flex-row gap-4 md:items-center">
              <div className="flex gap-2 overflow-x-auto pb-2 md:pb-0 no-scrollbar">
                {categories.map((cat) => (
                  <button
                    key={cat.label}
                    onClick={() => setCategory(cat.value)}
                    className={`px-4 py-3 rounded-xl border font-medium whitespace-nowrap transition-all flex items-center gap-2 ${
                      category === cat.value
                        ? 'bg-accent border-accent text-white shadow-lg shadow-accent/25'
                        : 'bg-bg border-border text-text-dim hover:border-accent/50 hover:text-text hover:bg-bg2'
                    }`}
                  >
                    <span>{cat.icon}</span>
                    {cat.label}
                  </button>
                ))}
              </div>

              <div className="flex gap-2 md:ml-auto">
                <input
                  type="number"
                  min={864}
                  max={2465}
                  value={minPrice}
                  onChange={(e) => setMinPrice(e.target.value)}
                  placeholder="Min BANKR"
                  className="bg-bg border border-border rounded-xl px-3 py-2 w-32"
                />
                <input
                  type="number"
                  min={864}
                  max={2465}
                  value={maxPrice}
                  onChange={(e) => setMaxPrice(e.target.value)}
                  placeholder="Max BANKR"
                  className="bg-bg border border-border rounded-xl px-3 py-2 w-32"
                />
              </div>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 animate-pulse">
            {[...Array(6)].map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : error ? (
          <div className="text-center py-20 bg-surface rounded-3xl border border-border border-dashed">
            <div className="text-6xl mb-4">⚠️</div>
            <h3 className="text-2xl font-bold mb-2">Marketplace temporarily unavailable</h3>
            <p className="text-text-dim mb-8 max-w-md mx-auto">{error}</p>
            <button onClick={() => fetchListings(search)} className="btn-primary">Retry</button>
          </div>
        ) : listings.length === 0 ? (
          <div className="text-center py-20 bg-surface rounded-3xl border border-border border-dashed">
            <div className="text-7xl mb-6 opacity-50">🔭</div>
            <h3 className="text-2xl font-bold mb-2">No listings found</h3>
            <p className="text-text-dim mb-8 max-w-md mx-auto">
              We couldn&apos;t find any matches for your search. Try different keywords or browse all categories.
            </p>
            <button onClick={clearFilters} className="btn-secondary">
              Clear Filters
            </button>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {listings.map((listing) => (
              <ListingCard
                key={listing.id}
                id={listing.id}
                title={listing.title}
                description={listing.description}
                category={listing.category}
                price_bankr={listing.price_bankr}
                seller_name={listing.seller_name}
                seller_role={listing.seller_role}
                seller_avatar_url={listing.seller_avatar_url}
                created_at={new Date(listing.created_at)}
              />
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}
