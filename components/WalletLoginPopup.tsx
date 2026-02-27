'use client';

import '@rainbow-me/rainbowkit/styles.css';
import { ConnectButton, RainbowKitProvider, darkTheme, getDefaultConfig } from '@rainbow-me/rainbowkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider, createStorage, cookieStorage, useAccount, useDisconnect, useSignMessage } from 'wagmi';
import { mainnet, base, polygon, optimism, arbitrum } from 'wagmi/chains';
import { useCallback, useEffect, useState } from 'react';

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'demo';

const config = getDefaultConfig({
  appName: 'ClawdMarket',
  projectId,
  chains: [mainnet, base, polygon, optimism, arbitrum],
  ssr: true,
  storage: createStorage({ storage: cookieStorage }),
});

const queryClient = new QueryClient();

function WalletLoginInner() {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();

  const [status, setStatus] = useState<'idle' | 'signing' | 'authenticating' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

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
    } catch (err: any) {
      setStatus('error');
      setError(err?.message || 'Wallet login failed');
    }
  }, [address, isConnected, signMessageAsync]);

  useEffect(() => {
    if (isConnected && address && status === 'idle') {
      void completeWalletLogin();
    }
  }, [isConnected, address, status, completeWalletLogin]);

  return (
    <div className="fixed inset-x-0 bottom-4 z-[120] px-4">
      <div className="mx-auto max-w-3xl rounded-2xl border border-border bg-bg2/95 backdrop-blur-xl shadow-2xl p-4 md:p-5">
        <div className="mb-3">
          <p className="text-sm uppercase tracking-widest text-text-dim">Login to Trade</p>
          <h3 className="text-lg font-bold">Connect your wallet (MetaMask, Brave, Coinbase, WalletConnect + more)</h3>
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

export default function WalletLoginPopup() {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({
            accentColor: '#7c3aed',
            borderRadius: 'medium',
          })}
        >
          <WalletLoginInner />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
