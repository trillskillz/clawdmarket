'use client';
import AccountCredit from './AccountCredit';

import { FormEvent, useEffect, useState } from 'react';

interface Transaction {
  id: string;
  type: 'faucet' | 'transfer' | 'escrow_lock' | 'escrow_release' | 'escrow_refund' | 'fee' | 'adjustment';
  amount: number;
  memo?: string;
  created_at: string;
  reference_id?: string;
}

interface WalletData {
  account_id?: string;
  connected_wallet_address?: string | null;
  credit_activity?: Array<{ id: string; kind: string; available_delta: number; escrow_delta: number; created_at: string }>;
  balance: number;
  escrow: number;
  available: number;
  transactions: Transaction[];
}

interface WalletTabProps {
  wallet: WalletData | null;
  loading: boolean;
  onPayoutSaved?: () => Promise<void>;
}

type OwnedAgentPayout = { agent_id: string; name: string; status: string; address: string | null };

export default function WalletTab({ wallet, loading, onPayoutSaved }: WalletTabProps) {
  const [payoutAddress, setPayoutAddress] = useState('');
  const [payoutNotice, setPayoutNotice] = useState('');
  const [payoutBusy, setPayoutBusy] = useState(false);
  const [ownedAgents, setOwnedAgents] = useState<OwnedAgentPayout[]>([]);
  const [agentAddresses, setAgentAddresses] = useState<Record<string, string>>({});
  const [agentNotice, setAgentNotice] = useState<Record<string, string>>({});
  const [agentBusy, setAgentBusy] = useState<string | null>(null);
  const [newPaymentsPaused, setNewPaymentsPaused] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch('/api/payments/payout-address', { credentials: 'include', cache: 'no-store', signal: controller.signal })
        .then((response) => response.ok ? response.json() : null),
      fetch('/api/payments/config', { cache: 'no-store', signal: controller.signal })
        .then((response) => response.ok ? response.json() : null),
    ]).then(([payout, payment]) => {
      if (payout?.address) setPayoutAddress(payout.address);
      if (Array.isArray(payout?.owned_agents)) {
        setOwnedAgents(payout.owned_agents);
        setAgentAddresses(Object.fromEntries(payout.owned_agents.map((agent: OwnedAgentPayout) => [agent.agent_id, agent.address || ''])));
      }
      if (payment) {
        setNewPaymentsPaused(Boolean(payment.new_payments_paused));
      }
    }).catch(() => undefined);
    return () => controller.abort();
  }, []);

  async function savePayoutAddress(event: FormEvent) {
    event.preventDefault();
    setPayoutBusy(true); setPayoutNotice('');
    try {
      const csrf = document.cookie.split('; ').find((part) => part.startsWith('csrf-token='))?.split('=')[1] || '';
      const response = await fetch('/api/payments/payout-address', {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({ address: payoutAddress }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'Could not save payout address');
      setPayoutAddress(data.address); setPayoutNotice('Payout wallet saved.');
      await onPayoutSaved?.();
    } catch (error) { setPayoutNotice(error instanceof Error ? error.message : 'Could not save payout address'); }
    finally { setPayoutBusy(false); }
  }

  async function saveAgentPayoutAddress(event: FormEvent, agentId: string) {
    event.preventDefault();
    setAgentBusy(agentId);
    setAgentNotice((current) => ({ ...current, [agentId]: '' }));
    try {
      const csrf = document.cookie.split('; ').find((part) => part.startsWith('csrf-token='))?.split('=')[1] || '';
      const response = await fetch('/api/payments/payout-address', {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({ agent_id: agentId, address: agentAddresses[agentId] }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'Could not save agent payout address');
      setOwnedAgents((current) => current.map((agent) => agent.agent_id === agentId ? { ...agent, address: data.address } : agent));
      setAgentAddresses((current) => ({ ...current, [agentId]: data.address }));
      setAgentNotice((current) => ({ ...current, [agentId]: 'Agent payout wallet saved.' }));
      await onPayoutSaved?.();
    } catch (error) {
      setAgentNotice((current) => ({ ...current, [agentId]: error instanceof Error ? error.message : 'Could not save agent payout address' }));
    } finally { setAgentBusy(null); }
  }
  if (loading) {
    return (
      <div className="grid md:grid-cols-3 gap-6 mb-8 animate-pulse">
        <div className="h-32 bg-surface rounded-xl"></div>
        <div className="h-32 bg-surface rounded-xl"></div>
        <div className="h-32 bg-surface rounded-xl"></div>
      </div>
    );
  }

  if (!wallet) return <div className="text-center py-12">Failed to load wallet data.</div>;


  return (
    <div>
      <h2 className="text-2xl font-bold mb-2">Account balance and wallets</h2>
      {newPaymentsPaused && <p role="status" className="mb-4">New marketplace payments are paused. Existing payments, deposit recovery, refunds and payouts can still be recovered.</p>}
      <AccountCredit wallet={wallet} agents={ownedAgents} paused={newPaymentsPaused} onUpdated={onPayoutSaved} />

      <form onSubmit={savePayoutAddress} className="card mb-8">
        <label htmlFor="payout-address" className="block text-sm font-semibold mb-2">Your account&apos;s seller payout address</label>
        <p className="text-xs text-text-dim mb-3">Your own listings release verified ERC-20 and MPP settlements to this address after buyer approval or dispute resolution. Registered agents have separate payout wallets below.</p>
        <div className="flex flex-col md:flex-row gap-3">
          <input id="payout-address" value={payoutAddress} onChange={(event) => setPayoutAddress(event.target.value)} placeholder="0x…" required className="flex-1 bg-bg border border-border rounded-lg px-4 py-3 font-mono text-sm" />
          <button disabled={payoutBusy} className="btn-primary px-5">{payoutBusy ? 'Saving…' : 'Save payout wallet'}</button>
        </div>
        {payoutNotice && <p className="text-xs mt-3 text-text-dim" role="status">{payoutNotice}</p>}
      </form>

      {ownedAgents.length > 0 && <section className="mb-8" aria-label="Owned agent payout wallets">
        <h3 className="text-xl font-bold mb-2">Owned agent payout wallets</h3>
        <p className="text-sm text-text-dim mb-4">Each registered agent sells under its own identity. Set its destination here, or let the agent use its API key to set the same payout address.</p>
        <div className="space-y-4">{ownedAgents.map((agent) => (
          <form key={agent.agent_id} onSubmit={(event) => void saveAgentPayoutAddress(event, agent.agent_id)} className="card">
            <label htmlFor={`agent-payout-${agent.agent_id}`} className="block text-sm font-semibold mb-1">{agent.name} payout address</label>
            <p className="text-xs text-text-dim mb-3">{agent.agent_id} · {agent.status}</p>
            <div className="flex flex-col md:flex-row gap-3">
              <input id={`agent-payout-${agent.agent_id}`} value={agentAddresses[agent.agent_id] || ''}
                onChange={(event) => setAgentAddresses((current) => ({ ...current, [agent.agent_id]: event.target.value }))}
                placeholder="0x…" required className="flex-1 bg-bg border border-border rounded-lg px-4 py-3 font-mono text-sm" />
              <button disabled={agentBusy === agent.agent_id} className="btn-primary px-5">{agentBusy === agent.agent_id ? 'Saving…' : 'Save agent payout wallet'}</button>
            </div>
            {agentNotice[agent.agent_id] && <p className="text-xs mt-3 text-text-dim" role="status">{agentNotice[agent.agent_id]}</p>}
          </form>
        ))}</div>
      </section>}

      <p className="text-xs text-text-dim">Historical internal credit is excluded from spendable balances. External trade payments and payouts remain in each trade&apos;s receipts.</p>
    </div>
  );
}
