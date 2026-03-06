'use client';

import { useState, useEffect } from 'react';
import { useToast } from '@/components/Toast';
import Image from 'next/image';

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  bio?: string;
  avatar_url?: string;
  avatar_emoji?: string;
}

interface ProfileTabProps {
  user: User | null;
  loading: boolean;
  onRefresh: () => Promise<void>;
  getCsrfToken: () => string;
}

export default function ProfileTab({ user, loading, onRefresh, getCsrfToken }: ProfileTabProps) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    bio: '',
    avatar_url: '',
    avatar_emoji: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user) {
      setForm({
        bio: user.bio || '',
        avatar_url: user.avatar_url || '',
        avatar_emoji: user.avatar_emoji || '',
      });
    }
  }, [user]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/auth/me', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': getCsrfToken(),
        },
        body: JSON.stringify(form),
      });

      if (res.ok) {
        toast('Profile updated successfully!', 'success');
        await onRefresh();
      } else {
        const data = await res.json();
        toast(data.error || 'Failed to update profile', 'error');
      }
    } catch {
      toast('Network error', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="animate-pulse h-64 bg-surface rounded-xl"></div>;
  if (!user) return <div>User not found</div>;

  return (
    <div className="card max-w-2xl animate-fade-in-up">
      <h2 className="text-xl font-bold mb-6">Edit Profile</h2>
      
      <form onSubmit={handleSave} className="space-y-6">
        {/* Avatar Preview */}
        <div className="flex items-center gap-6 mb-6">
          <div className="relative">
            {form.avatar_url ? (
              <Image
                src={form.avatar_url}
                alt="Avatar"
                width={80}
                height={80}
                className="w-20 h-20 rounded-full bg-bg object-cover border-2 border-border"
              />
            ) : form.avatar_emoji ? (
              <div className="w-20 h-20 rounded-full bg-accent/20 flex items-center justify-center text-4xl border-2 border-border">
                {form.avatar_emoji}
              </div>
            ) : (
              <div className="w-20 h-20 rounded-full bg-accent/20 flex items-center justify-center text-2xl text-accent border-2 border-border">
                {user.name[0].toUpperCase()}
              </div>
            )}
          </div>
          <div className="text-sm text-text-dim">
            <p>Your avatar appears on your listings and profile page.</p>
            <p className="text-xs mt-1">Priority: Image URL &gt; Emoji &gt; Initial</p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-2">Avatar Emoji</label>
            <input
              type="text"
              maxLength={4}
              value={form.avatar_emoji}
              onChange={(e) => setForm({ ...form, avatar_emoji: e.target.value })}
              className="input-field text-2xl w-24 text-center"
              placeholder="🤖"
            />
            <p className="text-xs text-text-dim mt-1">Pick a single emoji.</p>
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-2">Avatar Image URL</label>
            <input
              type="url"
              value={form.avatar_url}
              onChange={(e) => setForm({ ...form, avatar_url: e.target.value })}
              className="input-field"
              placeholder="https://..."
            />
            <p className="text-xs text-text-dim mt-1">Direct link to an image (PNG/JPG).</p>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Bio</label>
          <textarea
            value={form.bio}
            onChange={(e) => setForm({ ...form, bio: e.target.value })}
            maxLength={500}
            rows={4}
            className="input-field"
            placeholder="Tell others about your agent services..."
          />
          <p className="text-xs text-text-dim mt-1 text-right">{form.bio.length}/500</p>
        </div>

        <div className="pt-4 border-t border-border flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="btn-primary"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  );
}
