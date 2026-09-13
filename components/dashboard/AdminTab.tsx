import { useState, useEffect } from 'react';

interface AdminTabProps {
  getCsrfToken: () => string;
}

export default function AdminTab({ getCsrfToken }: AdminTabProps) {
  const [disputes, setDisputes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const loadDisputes = async () => {
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
  };

  useEffect(() => {
    loadDisputes();
  }, []);

  const resolveDispute = async (id: string, ruling: 'buyer_win' | 'seller_win' | 'redo' | 'split') => {
    const splitPercent = ruling === 'split' ? Number(window.prompt('Percent of milestone paid to seller (0–100):', '50')) : undefined;
    if (ruling === 'split' && (!Number.isFinite(splitPercent) || splitPercent! < 0 || splitPercent! > 100)) return;
    setBusy(id);
    setError('');
    try {
      const res = await fetch(`/api/admin/contracts/disputes/${id}/resolve`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
        body: JSON.stringify({ ruling, ...(ruling === 'split' ? { split_percent_to_seller: splitPercent } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Resolution failed');
      await loadDisputes();
    } catch (err: any) {
      setError(err?.message || 'Resolution failed');
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <div className="animate-pulse h-20 bg-surface rounded-xl" />;
  if (error) return <div className="card text-text-dim">Admin access restricted.</div>;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-xl font-bold mb-4">Contract Disputes ({disputes.length})</h3>
        {disputes.length === 0 ? (
          <div className="card text-text-dim">No active disputes found.</div>
        ) : (
          <div className="space-y-3">
            {disputes.map((d: any) => (
              <div key={d.id} className="card flex flex-col md:flex-row justify-between md:items-center gap-3">
                <div>
                  <div className="font-bold">Dispute #{d.id.slice(0, 8)}</div>
                  <div className="text-xs text-text-dim">
                    Contract: {d.contract_id.slice(0, 8)} · Reason: {d.reason_code}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className="btn-secondary text-xs py-1.5" disabled={busy === d.id} onClick={() => resolveDispute(d.id, 'buyer_win')}>Refund buyer</button>
                  <button className="btn-secondary text-xs py-1.5" disabled={busy === d.id} onClick={() => resolveDispute(d.id, 'seller_win')}>Pay seller</button>
                  <button className="btn-secondary text-xs py-1.5" disabled={busy === d.id} onClick={() => resolveDispute(d.id, 'split')}>Split</button>
                  <button className="btn-secondary text-xs py-1.5" disabled={busy === d.id} onClick={() => resolveDispute(d.id, 'redo')}>Request redo</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
