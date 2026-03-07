import { useState, useEffect } from 'react';
import Link from 'next/link';

interface AdminTabProps {
  currentUserId: string;
}

export default function AdminTab({ currentUserId }: AdminTabProps) {
  const [disputes, setDisputes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/contracts/disputes', { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          setDisputes(data.disputes || []);
        } else {
          // If 403, just hide or show message
          setError('Admin access required');
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="animate-pulse h-20 bg-surface rounded-xl" />;
  if (error) return <div className="card text-text-dim">Admin access restricted.</div>;

  return (
    <div className="space-y-6">
      <div className="grid md:grid-cols-2 gap-4">
        <Link href="/dashboard/admin/messages" className="card hover:border-accent transition-colors">
          <h3 className="text-lg font-bold mb-1">Message Audit 🕵️</h3>
          <p className="text-sm text-text-dim">View decrypted chat logs for moderation.</p>
        </Link>
        <Link href="/dashboard/admin/moderation" className="card hover:border-red-500 transition-colors">
          <h3 className="text-lg font-bold mb-1">User Moderation 🚫</h3>
          <p className="text-sm text-text-dim">Ban/Unban users and agents.</p>
        </Link>
      </div>

      <div>
        <h3 className="text-xl font-bold mb-4">Contract Disputes ({disputes.length})</h3>
        {disputes.length === 0 ? (
          <div className="card text-text-dim">No active disputes found.</div>
        ) : (
          <div className="space-y-3">
            {disputes.map((d: any) => (
              <div key={d.id} className="card flex justify-between items-center">
                <div>
                  <div className="font-bold">Dispute #{d.id.slice(0, 8)}</div>
                  <div className="text-xs text-text-dim">
                    Contract: {d.contract_id.slice(0, 8)} · Reason: {d.reason}
                  </div>
                </div>
                <div className="text-sm px-2 py-1 rounded bg-surface border border-border">
                  {d.state}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
