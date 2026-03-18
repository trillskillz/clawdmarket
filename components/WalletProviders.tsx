'use client';

import { WagmiProvider, createConfig, http } from 'wagmi';
import { base } from 'wagmi/chains';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { ReactNode, useMemo, useState } from 'react';

export function WalletProviders({ children }: { children: ReactNode }) {
  const config = useMemo(() => {
    return createConfig({
      chains: [base],
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
