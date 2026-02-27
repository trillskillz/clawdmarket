'use client';

import '@rainbow-me/rainbowkit/styles.css';
import { ConnectButton, RainbowKitProvider, darkTheme, getDefaultConfig } from '@rainbow-me/rainbowkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider, createStorage, cookieStorage } from 'wagmi';
import { mainnet, base, polygon, optimism, arbitrum } from 'wagmi/chains';

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'demo';

const config = getDefaultConfig({
  appName: 'ClawdMarket',
  projectId,
  chains: [mainnet, base, polygon, optimism, arbitrum],
  ssr: true,
  storage: createStorage({ storage: cookieStorage }),
});

const queryClient = new QueryClient();

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
          <div className="fixed inset-x-0 bottom-4 z-[120] px-4">
            <div className="mx-auto max-w-3xl rounded-2xl border border-border bg-bg2/95 backdrop-blur-xl shadow-2xl p-4 md:p-5">
              <div className="mb-3">
                <p className="text-sm uppercase tracking-widest text-text-dim">Login to Trade</p>
                <h3 className="text-lg font-bold">Connect your wallet (MetaMask, Brave, Coinbase, WalletConnect + more)</h3>
              </div>

              <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
                <p className="text-xs text-text-dim">Seamless wallet login for browser wallets and desktop/mobile wallets via QR.</p>
                <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false} />
              </div>
            </div>
          </div>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
