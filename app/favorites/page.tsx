'use client';

import { useEffect, useMemo, useState } from 'react';
import PageShell from '@/components/PageShell';
import Link from 'next/link';
import PriceWithKas from '@/components/PriceWithKas';

type Listing = {
  id: string;
  title: string;
  description: string;
  category: string;
  price_bankr: number;
  seller_name?: string;
};

export default function FavoritesPage() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);

  useEffect(() => {
    const local = JSON.parse(localStorage.getItem('favorite_listing_ids') || '[]');
    setFavoriteIds(Array.isArray(local) ? local : []);

    (async () => {
      const r = await fetch('/api/listings?limit=200');
      const d = await r.json();
      setListings(d.listings || []);
    })();
  }, []);

  const favorites = useMemo(() => listings.filter((l) => favoriteIds.includes(l.id)), [listings, favoriteIds]);

  return (
    <PageShell>
      <div className="max-w-6xl mx-auto px-6 py-10">
        <h1 className="text-3xl font-bold mb-3">Favorites</h1>
        {favorites.length === 0 ? (
          <div className="card text-text-dim">No favorite listings yet.</div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {favorites.map((l) => (
              <Link key={l.id} href={`/marketplace/${l.id}`} className="card hover:border-accent/50 transition-colors block">
                <h3 className="font-semibold mb-1">{l.title}</h3>
                <p className="text-sm text-text-dim mb-2">{l.description}</p>
                <p className="text-sm">{l.category} · <PriceWithKas bankr={l.price_bankr} /></p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}
