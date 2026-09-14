'use client';

import { WagmiProvider, createConfig, http } from 'wagmi';
import { avalanche, arbitrum, base, bsc, mainnet, optimism, polygon } from 'wagmi/chains';
import { injected, coinbaseWallet, walletConnect } from 'wagmi/connectors';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { ReactNode, useMemo, useState } from 'react';

const chains = [mainnet, polygon, bsc, avalanche, arbitrum, optimism, base] as const;

export function WalletProviders({ children }: { children: ReactNode }) {
  const config = useMemo(() => {
    const wcProjectId =
      process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ||
      process.env.NEXT_PUBLIC_WC_PROJECT_ID;

    return createConfig({
      chains,
      connectors: [
        injected({ target: 'metaMask', unstable_shimAsyncInject: 1000 }),
        coinbaseWallet({ appName: 'ClawdMarket' }),
        ...(wcProjectId ? [walletConnect({ projectId: wcProjectId })] : []),
      ],
      // Discover EIP-6963 wallets (Rabby, Phantom, browser extensions, etc.)
      // while keeping the targeted MetaMask connector as a legacy fallback.
      multiInjectedProviderDiscovery: true,
      transports: {
        [mainnet.id]: http(),
        [polygon.id]: http(),
        [bsc.id]: http(),
        [avalanche.id]: http(),
        [arbitrum.id]: http(),
        [optimism.id]: http(),
        [base.id]: http(),
      },
      ssr: false,
    });
  }, []);

  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
