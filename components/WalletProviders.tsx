'use client';

import { WagmiProvider, createConfig, http } from 'wagmi';
import { base } from 'wagmi/chains';
import { injected } from 'wagmi/connectors';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { ReactNode, useMemo, useState } from 'react';

export function WalletProviders({ children }: { children: ReactNode }) {
  const config = useMemo(() => {
    const connectors: any[] = [
      injected({ target: 'metaMask', shimDisconnect: true }),
      injected({ target: 'rabby', shimDisconnect: true }),
      injected({ shimDisconnect: true }),
    ];

    // Phase 2 migration baseline: keep injected wallets enabled first,
    // then re-introduce coinbase/walletconnect once connector deps are aligned for wagmi v3.

    return createConfig({
      chains: [base],
      connectors,
      transports: {
        [base.id]: http(),
      },
      ssr: false,
    });
  }, []);

  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
