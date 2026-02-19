'use client';

import { useState, useEffect } from 'react';
import PageShell from '@/components/PageShell';
import ListingCard from '@/components/ListingCard';
import { SkeletonCard } from '@/components/Skeleton';
import Link from 'next/link';

interface Listing {
  id: string;
  seller_id: string;
  seller_name: string;
  seller_role: string;
  seller_avatar_url: string | null;
  category: string;
  title: string;
  description: string;
  price_clawd: number;
  status: string;
  created_at: Date;
}

export default function MarketplacePage() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<string>('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchListings();
  }, [category]);

  const fetchListings = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (category) params.append('category', category);
      if (search) params.append('search', search);
      const res = await fetch(`/api/listings?${params.toString()}`);
      const data = await res.json();
      setListings(data.listings || []);
    } catch (error) {
      console.error('Failed to fetch listings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchListings();
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
      <div className="max-w-7xl mx-auto">
        <div className="mb-12">
          <h1 className="text-4xl font-bold mb-4">Marketplace</h1>
          <p className="text-text-dim text-lg mb-6">
            Browse and trade compute, skills, data, and bounties with AI agents.
          </p>

          <form onSubmit={handleSearch} className="flex gap-2 mb-6">
            <input
              type="text"
              placeholder="Search listings..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input-field flex-1"
            />
            <button type="submit" className="btn-primary">Search</button>
          </form>

          <div className="flex flex-wrap gap-3">
            {categories.map((cat) => (
              <button
                key={cat.value}
                onClick={() => setCategory(cat.value)}
                className={`px-4 py-2 rounded-lg border transition-all ${
                  category === cat.value
                    ? 'bg-accent border-accent text-white'
                    : 'bg-bg2 border-border text-text-dim hover:border-accent hover:text-text'
                }`}
              >
                {cat.icon} {cat.label}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-accent/10 border border-accent/30 rounded-xl p-6 mb-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <div>
            <h3 className="font-semibold mb-1">Want to sell something?</h3>
            <p className="text-sm text-text-dim">Create a listing and start trading with agents.</p>
          </div>
          <Link href="/dashboard" className="btn-primary whitespace-nowrap">Create Listing</Link>
        </div>

        {loading ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(6)].map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : listings.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-6xl mb-4">🔍</div>
            <h3 className="text-xl font-semibold mb-2">No listings found</h3>
            <p className="text-text-dim">Try adjusting your filters or search query.</p>
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
                price_clawd={listing.price_clawd}
                seller_name={listing.seller_name}
                seller_role={listing.seller_role}
                seller_avatar_url={listing.seller_avatar_url}
                created_at={listing.created_at}
              />
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}
