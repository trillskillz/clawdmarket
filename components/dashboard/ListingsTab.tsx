'use client';

import { useState } from 'react';
import { useToast } from '@/components/Toast';
import { SkeletonListItem } from '@/components/Skeleton';
import Link from 'next/link';

interface Listing {
  id: string;
  title: string;
  category: string;
  price_bankr: number;
  status: string;
  created_at: string;
}

interface ListingsTabProps {
  listings: Listing[];
  loading: boolean;
  onRefresh: () => Promise<void>;
  getCsrfToken: () => string;
}

export default function ListingsTab({ listings, loading, onRefresh, getCsrfToken }: ListingsTabProps) {
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    category: 'compute' as 'compute' | 'skills' | 'data' | 'bounties' | 'other',
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
          ...form,
          price_bankr: parseFloat(form.price_bankr),
        }),
      });

      if (res.ok) {
        setShowCreate(false);
        setForm({ category: 'compute', title: '', description: '', price_bankr: '' });
        toast('Listing created successfully!', 'success');
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

      {showCreate && (
        <div className="card mb-6 animate-fade-in-up">
          <h3 className="text-lg font-semibold mb-4">Create New Listing</h3>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Category</label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value as any })}
                className="input-field"
              >
                <option value="compute">⚡ Compute</option>
                <option value="skills">🧩 Skills</option>
                <option value="data">📊 Data</option>
                <option value="bounties">🎯 Bounties</option>
                <option value="other">💨 Other</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Title</label>
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                required
                className="input-field"
                placeholder="500 GPT-4 API calls"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Description</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                required
                rows={4}
                className="input-field"
                placeholder="Describe what you're offering..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Price (BANKR)</label>
              <input
                type="number"
                step="1"
                min={1}
                max={1000000000}
                value={form.price_bankr}
                onChange={(e) => setForm({ ...form, price_bankr: e.target.value })}
                required
                className="input-field"
                placeholder="1 - 1,000,000,000"
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
          <p>You haven&apos;t created any listings yet.</p>
          <p className="text-sm">Create your first listing to start trading!</p>
        </div>
      ) : (
        <div className="space-y-4">
          {listings.map((listing) => (
            <Link key={listing.id} href={`/marketplace/${listing.id}`}>
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
                  <div className="font-mono font-bold text-gold">{listing.price_bankr} BANKR</div>
                  <div className={`text-xs px-2 py-1 rounded-full inline-block ${
                    listing.status === 'active' ? 'bg-green-400/10 text-green-400' :
                    listing.status === 'sold' ? 'bg-gold/10 text-gold' :
                    'bg-red-400/10 text-red-400'
                  }`}>
                    {listing.status}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
