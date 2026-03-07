'use client';

import { useMemo, useState } from 'react';
import { useToast } from '@/components/Toast';

type ContractState = 'DRAFT' | 'FUNDED' | 'IN_PROGRESS' | 'AWAITING_REVIEW' | 'DISPUTED' | 'COMPLETED' | 'CANCELED' | 'EXPIRED' | 'REFUNDED';
type MilestoneState = 'PENDING' | 'ACTIVE' | 'SUBMITTED' | 'AUTO_FAILED' | 'AWAITING_BUYER_REVIEW' | 'CHANGES_REQUESTED' | 'APPROVED' | 'PAID' | 'DISPUTED' | 'REFUNDED';

interface Contract {
  id: string;
  buyer_id: string;
  seller_id: string;
  listing_id?: string | null;
  total_amount: number;
  fee_amount: number;
  escrow_amount: number;
  state: ContractState;
  created_at: string;
}

interface Milestone {
  id: string;
  contract_id: string;
  milestone_index: number;
  title: string;
  amount: number;
  state: MilestoneState;
  review_window_hours: number;
  acceptance_spec: string;
  submission_id?: string | null;
}

interface ContractsTabProps {
  contracts: Contract[];
  loading: boolean;
  currentUserId?: string;
  getCsrfToken: () => string;
  onRefresh: () => Promise<void>;
}

function badgeClass(state: string) {
  if (state === 'COMPLETED' || state === 'PAID' || state === 'APPROVED') return 'bg-green-400/10 border-green-400/30 text-green-300';
  if (state === 'DISPUTED' || state === 'AUTO_FAILED') return 'bg-red-400/10 border-red-400/30 text-red-300';
  if (state === 'AWAITING_REVIEW' || state === 'AWAITING_BUYER_REVIEW' || state === 'SUBMITTED') return 'bg-yellow-400/10 border-yellow-400/30 text-yellow-300';
  return 'bg-bg2 border-border text-text-dim';
}

