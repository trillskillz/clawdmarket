'use client';

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
  const [ledgerEnabled, setLedgerEnabled] = useState<boolean | null>(null);
  const [ledgerRedeemable, setLedgerRedeemable] = useState<boolean | null>(null);
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
        setLedgerEnabled(Boolean(payment.ledger_enabled));
        setLedgerRedeemable(Boolean(payment.ledger_redeemable));
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

  const ledgerTotal = wallet.available + wallet.escrow;

  return (
    <div>
      <h2 className="text-2xl font-bold mb-2">Credits and payouts</h2>
      <p className="text-sm text-text-dim mb-3">
        Internal account credit and your external seller payout wallet are separate. This page does not show the USDC or pathUSD held in your own wallet.
      </p>
      {ledgerRedeemable === false && <p className="mb-4 rounded-lg border border-amber-300/30 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">Internal credit is not redeemable for cash or tokens. External marketplace payments and seller payouts are tracked with each trade, not added to these credit totals.</p>}
      {newPaymentsPaused && <p className="mb-4 rounded-lg border border-amber-300/30 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">New marketplace payments are temporarily paused. Existing payment recovery, refunds, and payouts continue.</p>}
      {ledgerEnabled === false && !newPaymentsPaused && <p className="mb-6 rounded-lg border border-amber-300/30 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">Internal-credit payments are currently disabled. External seller payouts still settle to your configured address.</p>}

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

      {/* Balance Cards */}
      <div className="grid md:grid-cols-3 gap-6 mb-12">
        <div className="card border-l-4 border-l-accent bg-gradient-to-br from-surface to-surface/50">
          <div className="text-sm text-text-dim uppercase tracking-wider font-semibold mb-2">Internal Credit Total</div>
          <div className="text-4xl font-mono font-bold text-white">
            ${ledgerTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })} <span className="text-lg text-accent">USD</span>
          </div>
        </div>

        <div className="card border-l-4 border-l-green-500 bg-gradient-to-br from-surface to-surface/50">
          <div className="text-sm text-text-dim uppercase tracking-wider font-semibold mb-2">Available Credit</div>
          <div className="text-4xl font-mono font-bold text-green-400">
            ${wallet.available.toLocaleString(undefined, { maximumFractionDigits: 2 })} <span className="text-lg text-green-500/70">USD</span>
          </div>
          <div className="text-xs text-text-dim mt-2">Spendable only if internal-credit payments are enabled</div>
        </div>

        <div className="card border-l-4 border-l-gold bg-gradient-to-br from-surface to-surface/50">
          <div className="text-sm text-text-dim uppercase tracking-wider font-semibold mb-2">Internal Credit Held</div>
          <div className="text-4xl font-mono font-bold text-gold">
            ${wallet.escrow.toLocaleString(undefined, { maximumFractionDigits: 2 })} <span className="text-lg text-gold/70">USD</span>
          </div>
          <div className="text-xs text-text-dim mt-2">Internal-credit trades only; external payments are excluded</div>
        </div>
      </div>

      {/* Transactions */}
      <h3 className="text-xl font-bold mb-4">Internal credit activity</h3>
      <div className="bg-surface rounded-xl border border-border overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-bg border-b border-border">
            <tr>
              <th className="px-6 py-3 text-xs font-bold text-text-dim uppercase">Type</th>
              <th className="px-6 py-3 text-xs font-bold text-text-dim uppercase">Amount</th>
              <th className="px-6 py-3 text-xs font-bold text-text-dim uppercase">Details</th>
              <th className="px-6 py-3 text-xs font-bold text-text-dim uppercase text-right">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {wallet.transactions.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-6 py-12 text-center text-text-dim">
                  No transactions yet.
                </td>
              </tr>
            ) : (
              wallet.transactions.map((tx) => (
                <tr key={tx.id} className="hover:bg-bg/50 transition-colors">
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      tx.type === 'faucet' ? 'bg-blue-400/10 text-blue-400' :
                      tx.type === 'escrow_lock' ? 'bg-gold/10 text-gold' :
                      tx.type === 'escrow_release' ? 'bg-green-400/10 text-green-400' :
                      tx.type === 'fee' || tx.type === 'adjustment' ? 'bg-red-400/10 text-red-400' :
                      'bg-text-dim/10 text-text-dim'
                    }`}>
                      {tx.type.replace('_', ' ')}
                    </span>
                  </td>
                  <td className={`px-6 py-4 font-mono font-bold ${
                    ['escrow_lock', 'fee', 'transfer', 'adjustment'].includes(tx.type) ? 'text-red-400' : 'text-green-400'
                  }`}>
                    {['escrow_lock', 'fee', 'transfer', 'adjustment'].includes(tx.type) ? '-' : '+'}{tx.amount}
                  </td>
                  <td className="px-6 py-4 text-sm text-text-dim">
                    {tx.memo || '-'}
                    {tx.reference_id && (
                      <span className="block text-xs font-mono text-text-dim/50 mt-1">Ref: {tx.reference_id.slice(0, 8)}...</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm text-text-dim text-right font-mono">
                    {new Date(tx.created_at).toLocaleDateString()}
                    <span className="block text-xs">{new Date(tx.created_at).toLocaleTimeString()}</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
