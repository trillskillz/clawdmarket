import { useState, useEffect } from 'react';

interface AdminTabProps {
  getCsrfToken: () => string;
}

type PaymentControl = { paused: boolean; reason: string | null; source: 'database' | 'environment' };
type PaymentControlEvent = { id: string; paused: number; reason: string; actor_user_id: string; created_at: number };

export default function AdminTab({ getCsrfToken }: AdminTabProps) {
  const [disputes, setDisputes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [paymentControl, setPaymentControl] = useState<PaymentControl | null>(null);
  const [paymentEvents, setPaymentEvents] = useState<PaymentControlEvent[]>([]);
  const [pauseReason, setPauseReason] = useState('');
  const [pauseBusy, setPauseBusy] = useState(false);
  const [pauseError, setPauseError] = useState('');

  const loadPaymentControl = async () => {
    const response = await fetch('/api/admin/payments/pause', { credentials: 'include', cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Could not load payment control');
    setPaymentControl(data.control);
    setPaymentEvents(data.events || []);
  };

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
    void loadPaymentControl().catch((cause) => setPauseError(cause instanceof Error ? cause.message : 'Could not load payment control'));
  }, []);

  const changePaymentPause = async () => {
    if (!paymentControl || pauseReason.trim().length < 8 || pauseBusy) return;
    const nextPaused = !paymentControl.paused;
    if (!window.confirm(`${nextPaused ? 'Pause' : 'Resume'} new marketplace payments? Existing payment recovery, refunds, and payouts will remain available.`)) return;
    setPauseBusy(true);
    setPauseError('');
    try {
      const response = await fetch('/api/admin/payments/pause', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
        body: JSON.stringify({ paused: nextPaused, reason: pauseReason.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not update payment control');
      setPauseReason('');
      await loadPaymentControl();
    } catch (cause) {
      setPauseError(cause instanceof Error ? cause.message : 'Could not update payment control');
    } finally { setPauseBusy(false); }
  };

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
      <section className="card space-y-3" aria-labelledby="payment-control-title">
        <h3 id="payment-control-title" className="text-xl font-bold">Marketplace payment control</h3>
        <p className="text-sm text-text-dim">Stops new trade reservations and MPP challenges. Existing transaction verification, refunds, disputes, and seller payouts continue.</p>
        <p role="status" className="text-sm">New payments: <strong>{paymentControl ? paymentControl.paused ? 'PAUSED' : 'OPEN' : 'Loading…'}</strong>{paymentControl?.reason ? ` · ${paymentControl.reason}` : ''}</p>
        {paymentControl?.source === 'environment' && <p className="text-sm text-text-dim">Environment override is active; change CLAWDMARKET_NEW_PAYMENTS_PAUSED to resume.</p>}
        <label className="block text-sm" htmlFor="payment-pause-reason">Reason for the audit log</label>
        <input id="payment-pause-reason" className="w-full min-h-11 border border-border bg-bg px-3" value={pauseReason} maxLength={500} onChange={(event) => setPauseReason(event.target.value)} placeholder="Incident, maintenance, or completed safety review" />
        <button type="button" className="btn-secondary min-h-11 px-4" disabled={!paymentControl || paymentControl.source === 'environment' || pauseReason.trim().length < 8 || pauseBusy} onClick={() => void changePaymentPause()}>{pauseBusy ? 'Updating…' : paymentControl?.paused ? 'Resume new payments' : 'Pause new payments'}</button>
        {pauseError && <p role="alert" className="text-sm text-red-300">{pauseError}</p>}
        {paymentEvents.length > 0 && <details className="text-sm"><summary className="cursor-pointer">Recent payment-control changes</summary><ul className="mt-2 space-y-2">{paymentEvents.slice(0, 10).map((event) => <li key={event.id}>{event.paused ? 'Paused' : 'Resumed'} by {event.actor_user_id} · {event.reason} · {new Date(Number(event.created_at) * 1000).toLocaleString()}</li>)}</ul></details>}
      </section>
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
