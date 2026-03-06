'use client';

import { useState } from 'react';
import { SkeletonListItem } from '@/components/Skeleton';
import { useToast } from '@/components/Toast';
import RatingModal from '@/components/RatingModal';
import PriceWithKas from '@/components/PriceWithKas';

interface Trade {
  id: string;
  listing_title: string;
  buyer_id: string;
  seller_id: string;
  buyer_name: string;
  amount: number;
  fee: number;
  status: string;
  created_at: string;
}

interface TradesTabProps {
  trades: Trade[];
  loading: boolean;
  currentUserId?: string;
  onRefresh?: () => void;
  getCsrfToken?: () => string;
}

export default function TradesTab({ trades, loading, currentUserId, onRefresh, getCsrfToken }: TradesTabProps) {
  const { toast } = useToast();
  const [actionId, setActionId] = useState<string | null>(null);
  const [filterRole, setFilterRole] = useState<'all' | 'bought' | 'sold'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'completed' | 'complete' | 'disputed'>('all');
  
  // Rating Modal state
  const [ratingTradeId, setRatingTradeId] = useState<string | null>(null);

  const handleUpdateStatus = async (tradeId: string, status: 'completed' | 'disputed') => {
    const isDispute = status === 'disputed';
    const msg = isDispute 
      ? 'Are you sure you want to dispute this trade? Funds will remain locked.'
      : 'Are you sure you want to release funds to the seller? This cannot be undone.';
      
    if (!confirm(msg)) return;
    
    setActionId(tradeId);
    try {
      const res = await fetch(`/api/trades/${tradeId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': getCsrfToken ? getCsrfToken() : '',
        },
        body: JSON.stringify({ status }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to update trade');
      }

      toast(isDispute ? 'Trade disputed.' : 'Trade completed! Funds released.', 'success');
      
      // If completed successfully, open rating modal
      if (status === 'completed') {
        setRatingTradeId(tradeId);
      }
      
      if (onRefresh) onRefresh();
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setActionId(null);
    }
  };
  
  const handleSubmitRating = async (tradeId: string, score: number, comment: string) => {
    try {
      const res = await fetch('/api/ratings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': getCsrfToken ? getCsrfToken() : '',
        },
        body: JSON.stringify({ trade_id: tradeId, score, comment }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to submit rating');
      }

      toast('Rating submitted!', 'success');
      // Optional: Refresh data to disable rate button if we add one later
    } catch (err: any) {
      toast(err.message, 'error');
      throw err; // Re-throw to keep modal open if needed, or handle here
    }
  };

  const filteredTrades = trades.filter((t) => {
    if (filterRole === 'bought' && t.buyer_id !== currentUserId) return false;
    if (filterRole === 'sold' && t.seller_id !== currentUserId) return false;
    if (filterStatus !== 'all' && t.status !== filterStatus) return false;
    return true;
  });

  if (loading) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => <SkeletonListItem key={i} />)}
      </div>
    );
  }

  return (
    <div>
      <RatingModal 
        isOpen={!!ratingTradeId} 
        tradeId={ratingTradeId} 
        onClose={() => setRatingTradeId(null)}
        onSubmit={handleSubmitRating}
      />
      
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <h2 className="text-xl font-semibold">Trade History</h2>
        
        <div className="flex gap-2 text-sm overflow-x-auto pb-2 md:pb-0">
          <select 
            value={filterRole}
            onChange={(e) => setFilterRole(e.target.value as any)}
            className="bg-bg border border-border rounded-lg px-3 py-1.5 focus:border-accent outline-none"
          >
            <option value="all">All Roles</option>
            <option value="bought">Bought</option>
            <option value="sold">Sold</option>
          </select>
          <select 
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as any)}
            className="bg-bg border border-border rounded-lg px-3 py-1.5 focus:border-accent outline-none"
          >
            <option value="all">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="completed">Completed</option>
            <option value="disputed">Disputed</option>
          </select>
        </div>
      </div>

      {filteredTrades.length === 0 ? (
        <div className="text-center py-12 text-text-dim">
          <div className="text-5xl mb-3">🤝</div>
          <p>No trades found.</p>
          <p className="text-sm">Try adjusting your filters.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredTrades.map((trade) => {
            const isBuyer = trade.buyer_id === currentUserId;
            const isSeller = trade.seller_id === currentUserId;
            
            return (
              <div key={trade.id} className="card flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div className="flex-1">
                  <div className="font-semibold mb-1 flex items-center gap-2">
                    {trade.listing_title}
                    {isBuyer && <span className="text-[10px] px-1.5 py-0.5 rounded border border-accent text-accent">YOU BOUGHT</span>}
                    {isSeller && <span className="text-[10px] px-1.5 py-0.5 rounded border border-green-400 text-green-400">YOU SOLD</span>}
                  </div>
                  <div className="text-sm text-text-dim">
                    {new Date(trade.created_at).toLocaleDateString()}
                    {' • '}
                    {isBuyer ? `Seller: ${trade.seller_id.slice(0, 8)}...` : `Buyer: ${trade.buyer_name || 'Unknown'}`}
                  </div>
                </div>

                <div className="flex flex-col md:items-end gap-2 w-full md:w-auto">
                  <div className="flex items-center gap-3 justify-between md:justify-end w-full">
                    <div className="font-mono font-bold text-gold"><PriceWithKas bankr={trade.amount} kasClassName="text-xs text-text-dim" /></div>
                    <div className={`text-xs px-2 py-1 rounded-full inline-block text-center min-w-[80px] ${
                      (trade.status === 'completed' || trade.status === 'complete') ? 'bg-green-400/10 text-green-400' :
                      trade.status === 'pending' ? 'bg-gold/10 text-gold' :
                      'bg-red-400/10 text-red-400'
                    }`}>
                      {trade.status}
                    </div>
                  </div>

                  {/* Actions Row */}
                  <div className="flex items-center gap-2 justify-end w-full">
                    {trade.status === 'pending' && isBuyer && (
                      <>
                        <button 
                          onClick={() => handleUpdateStatus(trade.id, 'disputed')}
                          disabled={actionId === trade.id}
                          className="text-xs text-text-dim hover:text-red-400 px-2 py-1 transition-colors"
                        >
                          Report Issue
                        </button>
                        <button 
                          onClick={() => handleUpdateStatus(trade.id, 'completed')}
                          disabled={actionId === trade.id}
                          className="btn-primary py-1.5 px-3 text-xs whitespace-nowrap bg-green-600 hover:bg-green-500 disabled:opacity-50"
                        >
                          {actionId === trade.id ? '...' : 'Mark Completed'}
                        </button>
                      </>
                    )}
                    
                    {trade.status === 'pending' && isSeller && (
                      <div className="flex items-center gap-2">
                         <button 
                          onClick={() => handleUpdateStatus(trade.id, 'disputed')}
                          disabled={actionId === trade.id}
                          className="text-xs text-text-dim hover:text-red-400 px-2 py-1 transition-colors"
                        >
                          Report Issue
                        </button>
                        <div className="text-xs text-text-dim italic px-2">
                          Waiting for buyer...
                        </div>
                      </div>
                    )}

                    {(trade.status === 'completed' || trade.status === 'complete') && (isBuyer || isSeller) && (
                      <button
                        onClick={() => setRatingTradeId(trade.id)}
                        className="btn-secondary py-1.5 px-3 text-xs whitespace-nowrap"
                      >
                        Upvote / Downvote
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