export default function ContractsTab({ contracts, loading, currentUserId, getCsrfToken, onRefresh }: ContractsTabProps) {
  const { toast } = useToast();
  const [milestonesByContract, setMilestonesByContract] = useState<Record<string, Milestone[]>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const sortedContracts = useMemo(
    () => [...contracts].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)),
    [contracts]
  );

  const loadMilestones = async (contractId: string) => {
    if (milestonesByContract[contractId]) return;
    try {
      const res = await fetch(`/api/contracts/${contractId}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load contract details');
      const data = await res.json();
      setMilestonesByContract((prev) => ({ ...prev, [contractId]: data.milestones || [] }));
    } catch (e: any) {
      toast(e?.message || 'Failed to load milestones', 'error');
    }
  };

  const runContractAction = async (contractId: string, action: 'fund' | 'start' | 'cancel' | 'expire') => {
    setBusy((b) => ({ ...b, [contractId]: true }));
    try {
      const res = await fetch(`/api/contracts/${contractId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': getCsrfToken(),
        },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Contract action failed');
      await onRefresh();
      toast(`Contract updated: ${action}`, 'success');
    } catch (e: any) {
      toast(e?.message || 'Contract action failed', 'error');
    } finally {
      setBusy((b) => ({ ...b, [contractId]: false }));
    }
  };

  const runMilestoneAction = async (
    contractId: string,
    milestoneId: string,
    action: 'submit' | 'approve' | 'request_changes' | 'mark_paid' | 'open_dispute',
  ) => {
    setBusy((b) => ({ ...b, [milestoneId]: true }));
    try {
      const payload: any = { action };
      if (action === 'submit') {
        payload.artifact_bundle = {
          delivery_summary: 'Delivered. Please review artifacts and approve if acceptable.',
          submitted_at: new Date().toISOString(),
        };
      }
      if (action === 'open_dispute') {
        payload.reason_code = 'buyer_dispute';
        payload.evidence = { note: 'Dispute opened from dashboard.' };
      }

      const res = await fetch(`/api/contracts/${contractId}/milestones/${milestoneId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': getCsrfToken(),
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Milestone action failed');

      setMilestonesByContract((prev) => ({ ...prev, [contractId]: data.milestones || prev[contractId] || [] }));
      await onRefresh();
      toast(`Milestone updated: ${action}`, 'success');
    } catch (e: any) {
      toast(e?.message || 'Milestone action failed', 'error');
    } finally {
      setBusy((b) => ({ ...b, [milestoneId]: false }));
    }
  };

  if (loading) return <div className="animate-pulse h-64 bg-surface rounded-xl"></div>;

  if (sortedContracts.length === 0) {
    return <div className="card text-text-dim">No contracts yet. Buying a listing will now auto-create a contract.</div>;
  }

  return (
    <div className="space-y-4">
      {sortedContracts.map((c) => {
        const isBuyer = c.buyer_id === currentUserId;
        const isSeller = c.seller_id === currentUserId;
        const milestones = milestonesByContract[c.id] || [];

        return (
          <div key={c.id} className="card">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm text-text-dim">Contract</div>
                <div className="font-mono text-xs text-text-dim break-all">{c.id}</div>
                <div className="mt-2 text-sm">
                  Total: <span className="font-mono">{Number(c.total_amount).toFixed(2)} BANKR</span> · Fee: <span className="font-mono">{Number(c.fee_amount).toFixed(2)}</span>
                </div>
              </div>
              <span className={`text-xs px-2 py-1 rounded-full border ${badgeClass(c.state)}`}>{c.state}</span>
            </div>

            <div className="flex flex-wrap gap-2 mt-4">
              <button onClick={() => loadMilestones(c.id)} className="btn-secondary text-xs py-1.5" disabled={busy[c.id]}>
                {milestones.length ? 'Refresh Milestones' : 'Load Milestones'}
              </button>
              {isBuyer && c.state === 'DRAFT' && (
                <button onClick={() => runContractAction(c.id, 'fund')} className="btn-primary text-xs py-1.5" disabled={busy[c.id]}>Fund</button>
              )}
              {isSeller && c.state === 'FUNDED' && (
                <button onClick={() => runContractAction(c.id, 'start')} className="btn-primary text-xs py-1.5" disabled={busy[c.id]}>Start</button>
              )}
            </div>

            {milestones.length > 0 && (
              <div className="mt-4 space-y-3 border-t border-border pt-4">
                {milestones.map((m) => (
                  <div key={m.id} className="rounded-lg border border-border p-3 bg-bg/30">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-sm font-semibold">#{m.milestone_index + 1} {m.title}</div>
                        <div className="text-xs text-text-dim mt-1">Amount: {Number(m.amount).toFixed(2)} BANKR</div>
                      </div>
                      <span className={`text-[11px] px-2 py-1 rounded-full border ${badgeClass(m.state)}`}>{m.state}</span>
                    </div>

                    <div className="flex flex-wrap gap-2 mt-3">
                      {isSeller && (m.state === 'ACTIVE' || m.state === 'CHANGES_REQUESTED') && (
                        <button className="btn-primary text-xs py-1.5" disabled={busy[m.id]} onClick={() => runMilestoneAction(c.id, m.id, 'submit')}>
                          Submit
                        </button>
                      )}

                      {isBuyer && m.state === 'AWAITING_BUYER_REVIEW' && (
                        <>
                          <button className="btn-primary text-xs py-1.5" disabled={busy[m.id]} onClick={() => runMilestoneAction(c.id, m.id, 'approve')}>
                            Approve
                          </button>
                          <button className="btn-secondary text-xs py-1.5" disabled={busy[m.id]} onClick={() => runMilestoneAction(c.id, m.id, 'request_changes')}>
                            Request Changes
                          </button>
                          <button className="btn-secondary text-xs py-1.5" disabled={busy[m.id]} onClick={() => runMilestoneAction(c.id, m.id, 'open_dispute')}>
                            Dispute
                          </button>
                        </>
                      )}

                      {isBuyer && m.state === 'APPROVED' && (
                        <button className="btn-primary text-xs py-1.5" disabled={busy[m.id]} onClick={() => runMilestoneAction(c.id, m.id, 'mark_paid')}>
                          Mark Paid
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
