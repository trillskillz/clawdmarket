'use client';

import { useAccount, useConnect, useDisconnect, useSignMessage, useSwitchChain } from 'wagmi';
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
  const { connectors, connectAsync, isPending: isConnecting } = useConnect();
  const { signMessageAsync } = useSignMessage();
  const { switchChainAsync } = useSwitchChain();

  const [status, setStatus] = useState<'idle' | 'signing' | 'authenticating' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [showWalletMenu, setShowWalletMenu] = useState(false);
  const [shouldShow, setShouldShow] = useState(forceShow);

  const browserWalletConnectors = connectors.filter((c) => {
    const name = c.name.toLowerCase();
    return name.includes('metamask') || name.includes('rabby') || name.includes('injected');
  });

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

      try {
        if (switchChainAsync) {
          await switchChainAsync({ chainId: 8453 });
        }
      } catch {
        // Some connectors/wallets don't support programmatic chain switching.
        // Continue so user can still sign and authenticate.
      }

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
  }, [address, isConnected, signMessageAsync, switchChainAsync, status, router, disconnect, onAuthenticated, redirectToDashboard]);

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
          <div className="flex items-center gap-2 relative">
            {isConnected ? (
              <button onClick={() => disconnect()} className="btn-secondary text-sm py-2 px-3">Disconnect</button>
            ) : (
              <>
                <button
                  onClick={() => {
                    setError(null);
                    const hasInjected = typeof window !== 'undefined' && !!(window as any).ethereum;
                    if (!hasInjected) {
                      setError('No browser wallet detected. Install MetaMask/Rabby or use WalletConnect.');
                      return;
                    }
                    setShowWalletMenu((v) => !v);
                  }}
                  disabled={isConnecting}
                  className="btn-primary text-sm py-2 px-3"
                >
                  {isConnecting ? 'Connecting…' : 'Connect Browser Wallet'}
                </button>
                <button
                  onClick={async () => {
                    try {
                      setError(null);
                      const connector = connectors.find((c) => c.id.includes('coinbase') || c.name.toLowerCase().includes('coinbase'));
                      if (!connector) {
                        setError('Coinbase Wallet connector unavailable');
                        return;
                      }
                      await connectAsync({ connector });
                    } catch (e: any) {
                      setError(e?.message || 'Coinbase Wallet connection failed');
                    }
                  }}
                  disabled={isConnecting}
                  className="btn-secondary text-sm py-2 px-3"
                >
                  Coinbase Wallet
                </button>
                <button
                  onClick={async () => {
                    try {
                      setError(null);
                      const connector = connectors.find((c) => c.id.includes('walletConnect') || c.name.toLowerCase().includes('walletconnect'));
                      if (!connector) {
                        setError('WalletConnect unavailable');
                        return;
                      }
                      await connectAsync({ connector });
                    } catch (e: any) {
                      setError(e?.message || 'WalletConnect failed');
                    }
                  }}
                  disabled={isConnecting}
                  className="btn-secondary text-sm py-2 px-3"
                >
                  WalletConnect
                </button>

                {showWalletMenu && (
                  <div className="absolute mt-14 right-6 bg-bg border border-border rounded-lg shadow-xl p-2 z-10 min-w-[210px]">
                    <div className="text-[11px] text-text-dim px-2 py-1">Detected browser wallets</div>
                    {browserWalletConnectors.length === 0 ? (
                      <div className="px-2 py-1 text-xs text-text-dim">No injected wallets detected</div>
                    ) : (
                      browserWalletConnectors.map((connector) => (
                        <button
                          key={connector.uid}
                          className="w-full text-left px-2 py-2 text-sm rounded hover:bg-bg2"
                          onClick={async () => {
                            try {
                              setError(null);
                              await connectAsync({ connector });
                              setShowWalletMenu(false);
                            } catch (e: any) {
                              setError(e?.message || `Failed to connect ${connector.name}`);
                            }
                          }}
                        >
                          {connector.name}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
