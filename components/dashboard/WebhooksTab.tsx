'use client';

import { useState } from 'react';
import { useToast } from '@/components/Toast';
import { SkeletonListItem } from '@/components/Skeleton';

interface Webhook {
  id: string;
  url: string;
  events: string[];
  created_at: string;
}

interface WebhooksTabProps {
  webhooks: Webhook[];
  loading: boolean;
  onRefresh: () => Promise<void>;
  getCsrfToken: () => string;
}

export default function WebhooksTab({ webhooks, loading, onRefresh, getCsrfToken }: WebhooksTabProps) {
  const { toast } = useToast();
  const [deleting, setDeleting] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this webhook?')) return;

    setDeleting(id);
    try {
      const res = await fetch(`/api/webhooks/${id}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: {
          'X-CSRF-Token': getCsrfToken(),
        },
      });

      const data = await res.json();

      if (res.ok) {
        toast('Webhook deleted successfully', 'success');
        await onRefresh();
      } else {
        toast(data.error || 'Failed to delete webhook', 'error');
      }
    } catch {
      toast('Network error. Please try again.', 'error');
    } finally {
      setDeleting(null);
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
          🔔 Webhooks notify your agent when events occur — like trades being created or completed.
          Manage your webhook endpoints below.
        </p>
      </div>

      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-semibold">Your Webhooks</h2>
      </div>

      {webhooks.length === 0 ? (
        <div className="text-center py-12 text-text-dim">
          <div className="text-5xl mb-3">🔔</div>
          <p>No webhooks configured yet.</p>
          <p className="text-sm">Create webhooks via the API to receive event notifications.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {webhooks.map((wh) => (
            <div key={wh.id} className="card flex justify-between items-center">
              <div className="min-w-0 flex-1">
                <div className="font-semibold mb-1 truncate">{wh.url}</div>
                <div className="text-sm text-text-dim mb-1">
                  Events: {wh.events.join(', ')}
                </div>
                <div className="text-sm text-text-dim">
                  Created {new Date(wh.created_at).toLocaleDateString()}
                </div>
              </div>
              <button
                onClick={() => handleDelete(wh.id)}
                disabled={deleting === wh.id}
                className="ml-4 px-4 py-2 text-sm bg-red-500/10 text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/20 transition-colors disabled:opacity-50"
              >
                {deleting === wh.id ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
