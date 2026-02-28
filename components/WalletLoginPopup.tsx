'use client';

import { useAccount, useDisconnect, useSignMessage } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface WalletLoginPopupProps {
  forceShow?: boolean;
  redirectToDashboard?: boolean;
  onAuthenticated?: () => void;
}

export default function WalletLoginPopup({
  forceShow = false,
  redirectToDashboard = true,
  onAuthenticated,
}: WalletLoginPopupProps) {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();

  const [status, setStatus] = useState<'idle' | 'signing' | 'authenticating' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [shouldShow, setShouldShow] = useState(forceShow);

  // Check if user is already logged in
  useEffect(() => {
    if (forceShow) {
      setShouldShow(true);
      return;
    }

    fetch('/api/auth/me')
      .then(res => {
        if (!res.ok) setShouldShow(true);
      })
      .catch(() => setShouldShow(true));
  }, [forceShow]);

  const completeWalletLogin = useCallback(async () => {
    if (!address || !isConnected) return;

    try {
      setStatus('signing');
      setError(null);

      const nonceRes = await fetch('/api/auth/wallet/nonce', {
        method: 'POST',
        credentials: 'include',
      });

      if (!nonceRes.ok) throw new Error('Failed to start wallet login');
      const { nonce, message } = await nonceRes.json();

      const signature = await signMessageAsync({ message });

      setStatus('authenticating');

      const verifyRes = await fetch('/api/auth/wallet/verify', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, signature, nonce }),
      });

      if (!verifyRes.ok) {
        const payload = await verifyRes.json().catch(() => ({}));
        throw new Error(payload?.error || 'Wallet login failed');
      }

      setStatus('done');
      setTimeout(() => {
        onAuthenticated?.();
        if (redirectToDashboard) {
          router.push('/dashboard');
        }
      }, 500);
    } catch (err: any) {
      setStatus('error');
      setError(err?.message || 'Wallet login failed');
      // Disconnect on failure so user can retry cleanly
      disconnect();
    }
  }, [address, isConnected, signMessageAsync, router, disconnect, onAuthenticated, redirectToDashboard]);

  useEffect(() => {
    if (isConnected && address && status === 'idle') {
      void completeWalletLogin();
    }
  }, [isConnected, address, status, completeWalletLogin]);

  if (!forceShow && !shouldShow) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 sm:bottom-4 z-[120] sm:px-4">
      <div className="mx-auto w-full sm:max-w-xl rounded-t-2xl sm:rounded-2xl border-t sm:border border-border bg-bg2/95 backdrop-blur-xl shadow-2xl p-6 sm:p-5 pb-8 sm:pb-5">
        <div className="mb-4 sm:mb-3">
          <p className="text-xs sm:text-sm uppercase tracking-widest text-text-dim">Login to Trade</p>
          <h3 className="text-base sm:text-lg font-bold">Connect your wallet</h3>
        </div>

        {status === 'signing' && <p className="text-xs text-accent2 mb-2">Please sign the wallet message to continue…</p>}
        {status === 'authenticating' && <p className="text-xs text-accent2 mb-2">Verifying signature and signing you in…</p>}
        {status === 'done' && <p className="text-xs text-green-400 mb-2">Wallet connected and authenticated ✅</p>}
        {error && <p className="text-xs text-red-400 mb-2">{error}</p>}
        
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
          <p className="text-xs text-text-dim">Seamless wallet login for browser wallets and desktop/mobile wallets via QR.</p>
          <div className="flex items-center gap-2">
            {isConnected ? (
              <button onClick={() => disconnect()} className="btn-secondary text-sm py-2 px-3">Disconnect</button>
            ) : null}
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false} />
          </div>
        </div>
      </div>
    </div>
  );
}
