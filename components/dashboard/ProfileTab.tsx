'use client';

import { useState, useEffect } from 'react';
import { useToast } from '@/components/Toast';
import Image from 'next/image';

const AVATAR_PRESETS = [
  'https://api.dicebear.com/8.x/bottts/svg?seed=AtlasRelay',
  'https://api.dicebear.com/8.x/bottts/svg?seed=MiraLedger',
  'https://api.dicebear.com/8.x/bottts/svg?seed=KestrelSigma',
  'https://api.dicebear.com/8.x/bottts/svg?seed=NovaPatch',
  'https://api.dicebear.com/8.x/bottts/svg?seed=EchoPrism',
  'https://api.dicebear.com/8.x/bottts/svg?seed=RuneFlux',
  'https://api.dicebear.com/8.x/bottts/svg?seed=VantaScout',
  'https://api.dicebear.com/8.x/bottts/svg?seed=OrionQuill',
  'https://api.dicebear.com/8.x/bottts/svg?seed=DeltaForge',
  'https://api.dicebear.com/8.x/bottts/svg?seed=SableVector',
  'https://api.dicebear.com/8.x/bottts/svg?seed=IrisBeacon',
  'https://api.dicebear.com/8.x/bottts/svg?seed=ZenoHarbor',
];

const EMOJI_PRESETS = ['🤖', '🧠', '🛰️', '⚡', '🛡️', '📊', '🧩', '🧪', '🦾', '🕸️', '🪐', '🔥'];

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
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);

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
                unoptimized
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
            <button
              type="button"
              onClick={() => setShowAvatarPicker(true)}
              className="btn-secondary mt-3 text-xs py-1.5 px-3"
            >
              Open Avatar Picker
            </button>
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

      {showAvatarPicker && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShowAvatarPicker(false)}>
          <div className="bg-bg border border-border rounded-xl w-full max-w-2xl p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Choose an Avatar</h3>
              <button type="button" onClick={() => setShowAvatarPicker(false)} className="text-text-dim hover:text-text">✕</button>
            </div>

            <p className="text-sm text-text-dim mb-3">Click an image or emoji to apply instantly.</p>

            <div className="mb-4">
              <div className="text-xs text-text-dim mb-2">Avatar Images</div>
              <div className="grid grid-cols-6 gap-2">
                {AVATAR_PRESETS.map((url) => (
                  <button
                    key={url}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, avatar_url: url, avatar_emoji: '' }))}
                    className={`rounded-full border p-0.5 ${form.avatar_url === url ? 'border-accent' : 'border-border'}`}
                  >
                    <Image src={url} alt="avatar preset" width={48} height={48} unoptimized className="w-12 h-12 rounded-full object-cover" />
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="text-xs text-text-dim mb-2">Emoji Avatars</div>
              <div className="grid grid-cols-6 gap-2">
                {EMOJI_PRESETS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, avatar_emoji: emoji, avatar_url: '' }))}
                    className={`h-12 rounded-lg border text-2xl ${form.avatar_emoji === emoji ? 'border-accent bg-accent/10' : 'border-border bg-bg2'}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
