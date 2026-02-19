'use client';

import { useState } from 'react';
import { useToast } from '@/components/Toast';
import { SkeletonListItem } from '@/components/Skeleton';

interface ApiKey {
  id: string;
  name: string;
  last_used: string | null;
  created_at: string;
}

interface ApiKeysTabProps {
  apiKeys: ApiKey[];
  loading: boolean;
  onRefresh: () => Promise<void>;
  getCsrfToken: () => string;
}

export default function ApiKeysTab({ apiKeys, loading, onRefresh, getCsrfToken }: ApiKeysTabProps) {
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [newApiKey, setNewApiKey] = useState('');
  const [form, setForm] = useState({ name: '' });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/auth/api-keys', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': getCsrfToken(),
        },
        body: JSON.stringify(form),
      });

      const data = await res.json();

      if (res.ok) {
        setNewApiKey(data.api_key);
        setForm({ name: '' });
        toast('API key generated!', 'success');
        await onRefresh();
      } else {
        toast(data.error || 'Failed to create API key', 'error');
      }
    } catch {
      toast('Network error. Please try again.', 'error');
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        {[...Array(2)].map((_, i) => <SkeletonListItem key={i} />)}
      </div>
    );
  }

  return (
    <div>
      <div className="bg-accent/10 border border-accent/30 rounded-lg p-4 mb-6">
        <p className="text-sm">
          🔑 API keys allow agents to authenticate and trade programmatically.
          Keep your keys secure and never share them publicly.
        </p>
      </div>

      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-semibold">Your API Keys</h2>
        <button onClick={() => setShowCreate(!showCreate)} className="btn-primary">
          + Generate API Key
        </button>
      </div>

      {showCreate && (
        <div className="card mb-6 animate-fade-in-up">
          <h3 className="text-lg font-semibold mb-4">Generate New API Key</h3>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Key Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ name: e.target.value })}
                required
                className="input-field"
                placeholder="My Agent Production Key"
              />
            </div>
            <div className="flex gap-3">
              <button type="submit" className="btn-primary">Generate Key</button>
              <button type="button" onClick={() => setShowCreate(false)} className="btn-secondary">Cancel</button>
            </div>
          </form>
        </div>
      )}

      {newApiKey && (
        <div className="bg-gold/10 border border-gold/30 rounded-lg p-6 mb-6 animate-fade-in-up">
          <h3 className="font-semibold mb-2 text-gold">⚠️ Save Your API Key</h3>
          <p className="text-sm text-text-dim mb-4">
            This is the only time you&apos;ll see this key. Copy it now and store it securely.
          </p>
          <div className="bg-bg border border-border rounded p-3 font-mono text-sm break-all mb-4">
            {newApiKey}
          </div>
          <button
            onClick={() => {
              navigator.clipboard.writeText(newApiKey);
              toast('Copied to clipboard!', 'success');
            }}
            className="btn-secondary text-sm"
          >
            Copy to Clipboard
          </button>
        </div>
      )}

      {apiKeys.length === 0 ? (
        <div className="text-center py-12 text-text-dim">
          <div className="text-5xl mb-3">🔑</div>
          <p>No API keys yet.</p>
          <p className="text-sm">Generate your first API key to start trading programmatically.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {apiKeys.map((key) => (
            <div key={key.id} className="card flex justify-between items-center">
              <div>
                <div className="font-semibold mb-1">{key.name}</div>
                <div className="text-sm text-text-dim">
                  Created {new Date(key.created_at).toLocaleDateString()}
                </div>
              </div>
              <div className="text-right text-sm text-text-dim">
                {key.last_used
                  ? `Last used ${new Date(key.last_used).toLocaleDateString()}`
                  : 'Never used'}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
