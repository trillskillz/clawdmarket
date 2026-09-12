'use client';

import { useState } from 'react';

interface DeliveryModalProps {
  isOpen: boolean;
  tradeId: string | null;
  listingTitle?: string;
  onClose: () => void;
  onSubmit: (tradeId: string, summary: string, deliveryUrl?: string) => Promise<void>;
}

export default function DeliveryModal({
  isOpen,
  tradeId,
  listingTitle,
  onClose,
  onSubmit,
}: DeliveryModalProps) {
  const [summary, setSummary] = useState('');
  const [deliveryUrl, setDeliveryUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen || !tradeId) return null;

  const close = () => {
    if (submitting) return;
    setSummary('');
    setDeliveryUrl('');
    setError(null);
    onClose();
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const cleanSummary = summary.trim();
    const cleanUrl = deliveryUrl.trim();

    if (cleanSummary.length < 10) {
      setError('Describe what was delivered in at least 10 characters.');
      return;
    }

    if (cleanUrl) {
      try {
        const url = new URL(cleanUrl);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol');
      } catch {
        setError('The deliverable link must be a valid HTTP or HTTPS URL.');
        return;
      }
    }

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(tradeId, cleanSummary, cleanUrl || undefined);
      setSummary('');
      setDeliveryUrl('');
      onClose();
    } catch (cause: any) {
      setError(cause?.message || 'Delivery could not be submitted.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onMouseDown={close}>
      <section
        className="w-full max-w-xl rounded-2xl border border-border bg-surface p-6 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delivery-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-6 flex items-start justify-between gap-6">
          <div>
            <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-accent">Seller action / delivery</p>
            <h2 id="delivery-modal-title" className="text-xl font-bold">Submit completed work</h2>
            {listingTitle && <p className="mt-1 text-sm text-text-dim">{listingTitle}</p>}
          </div>
          <button type="button" onClick={close} disabled={submitting} className="text-text-dim transition-colors hover:text-text" aria-label="Close delivery dialog">✕</button>
        </div>

        <form onSubmit={submit} className="space-y-5">
          <div>
            <label htmlFor="delivery-summary" className="mb-2 block text-sm font-medium">Delivery summary</label>
            <textarea
              id="delivery-summary"
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              minLength={10}
              maxLength={8000}
              rows={6}
              required
              autoFocus
              className="input-field resize-y"
              placeholder="Explain what was completed, where the result can be found, and anything the buyer should verify."
            />
            <p className="mt-2 text-xs text-text-dim">This becomes the delivery record and starts the buyer review window.</p>
          </div>

          <div>
            <label htmlFor="delivery-url" className="mb-2 block text-sm font-medium">Deliverable link <span className="text-text-dim">(optional)</span></label>
            <input
              id="delivery-url"
              type="url"
              value={deliveryUrl}
              onChange={(event) => setDeliveryUrl(event.target.value)}
              maxLength={2000}
              className="input-field"
              placeholder="https://…"
            />
          </div>

          {error && <p role="alert" className="rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-300">{error}</p>}

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button type="button" onClick={close} disabled={submitting} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={submitting || summary.trim().length < 10} className="btn-primary">
              {submitting ? 'Submitting delivery…' : 'Submit for buyer review'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
