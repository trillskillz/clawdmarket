'use client';

import { useEffect, useMemo, useState } from 'react';

type EthereumProvider = {
  isMetaMask?: boolean;
  isBraveWallet?: boolean;
  providers?: EthereumProvider[];
  request?: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

const DISMISS_KEY = 'wallet-popup-dismissed';

const truncateAddress = (value: string) => `${value.slice(0, 6)}...${value.slice(-4)}`;

export default function WalletLoginPopup() {
  const [dismissed, setDismissed] = useState(true);
  const [account, setAccount] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const wasDismissed = localStorage.getItem(DISMISS_KEY) === '1';
    setDismissed(wasDismissed);
  }, []);

  const providers = useMemo(() => {
    const root = window.ethereum;
    const list = root?.providers?.length ? root.providers : root ? [root] : [];

    const findBy = (match: (p: EthereumProvider) => boolean) => list.find(match) ?? null;

    return {
      metamask: findBy((p) => !!p.isMetaMask),
      brave: findBy((p) => !!p.isBraveWallet),
    };
  }, [dismissed]);

  const connectInjected = async (target: 'metamask' | 'brave') => {
    const provider = providers[target];
    if (!provider?.request) {
      setError(`${target === 'metamask' ? 'MetaMask' : 'Brave Wallet'} not detected in this browser.`);
      return;
    }

    try {
      setConnecting(true);
      setError(null);
      const result = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
      const first = result?.[0];
      if (first) setAccount(first);
    } catch {
      setError('Wallet connection was cancelled or failed.');
    } finally {
      setConnecting(false);
    }
  };

  const closePopup = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  };

  if (dismissed) return null;

  return (
    <div className="fixed inset-x-0 bottom-4 z-[120] px-4">
      <div className="mx-auto max-w-3xl rounded-2xl border border-border bg-bg2/95 backdrop-blur-xl shadow-2xl p-4 md:p-5">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div>
            <p className="text-sm uppercase tracking-widest text-text-dim">Wallet Login</p>
            <h3 className="text-lg font-bold">Connect your wallet to start trading</h3>
          </div>
          <button
            type="button"
            onClick={closePopup}
            className="text-text-dim hover:text-text text-sm"
            aria-label="Close wallet popup"
          >
            ✕
          </button>
        </div>

        {account ? (
          <div className="mb-3 rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-400">
            Connected: {truncateAddress(account)}
          </div>
        ) : null}

        {error ? (
          <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </div>
        ) : null}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          <button onClick={() => connectInjected('metamask')} disabled={connecting} className="btn-secondary text-sm py-2">
            🦊 MetaMask
          </button>
          <button onClick={() => connectInjected('brave')} disabled={connecting} className="btn-secondary text-sm py-2">
            🦁 Brave Wallet
          </button>
          <a href="https://www.coinbase.com/wallet" target="_blank" rel="noopener noreferrer" className="btn-secondary text-sm py-2 text-center">
            🟦 Coinbase Wallet
          </a>
          <a href="https://walletconnect.com/" target="_blank" rel="noopener noreferrer" className="btn-secondary text-sm py-2 text-center">
            🔗 WalletConnect
          </a>
        </div>
      </div>
    </div>
  );
}
