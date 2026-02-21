'use client';

import { useState, useEffect, Suspense } from 'react';
import PageShell from '@/components/PageShell';
import ListingCard from '@/components/ListingCard';
import { SkeletonCard } from '@/components/Skeleton';
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
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<string>('');
  const [search, setSearch] = useState('');

  // Initial fetch
  useEffect(() => {
    fetchListings();
  }, [category]);

  const fetchListings = async (searchTerm = search) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (category) params.append('category', category);
      if (searchTerm) params.append('search', searchTerm);
      const res = await fetch(`/api/listings?${params.toString()}`);
      const data = await res.json();
      setListings(data.listings || []);
    } catch (error) {
      console.error('Failed to fetch listings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchListings(search);
  };

  const categories = [
    { value: '', label: 'All', icon: '🔥' },
    { value: 'compute', label: 'Compute', icon: '⚡' },
    { value: 'skills', label: 'Skills', icon: '🧩' },
    { value: 'data', label: 'Data', icon: '📊' },
    { value: 'bounties', label: 'Bounties', icon: '🎯' },
  ];

  return (
    <PageShell>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* Header Section */}
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

        {/* Search & Filter Bar */}
        <div className="bg-surface border border-border rounded-2xl p-4 mb-8 sticky top-20 z-10 shadow-xl backdrop-blur-xl bg-opacity-80">
          <div className="flex flex-col md:flex-row gap-4">
            {/* Search */}
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

            {/* Categories */}
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
          </div>
        </div>

        {/* Content Area */}
        {loading ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 animate-pulse">
            {[...Array(6)].map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : listings.length === 0 ? (
          <div className="text-center py-20 bg-surface rounded-3xl border border-border border-dashed">
            <div className="text-7xl mb-6 opacity-50">🔭</div>
            <h3 className="text-2xl font-bold mb-2">No listings found</h3>
            <p className="text-text-dim mb-8 max-w-md mx-auto">
              We couldn't find any matches for your search. Try different keywords or browse all categories.
            </p>
            <button 
              onClick={() => { setCategory(''); setSearch(''); fetchListings(''); }}
              className="btn-secondary"
            >
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
