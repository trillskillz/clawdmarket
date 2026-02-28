'use client';

import { useAccount, useDisconnect, useSignMessage, useSwitchChain } from 'wagmi';
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
  const { switchChainAsync } = useSwitchChain();

  const [status, setStatus] = useState<'idle' | 'signing' | 'authenticating' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [shouldShow, setShouldShow] = useState(forceShow);

  // Check if user is already logged in
  useEffect(() => {
    if (forceShow) {
      setShouldShow(true);
      return;
    }

    const checkAuth = async () => {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          // Already authenticated on server
          setShouldShow(false);
          setStatus('done'); 
        } else {
          // Not authenticated
          setShouldShow(true);
        }
      } catch {
        setShouldShow(true);
      }
    };
    
    checkAuth();
  }, [forceShow]);

  const completeWalletLogin = useCallback(async () => {
    if (!address || !isConnected) return;
    
    // Don't re-run if already authenticated or in progress
    if (status !== 'idle') return;

    try {
      setStatus('signing');
      setError(null);

      // Check if we already have a session valid for this address before signing again?
      // Actually, if we are here, checkAuth failed or forceShow is true.
      // But let's double check if the server already knows us to avoid unnecessary signing.
      const meRes = await fetch('/api/auth/me');
      if (meRes.ok) {
         const data = await meRes.json();
         if (data.user.wallet?.toLowerCase() === address.toLowerCase()) {
            setStatus('done');
            setShouldShow(false);
            onAuthenticated?.();
            return;
         }
      }

      const nonceRes = await fetch('/api/auth/wallet/nonce', {
        method: 'POST',
        credentials: 'include',
      });

      if (!nonceRes.ok) throw new Error('Failed to start wallet login');
      const { nonce, message } = await nonceRes.json();

      await switchChainAsync({ chainId: 8453 });

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

  if (!shouldShow) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4">
      <div className="w-full sm:max-w-xl rounded-t-2xl sm:rounded-2xl border-t sm:border border-border bg-bg2 shadow-2xl p-6 sm:p-5 pb-8 sm:pb-5">
        <div className="mb-4 sm:mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs sm:text-sm uppercase tracking-widest text-text-dim">Login to Trade</p>
            <h3 className="text-base sm:text-lg font-bold">Connect your wallet</h3>
          </div>
          <button onClick={() => setShouldShow(false)} className="text-text-dim hover:text-text text-sm">Close</button>
        </div>

        {status === 'signing' && <p className="text-xs text-accent2 mb-2">Please sign the wallet message to continue…</p>}
        {status === 'authenticating' && <p className="text-xs text-accent2 mb-2">Verifying signature and signing you in…</p>}
        {status === 'done' && <p className="text-xs text-green-400 mb-2">Wallet connected and authenticated ✅</p>}
        {error && <p className="text-xs text-red-400 mb-2">{error}</p>}

        <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
          <p className="text-xs text-text-dim">Use your Base wallet to pay in BANKR.</p>
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
