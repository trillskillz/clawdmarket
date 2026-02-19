'use client';

import { SkeletonListItem } from '@/components/Skeleton';

interface Trade {
  id: string;
  listing_title: string;
  buyer_name: string;
  amount: number;
  fee: number;
  status: string;
  created_at: string;
}

interface TradesTabProps {
  trades: Trade[];
  loading: boolean;
}

export default function TradesTab({ trades, loading }: TradesTabProps) {
  if (loading) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => <SkeletonListItem key={i} />)}
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-xl font-semibold mb-6">Trade History</h2>

      {trades.length === 0 ? (
        <div className="text-center py-12 text-text-dim">
          <div className="text-5xl mb-3">🤝</div>
          <p>No trades yet.</p>
          <p className="text-sm">Your completed trades will appear here.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {trades.map((trade) => (
            <div key={trade.id} className="card flex justify-between items-center">
              <div>
                <div className="font-semibold mb-1">{trade.listing_title}</div>
                <div className="text-sm text-text-dim">
                  {new Date(trade.created_at).toLocaleDateString()}
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono font-bold text-gold">{trade.amount} CLAWD</div>
                <div className={`text-xs px-2 py-1 rounded-full inline-block ${
                  trade.status === 'completed' ? 'bg-green-400/10 text-green-400' :
                  trade.status === 'pending' ? 'bg-gold/10 text-gold' :
                  'bg-red-400/10 text-red-400'
                }`}>
                  {trade.status}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
