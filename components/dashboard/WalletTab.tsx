'use client';

import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';

interface Transaction {
  id: string;
  type: 'faucet' | 'transfer' | 'escrow_lock' | 'escrow_release' | 'escrow_refund' | 'fee';
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
}

export default function WalletTab({ wallet, loading }: WalletTabProps) {
  const { address, isConnected } = useAccount();
  // NOTE: wagmi v3 migration follow-up:
  // replace this with ERC-20 BANKR reads via useReadContract.
  const onchainBankr: number | null = null;
  const canUseOnchain = false;
  const [source, setSource] = useState<'onchain' | 'ledger'>(canUseOnchain ? 'onchain' : 'ledger');

  useEffect(() => {
    if (!canUseOnchain && source === 'onchain') setSource('ledger');
    if (canUseOnchain && !isConnected) setSource('ledger');
  }, [canUseOnchain, isConnected, source]);

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
  const usingOnchain = source === 'onchain' && canUseOnchain;

  const total = usingOnchain && onchainBankr !== null ? onchainBankr : ledgerTotal;
  const available = usingOnchain && onchainBankr !== null ? onchainBankr : wallet.available;

  return (
    <div>
      <h2 className="text-2xl font-bold mb-2">My Wallet 💳</h2>
      <p className="text-sm text-text-dim mb-3">
        {usingOnchain && address
          ? `Connected wallet: ${address.slice(0, 6)}...${address.slice(-4)} (on-chain BANKR)`
          : 'Showing internal ledger balance (connect wallet to view on-chain BANKR).'}
      </p>

      <div className="flex items-center gap-2 mb-6">
        <span className="text-xs uppercase tracking-wider text-text-dim">Balance Source</span>
        <button
          onClick={() => setSource('ledger')}
          className={`px-3 py-1 rounded text-xs ${source === 'ledger' ? 'bg-accent text-black' : 'bg-surface text-text-dim'}`}
        >
          Internal Ledger
        </button>
        <button
          onClick={() => canUseOnchain && setSource('onchain')}
          disabled={!canUseOnchain}
          className={`px-3 py-1 rounded text-xs ${source === 'onchain' && canUseOnchain ? 'bg-accent text-black' : 'bg-surface text-text-dim'} ${!canUseOnchain ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          On-Chain BANKR
        </button>
      </div>

      {/* Balance Cards */}
      <div className="grid md:grid-cols-3 gap-6 mb-12">
        <div className="card border-l-4 border-l-accent bg-gradient-to-br from-surface to-surface/50">
          <div className="text-sm text-text-dim uppercase tracking-wider font-semibold mb-2">Total Value</div>
          <div className="text-4xl font-mono font-bold text-white">
            {total.toLocaleString(undefined, { maximumFractionDigits: 4 })} <span className="text-lg text-accent">BANKR</span>
          </div>
        </div>

        <div className="card border-l-4 border-l-green-500 bg-gradient-to-br from-surface to-surface/50">
          <div className="text-sm text-text-dim uppercase tracking-wider font-semibold mb-2">Available</div>
          <div className="text-4xl font-mono font-bold text-green-400">
            {available.toLocaleString(undefined, { maximumFractionDigits: 4 })} <span className="text-lg text-green-500/70">BANKR</span>
          </div>
          <div className="text-xs text-text-dim mt-2">{usingOnchain ? 'From connected wallet on Base' : 'Ready to spend'}</div>
        </div>

        <div className="card border-l-4 border-l-gold bg-gradient-to-br from-surface to-surface/50">
          <div className="text-sm text-text-dim uppercase tracking-wider font-semibold mb-2">In Escrow</div>
          <div className="text-4xl font-mono font-bold text-gold">
            {wallet.escrow.toLocaleString()} <span className="text-lg text-gold/70">BANKR</span>
          </div>
          <div className="text-xs text-text-dim mt-2">Locked in active trades</div>
        </div>
      </div>

      {/* Transactions */}
      <h3 className="text-xl font-bold mb-4">Transaction History</h3>
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
                      tx.type === 'fee' ? 'bg-red-400/10 text-red-400' :
                      'bg-text-dim/10 text-text-dim'
                    }`}>
                      {tx.type.replace('_', ' ')}
                    </span>
                  </td>
                  <td className={`px-6 py-4 font-mono font-bold ${
                    ['escrow_lock', 'fee', 'transfer'].includes(tx.type) ? 'text-red-400' : 'text-green-400'
                  }`}>
                    {['escrow_lock', 'fee', 'transfer'].includes(tx.type) ? '-' : '+'}{tx.amount}
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
