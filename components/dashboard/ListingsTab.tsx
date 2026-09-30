'use client';

import { useState } from 'react';
import { useToast } from '@/components/Toast';
import PriceWithKas from '@/components/PriceWithKas';
import { SkeletonListItem } from '@/components/Skeleton';
import Link from 'next/link';
import { trackClientEvent } from '@/lib/client-analytics';

interface Listing {
  id: string;
  title: string;
  category: string;
  price_bankr: number;
  status: string;
  created_at: string;
  external_payment_ready?: boolean;
}

interface ListingsTabProps {
  listings: Listing[];
  total: number;
  loading: boolean;
  loadingMore: boolean;
  onLoadMore: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onOpenWallet: () => void;
  getCsrfToken: () => string;
}

export default function ListingsTab({ listings, total, loading, loadingMore, onLoadMore, onRefresh, onOpenWallet, getCsrfToken }: ListingsTabProps) {
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    category: 'analysis' as 'compute' | 'skills' | 'data' | 'code' | 'analysis' | 'bounties' | 'other',
    title: '',
    description: '',
    price_bankr: '',
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/listings', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': getCsrfToken(),
        },
        body: JSON.stringify({
          category: form.category,
          title: form.title,
          description: form.description,
          price_usd: parseFloat(form.price_bankr),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setShowCreate(false);
        setForm({ category: 'analysis', title: '', description: '', price_bankr: '' });
        toast(data.external_payment_ready
          ? 'Listing is live and ready to hire.'
          : 'Listing published. Add a payout wallet before buyers can hire you.', data.external_payment_ready ? 'success' : 'info');
        trackClientEvent('listing_created', { category: form.category, price_usd: Number(form.price_bankr) });
        await onRefresh();
      } else {
        const data = await res.json();
        toast(data.error || 'Failed to create listing', 'error');
      }
    } catch {
      toast('Network error. Please try again.', 'error');
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => <SkeletonListItem key={i} />)}
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-semibold">Your Listings</h2>
        <button onClick={() => setShowCreate(!showCreate)} className="btn-primary">
          + Create Listing
        </button>
      </div>

      {listings.some((listing) => listing.status === 'active' && !listing.external_payment_ready) && (
        <div className="card mb-6 border-amber-300/30 bg-amber-300/10" role="status">
          <p className="font-semibold text-amber-100">Payout setup required</p>
          <p className="mt-1 text-sm text-text-dim">Your active listings cannot accept external payments until you save an EVM payout wallet.</p>
          <button type="button" onClick={onOpenWallet} className="btn-secondary mt-3">Set payout wallet</button>
        </div>
      )}

      {showCreate && (
        <div className="card mb-6 animate-fade-in-up">
          <h3 className="text-lg font-semibold mb-4">Create New Listing</h3>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label htmlFor="listing-category" className="block text-sm font-medium mb-2">Category</label>
              <select
                id="listing-category"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value as any })}
                className="input-field"
              >
                <option value="analysis">🔎 Research &amp; Analysis</option>
                <option value="code">⌨ Code Review &amp; Development</option>
                <option value="compute">⚡ Compute</option>
                <option value="skills">🧩 Skills</option>
                <option value="data">📊 Data</option>
                <option value="bounties">🎯 Bounties</option>
                <option value="other">💨 Other</option>
              </select>
            </div>
            <div>
              <label htmlFor="listing-title" className="block text-sm font-medium mb-2">Title</label>
              <input
                id="listing-title"
                type="text"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                required
                className="input-field"
                minLength={5}
                maxLength={100}
                placeholder="Competitive landscape report"
              />
            </div>
            <div>
              <label htmlFor="listing-description" className="block text-sm font-medium mb-2">Description</label>
              <textarea
                id="listing-description"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                required
                minLength={20}
                maxLength={1000}
                rows={4}
                className="input-field"
                placeholder="Describe the deliverable, expected turnaround, and what the buyer receives."
              />
            </div>
            <div>
              <label htmlFor="listing-price" className="block text-sm font-medium mb-2">Price (USD)</label>
              <input
                id="listing-price"
                type="number"
                step="0.01"
                min={0.01}
                max={1000000000}
                value={form.price_bankr}
                onChange={(e) => setForm({ ...form, price_bankr: e.target.value })}
                required
                className="input-field"
                placeholder="0.01 - 1,000,000,000"
              />
            </div>
            <div className="flex gap-3">
              <button type="submit" className="btn-primary">Create Listing</button>
              <button type="button" onClick={() => setShowCreate(false)} className="btn-secondary">Cancel</button>
            </div>
          </form>
        </div>
      )}

      {listings.length === 0 ? (
        <div className="text-center py-12 text-text-dim">
          <div className="text-5xl mb-3">📋</div>
          <p>You haven&apos;t published a service yet.</p>
          <p className="text-sm mb-5">Start with one specific, repeatable deliverable a buyer can evaluate.</p>
          <button type="button" onClick={() => setShowCreate(true)} className="btn-primary">Publish your first service</button>
        </div>
      ) : (
        <div className="space-y-4">
          {listings.map((listing) => (
            <Link key={listing.id} href={`/registry`}>
              <div className="card flex justify-between items-center hover:shadow-lg hover:shadow-accent/5 transition-shadow">
                <div>
                  <div className="font-semibold mb-1">{listing.title}</div>
                  <div className="text-sm text-text-dim flex gap-3">
                    <span className="capitalize">{listing.category}</span>
                    <span>•</span>
                    <span>{new Date(listing.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono font-bold text-gold"><PriceWithKas bankr={listing.price_bankr} kasClassName="text-xs text-text-dim" /></div>
                  <div className={`text-xs px-2 py-1 rounded-full inline-block ${
                    listing.status === 'active' ? 'bg-green-400/10 text-green-400' :
                    listing.status === 'sold' ? 'bg-gold/10 text-gold' :
                    'bg-red-400/10 text-red-400'
                  }`}>
                    {listing.status === 'active' && !listing.external_payment_ready ? 'payout setup pending' : listing.status}
                  </div>
                </div>
              </div>
            </Link>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 text-xs text-text-dim">
            <span>Showing {listings.length.toLocaleString()} of {total.toLocaleString()} listings</span>
            {listings.length < total && (
              <button type="button" onClick={() => void onLoadMore()} disabled={loadingMore} className="btn-secondary">
                {loadingMore ? 'Loading more…' : 'Load more listings'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
