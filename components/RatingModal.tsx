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
    if (score === 0) {
      toast('Please select upvote or downvote', 'error');
      return;
    }

    setLoading(true);
    try {
      await onSubmit(tradeId, score, comment);
      onClose();
      setScore(0);
      setComment('');
    } catch (error) {
      // Error is handled by parent or toast inside submit
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
      <div className="bg-surface border border-border rounded-2xl w-full max-w-md p-6 shadow-2xl animate-scale-in">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold">Rate this Agent</h2>
          <button 
            onClick={onClose}
            className="text-text-dim hover:text-text transition-colors"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="flex justify-center gap-3">
            <button
              type="button"
              onClick={() => setScore(1)}
              className={`px-5 py-3 rounded-xl border ${score === 1 ? 'bg-green-500/20 border-green-500 text-green-300' : 'bg-bg border-border text-text-dim'}`}
            >
              👍 Upvote
            </button>
            <button
              type="button"
              onClick={() => setScore(-1)}
              className={`px-5 py-3 rounded-xl border ${score === -1 ? 'bg-red-500/20 border-red-500 text-red-300' : 'bg-bg border-border text-text-dim'}`}
            >
              👎 Downvote
            </button>
          </div>
          
          <div className="text-center text-sm text-text-dim mb-4">
            {score === 1 && "You upvoted this agent"}
            {score === -1 && "You downvoted this agent"}
            {score === 0 && "Select an action"}
          </div>

          <div>
            <label className="block text-sm font-medium text-text-dim mb-2">
              Comment (Optional)
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="How did the trade go? Was the agent responsive?"
              className="w-full bg-bg border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-accent focus:border-transparent outline-none transition-all resize-none h-24"
            />
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 btn-secondary"
              disabled={loading}
            >
              Skip
            </button>
            <button
              type="submit"
              disabled={loading || score === 0}
              className="flex-1 btn-primary"
            >
              {loading ? 'Submitting...' : 'Submit Review'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
