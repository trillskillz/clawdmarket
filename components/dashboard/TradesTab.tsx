'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { SkeletonListItem } from '@/components/Skeleton';
import { useToast } from '@/components/Toast';
import RatingModal from '@/components/RatingModal';
import DeliveryModal from '@/components/DeliveryModal';
import PriceWithKas from '@/components/PriceWithKas';
import { trackClientEvent } from '@/lib/client-analytics';
import ExternalTradeCheckout, { type ExternalCheckout } from '@/components/ExternalTradeCheckout';

interface Trade {
  id: string;
  listing_title: string;
  buyer_id: string;
  seller_id: string;
  buyer_name: string;
  amount: number;
  fee: number;
  total_cost?: number;
  seller_amount?: number;
  status: string;
  created_at: string;
  auto_confirm_at?: string | null;
  payment_rail?: 'ledger' | 'mpp' | 'evm';
  payout_status?: string;
  checkout?: ExternalCheckout | null;
  rated_by_caller?: boolean | number;
}

interface TradesTabProps {
  trades: Trade[];
  loading: boolean;
  currentUserId?: string;
  focusedTradeId?: string;
  onRefresh?: () => void;
  getCsrfToken?: () => string;
}

const COMPLETE_STATUSES = new Set(['completed', 'complete', 'resolved']);

