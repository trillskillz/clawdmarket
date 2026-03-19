'use client';

import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { NEXT_PUBLIC_BITCOIN_RECIPIENT, BITCOIN_EXPLORER_TX } from '@/lib/constants';

export default function BitcoinPaymentModal({ amountUsd, route }: { amountUsd: number; route: string }) {
  const [btcPrice, setBtcPrice] = useState<number>(0);
  const [txid, setTxid] = useState('');
  const [status, setStatus] = useState('');
  const [qr, setQr] = useState('');
  const [lastTx, setLastTx] = useState('');

  const btcAmount = useMemo(() => (btcPrice ? amountUsd / btcPrice : 0), [amountUsd, btcPrice]);
  const bitcoinUri = useMemo(
    () => `bitcoin:${NEXT_PUBLIC_BITCOIN_RECIPIENT}?amount=${btcAmount.toFixed(8)}&label=ClawdMarket`,
    [btcAmount],
  );

  useEffect(() => {
    fetch('/api/payments/bitcoin/price')
      .then((r) => r.json())
      .then((d) => setBtcPrice(Number(d.btc_usd || 0)))
      .catch(() => setBtcPrice(0));
  }, []);

  useEffect(() => {
    QRCode.toDataURL(bitcoinUri).then(setQr).catch(() => setQr(''));
  }, [bitcoinUri]);

  async function submitTx() {
    setStatus('Verifying transaction...');
    const res = await fetch('/api/payments/bitcoin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txid, route, amount_usd: amountUsd }),
    });
    const data = await res.json();

    if (data?.pending) {
      setStatus('Waiting for confirmation (~10 min)...');
      setLastTx(txid);
      return;
    }

    if (data?.ok) {
      setStatus('Payment verified ✅');
      setLastTx(txid);
      return;
    }

    setStatus('Payment not verified yet.');
  }

  useEffect(() => {
    if (!lastTx || !status.includes('Waiting')) return;
    const timer = setInterval(async () => {
      const res = await fetch(`/api/payments/bitcoin/${lastTx}`);
      const data = await res.json();
      if (data?.ok && data?.status === 'confirmed') {
        setStatus('Payment verified ✅');
      }
    }, 120000);

    return () => clearInterval(timer);
  }, [lastTx, status]);

  return (
    <div className="border border-border rounded-lg p-4 bg-bg2 space-y-3">
      <p className="text-sm text-text-dim">Send {btcAmount.toFixed(8)} BTC (~${amountUsd.toFixed(2)})</p>
      {qr && <img src={qr} alt="Bitcoin payment QR" className="w-40 h-40 rounded bg-white p-2" />}
      <div className="text-xs font-mono break-all text-text-dim">{NEXT_PUBLIC_BITCOIN_RECIPIENT}</div>
      <input value={txid} onChange={(e) => setTxid(e.target.value)} placeholder="Paste txid after sending" className="input-field" />
      <button onClick={submitTx} className="btn-primary">Verify BTC Payment</button>
      {status && <p className="text-sm text-text-dim">{status}</p>}
      {lastTx && (
        <a href={`${BITCOIN_EXPLORER_TX}/${lastTx}`} target="_blank" rel="noreferrer" className="text-accent text-sm">
          View on Blockstream Explorer
        </a>
      )}
    </div>
  );
}
