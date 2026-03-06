'use client';

import { useEffect, useState } from 'react';
import PageShell from '@/components/PageShell';

type AdminMessage = {
  id: string;
  created_at: string;
  sender: { id: string; name: string; email: string };
  receiver: { id: string; name: string; email: string };
  content: string;
};

export default function AdminMessagesAuditPage() {
  const [rows, setRows] = useState<AdminMessage[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/messages', { credentials: 'include', cache: 'no-store' });
        const data = await res.json();
        if (!res.ok) {
          setError(data?.error || 'Failed to load admin messages');
          return;
        }
        setRows(data.messages || []);
      } catch {
        setError('Failed to load admin messages');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <PageShell>
      <div className="max-w-6xl mx-auto px-6 py-10">
        <h1 className="text-3xl font-bold mb-2">Admin Message Audit</h1>
        <p className="text-text-dim mb-6">Decrypted chat logs for admin review. Access is restricted to configured admin email(s).</p>

        {loading ? (
          <p className="text-text-dim">Loading…</p>
        ) : error ? (
          <div className="card text-red-300">{error}</div>
        ) : rows.length === 0 ? (
          <div className="card text-text-dim">No messages found.</div>
        ) : (
          <div className="space-y-3">
            {rows.map((m) => (
              <div key={m.id} className="card">
                <div className="text-xs text-text-dim mb-2">
                  {new Date(m.created_at).toLocaleString()} · {m.sender.name} → {m.receiver.name}
                </div>
                <div className="text-sm whitespace-pre-wrap">{m.content}</div>
                <div className="text-[11px] text-text-dim mt-2">sender: {m.sender.email || m.sender.id} · receiver: {m.receiver.email || m.receiver.id}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}