function TradeProgress({ status }: { status: string }) {
  const currentStep = COMPLETE_STATUSES.has(status) ? 3 : status === 'pending_release' ? 2 : status === 'pending' ? 0 : 1;
  const interrupted = ['disputed', 'cancelled'].includes(status);
  const steps = ['Funded', 'Delivered', 'Released'];

  return (
    <div className="mt-5 grid grid-cols-3 border border-border" aria-label={`Trade progress: ${status}`}>
      {steps.map((label, index) => {
        const step = index + 1;
        const reached = !interrupted && currentStep >= step;
        const active = !interrupted && currentStep === step && !COMPLETE_STATUSES.has(status);
        return (
          <div key={label} className={`border-r border-border px-3 py-2 last:border-r-0 ${reached ? 'bg-green-400/5' : ''}`}>
            <span className={`mr-2 font-mono text-[10px] ${reached ? 'text-green-400' : 'text-text-dim'}`}>{reached ? '✓' : `0${step}`}</span>
            <span className={`text-xs ${active ? 'font-semibold text-text' : reached ? 'text-green-300' : 'text-text-dim'}`}>{label}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function TradesTab({ trades, loading, currentUserId, focusedTradeId, onRefresh, getCsrfToken }: TradesTabProps) {
  const { toast } = useToast();
  const [actionId, setActionId] = useState<string | null>(null);
  const [filterRole, setFilterRole] = useState<'all' | 'bought' | 'sold'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'escrow_held' | 'pending_release' | 'completed' | 'complete' | 'disputed' | 'resolved' | 'cancelled'>('all');
  const [ratingTradeId, setRatingTradeId] = useState<string | null>(null);
  const [deliveryTrade, setDeliveryTrade] = useState<Trade | null>(null);

  useEffect(() => {
    if (!focusedTradeId || loading) return;
    document.getElementById(`trade-${focusedTradeId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focusedTradeId, loading, trades]);

  const handleUpdateStatus = async (tradeId: string, status: 'completed' | 'disputed') => {
    const isDispute = status === 'disputed';
    const msg = isDispute 
      ? 'Are you sure you want to dispute this trade? Funds will remain locked.'
      : 'Are you sure you want to release funds to the seller? This cannot be undone.';
      
    if (!confirm(msg)) return;
    
    setActionId(tradeId);
    try {
      const modernEndpoint = status === 'completed' ? 'confirm' : 'dispute';
      const reason = status === 'disputed' ? window.prompt('Briefly describe the issue:')?.trim() : '';
      if (status === 'disputed' && !reason) return;
      const res = await fetch(`/api/trades/${tradeId}/${modernEndpoint}`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': getCsrfToken ? getCsrfToken() : '',
        },
        body: JSON.stringify(status === 'disputed' ? { reason } : {}),
      });

      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result.error || 'Failed to update trade');

      if (status === 'completed' && result.status === 'settlement_processing') {
        toast('Delivery accepted. The blockchain payout is submitted and will finalize after confirmation.', 'success');
        if (onRefresh) onRefresh();
        return;
      }

      toast(isDispute ? 'Trade disputed.' : 'Trade completed! Funds released.', 'success');
      
      // If completed successfully, open rating modal
      if (status === 'completed') {
        trackClientEvent('trade_completed', { trade_id: tradeId });
        setRatingTradeId(tradeId);
      }
      
      if (onRefresh) onRefresh();
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setActionId(null);
    }
  };

  const handleSubmitDelivery = async (tradeId: string, summary: string, deliveryUrl?: string) => {
    const trade = trades.find((item) => item.id === tradeId);
    if (!trade || trade.seller_id !== currentUserId) {
      throw new Error('Only the seller can submit delivery for this trade.');
    }

    const res = await fetch('/api/messages', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': getCsrfToken ? getCsrfToken() : '',
      },
      body: JSON.stringify({
        receiverId: trade.buyer_id,
        content: JSON.stringify({
          type: 'task_complete',
          trade_id: trade.id,
          summary,
          ...(deliveryUrl ? { delivery_url: deliveryUrl } : {}),
        }),
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || 'Delivery could not be submitted.');

    toast('Delivery submitted. The buyer review window is now open.', 'success');
    trackClientEvent('delivery_submitted', { trade_id: trade.id });
    if (onRefresh) await onRefresh();
  };
  
  const handleSubmitRating = async (tradeId: string, score: number, comment: string) => {
    try {
      const res = await fetch('/api/ratings', {
        method: 'POST',
        credentials: 'include',
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
      trackClientEvent('rating_submitted', { trade_id: tradeId, score });
      if (onRefresh) await onRefresh();
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
      <DeliveryModal
        isOpen={Boolean(deliveryTrade)}
        tradeId={deliveryTrade?.id || null}
        listingTitle={deliveryTrade?.listing_title}
        onClose={() => setDeliveryTrade(null)}
        onSubmit={handleSubmitDelivery}
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
            <option value="pending">Awaiting payment</option>
            <option value="escrow_held">Awaiting delivery</option>
            <option value="pending_release">Awaiting release</option>
            <option value="completed">Completed</option>
            <option value="disputed">Disputed</option>
            <option value="resolved">Resolved</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      {filteredTrades.length === 0 ? (
        <div className="text-center py-12 text-text-dim">
          <div className="text-5xl mb-3">🤝</div>
          <p>{trades.length === 0 ? 'No trades yet.' : 'No trades match these filters.'}</p>
          <p className="text-sm mb-5">{trades.length === 0 ? 'Hire a live service to start your first transaction.' : 'Try adjusting your role or status filters.'}</p>
          {trades.length === 0 && <Link href="/marketplace" className="btn-primary">Browse live services</Link>}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredTrades.map((trade) => {
            const isBuyer = trade.buyer_id === currentUserId;
            const isSeller = trade.seller_id === currentUserId;
            const partnerId = isBuyer ? trade.seller_id : trade.buyer_id;
            const isFocused = trade.id === focusedTradeId;
            const displayAmount = isBuyer ? (trade.total_cost ?? trade.amount + trade.fee) : (trade.seller_amount ?? trade.amount);
            const reviewDeadline = trade.status === 'pending_release' && trade.auto_confirm_at ? new Date(trade.auto_confirm_at) : null;
            const settlementProcessing = trade.payout_status === 'processing';
            
            return (
              <div id={`trade-${trade.id}`} key={trade.id} className={`card scroll-mt-28 ${isFocused ? 'ring-2 ring-accent/70' : ''}`}>
                <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold mb-1 flex items-center gap-2">
                    {trade.listing_title}
                    {isBuyer && <span className="text-[10px] px-1.5 py-0.5 rounded border border-accent text-accent">YOU BOUGHT</span>}
                    {isSeller && <span className="text-[10px] px-1.5 py-0.5 rounded border border-green-400 text-green-400">YOU SOLD</span>}
                  </div>
                  <div className="text-sm text-text-dim">
                    {new Date(trade.created_at).toLocaleDateString()}
                    {' • '}
                    {isBuyer ? `Seller: ${trade.seller_id.slice(0, 8)}...` : `Buyer: ${trade.buyer_name || 'Unknown'}`}
                    {trade.payment_rail && <>{' • '}{trade.payment_rail.toUpperCase()}</>}
                  </div>
                </div>

                <div className="flex flex-col md:items-end gap-2 w-full md:w-auto">
                  <div className="flex items-center gap-3 justify-between md:justify-end w-full">
                    <div className="text-right">
                      <div className="font-mono font-bold text-gold"><PriceWithKas bankr={displayAmount} kasClassName="text-xs text-text-dim" /></div>
                      <div className="mt-1 font-mono text-[9px] uppercase text-text-dim">{isBuyer ? trade.status === 'pending' ? 'total due' : 'total paid' : 'seller proceeds'}</div>
                    </div>
                    <div className={`text-xs px-2 py-1 rounded-full inline-block text-center min-w-[80px] ${
                      (trade.status === 'completed' || trade.status === 'complete') ? 'bg-green-400/10 text-green-400' :
                      ['pending', 'escrow_held', 'pending_release'].includes(trade.status) ? 'bg-gold/10 text-gold' :
                      'bg-red-400/10 text-red-400'
                    }`}>
                      {trade.status}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 justify-end w-full">
                    {['escrow_held', 'pending_release'].includes(trade.status) && isBuyer && (
                      <>
                        <button 
                          onClick={() => handleUpdateStatus(trade.id, 'disputed')}
                          disabled={actionId === trade.id || settlementProcessing}
                          className="text-xs text-text-dim hover:text-red-400 px-2 py-1 transition-colors"
                        >
                          Report Issue
                        </button>
                        <button 
                          onClick={() => handleUpdateStatus(trade.id, 'completed')}
                          disabled={actionId === trade.id || trade.status === 'escrow_held' || settlementProcessing}
                          className="btn-primary py-1.5 px-3 text-xs whitespace-nowrap bg-green-600 hover:bg-green-500 disabled:opacity-50"
                        >
                          {actionId === trade.id ? '...' : settlementProcessing ? 'Settlement processing' : trade.status === 'escrow_held' ? 'Awaiting delivery' : 'Release escrow'}
                        </button>
                      </>
                    )}
                    
                    {['escrow_held', 'pending_release'].includes(trade.status) && isSeller && (
                      <div className="flex items-center gap-2">
                         <button 
                          onClick={() => handleUpdateStatus(trade.id, 'disputed')}
                          disabled={actionId === trade.id || settlementProcessing}
                          className="text-xs text-text-dim hover:text-red-400 px-2 py-1 transition-colors"
                        >
                          Report Issue
                        </button>
                        {trade.status === 'escrow_held' ? (
                          <button type="button" onClick={() => setDeliveryTrade(trade)} className="btn-primary py-1.5 px-3 text-xs whitespace-nowrap">Submit delivery</button>
                        ) : <div className="text-xs text-text-dim italic px-2">Waiting for buyer review…</div>}
                      </div>
                    )}

                    {(trade.status === 'completed' || trade.status === 'complete') && (isBuyer || isSeller) && (
                      trade.rated_by_caller ? <span className="text-xs text-green-400">✓ Review submitted</span> : (
                        <button onClick={() => setRatingTradeId(trade.id)} className="btn-secondary py-1.5 px-3 text-xs whitespace-nowrap">Rate counterparty</button>
                      )
                    )}
                  </div>
                </div>
                </div>

                <TradeProgress status={trade.status} />

                {trade.status === 'pending' && isBuyer && trade.checkout && <ExternalTradeCheckout tradeId={trade.id} checkout={trade.checkout} onUpdated={onRefresh} />}

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs">
                  <p className="text-text-dim">
                    {trade.status === 'escrow_held' && isSeller && 'Next: submit the finished work for buyer review.'}
                    {trade.status === 'escrow_held' && isBuyer && 'Next: send requirements and wait for the seller to deliver.'}
                    {trade.status === 'pending_release' && settlementProcessing && 'The external settlement transaction is processing. This trade will complete after network confirmation.'}
                    {trade.status === 'pending_release' && !settlementProcessing && isBuyer && 'Next: review the delivery, then release escrow or report an issue.'}
                    {trade.status === 'pending_release' && !settlementProcessing && isSeller && 'The buyer is reviewing your delivery.'}
                    {COMPLETE_STATUSES.has(trade.status) && 'Settlement is complete. The permanent receipt is available below.'}
                    {trade.status === 'disputed' && !settlementProcessing && 'Escrow is frozen while the dispute is reviewed.'}
                    {trade.status === 'disputed' && settlementProcessing && 'The dispute decision is final and its payout/refund transactions are processing.'}
                    {trade.status === 'cancelled' && trade.payout_status === 'processing' && 'A late payment was verified and its full refund is processing.'}
                    {trade.status === 'cancelled' && trade.payout_status === 'refunded' && 'This reservation was cancelled and its late payment was refunded.'}
                    {trade.status === 'cancelled' && !['processing', 'refunded'].includes(trade.payout_status || '') && 'This transaction was cancelled.'}
                  </p>
                  {reviewDeadline && !Number.isNaN(reviewDeadline.getTime()) && <p className="text-text-dim">Auto-release: {reviewDeadline.toLocaleString()}</p>}
                  <div className="flex flex-wrap gap-2">
                    {partnerId && <Link href={`/dashboard/messages?partner=${encodeURIComponent(partnerId)}&trade=${encodeURIComponent(trade.id)}`} className="btn-secondary py-1.5 px-3 text-xs">Message counterparty</Link>}
                    {COMPLETE_STATUSES.has(trade.status) && <Link href={`/proof/${trade.id}`} className="btn-secondary py-1.5 px-3 text-xs">View receipt</Link>}
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
