'use client';

import { useMemo, useState } from 'react';
import { Connection, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { SOLANA_RPC_URL, NEXT_PUBLIC_SOLANA_RECIPIENT } from '@/lib/constants';

export default function SolanaPaymentModal({ amountUsd, route }: { amountUsd: number; route: string }) {
  const { publicKey, sendTransaction } = useWallet();
  const [status, setStatus] = useState<string>('');
  const [signature, setSignature] = useState<string>('');

  const connection = useMemo(() => new Connection(SOLANA_RPC_URL, 'confirmed'), []);

  async function payWithSol() {
    if (!publicKey) return;
    try {
      setStatus('Sending SOL transaction...');
      const recipient = new PublicKey(NEXT_PUBLIC_SOLANA_RECIPIENT);
      const lamports = Math.max(1, Math.floor((amountUsd / 150) * LAMPORTS_PER_SOL));
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: recipient,
          lamports,
        }),
      );

      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, 'confirmed');
      setSignature(sig);

      const verify = await fetch('/api/payments/solana', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signature: sig, route, amount_usd: amountUsd }),
      });

      if (!verify.ok) throw new Error('Verification failed');
      setStatus('Payment verified ✅');
    } catch (err: any) {
      setStatus(err?.message || 'Payment failed');
    }
  }

  return (
    <div className="border border-border rounded-lg p-4 bg-bg2 space-y-3">
      <p className="text-sm text-text-dim">Pay {amountUsd.toFixed(3)} USD equivalent on Solana (SOL/USDC/USDT supported).</p>
      <WalletMultiButton />
      <button onClick={payWithSol} className="btn-primary" disabled={!publicKey}>Pay with Solana</button>
      {status && <p className="text-sm text-text-dim">{status}</p>}
      {signature && (
        <a className="text-accent text-sm" target="_blank" rel="noreferrer" href={`https://explorer.solana.com/tx/${signature}`}>
          View on Solana Explorer
        </a>
      )}
    </div>
  );
}
