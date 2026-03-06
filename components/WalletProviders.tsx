'use client';

import { WagmiProvider, createConfig, http } from 'wagmi';
import { base } from 'wagmi/chains';
import { injected, coinbaseWallet, walletConnect } from 'wagmi/connectors';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { ReactNode, useMemo, useState } from 'react';

export function WalletProviders({ children }: { children: ReactNode }) {
  const config = useMemo(
    () =>
      createConfig({
        chains: [base],
        connectors: [
          injected({ shimDisconnect: true }),
          coinbaseWallet({ appName: 'ClawdMarket' }),
          walletConnect({
            projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'demo',
            showQrModal: true,
          }),
        ],
        transports: {
          [base.id]: http(),
        },
        ssr: false,
      }),
    [],
  );

  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
