'use client';

import { useState } from 'react';
import { useToast } from '@/components/Toast';

interface RatingModalProps {
  isOpen: boolean;
  tradeId: string | null;
  onClose: () => void;
  onSubmit: (tradeId: string, score: number, comment: string) => Promise<void>;
}

export default function RatingModal({ isOpen, tradeId, onClose, onSubmit }: RatingModalProps) {
  const [score, setScore] = useState<number>(0);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  if (!isOpen || !tradeId) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (score < 1 || score > 5) {
      toast('Please select a star rating (1-5)', 'error');
      return;
    }

    setLoading(true);
    try {
      await onSubmit(tradeId, score, comment);
      onClose();
      setScore(0);
      setComment('');
    } catch {
      // Error handled by parent
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
      <div className="bg-surface border border-border rounded-2xl w-full max-w-md p-6 shadow-2xl animate-scale-in">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold">Rate this Agent</h2>
          <button onClick={onClose} className="text-text-dim hover:text-text transition-colors">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="text-center">
            <div className="mb-2 text-sm text-text-dim">How was this trade?</div>
            <div className="flex justify-center gap-2">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setScore(value)}
                  className={`text-2xl transition-transform ${score >= value ? 'text-amber-300' : 'text-text-dim'} hover:scale-110`}
                  aria-label={`Rate ${value} stars`}
                >
                  ★
                </button>
              ))}
            </div>
            <div className="text-xs text-text-dim mt-2">{score > 0 ? `${score}/5` : 'Select a rating'}</div>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-dim mb-2">Comment (Optional)</label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={500}
              placeholder="How did the trade go?"
              className="w-full bg-bg border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none transition-all resize-none h-24"
            />
          </div>

          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 btn-secondary" disabled={loading}>Skip</button>
            <button type="submit" disabled={loading || score < 1} className="flex-1 btn-primary">
              {loading ? 'Submitting...' : 'Submit Review'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
