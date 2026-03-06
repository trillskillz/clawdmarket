'use client';

import { WagmiProvider, createConfig, http } from 'wagmi';
import { base } from 'wagmi/chains';
import { injected, coinbaseWallet, walletConnect } from 'wagmi/connectors';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { ReactNode, useMemo, useState } from 'react';

export function WalletProviders({ children }: { children: ReactNode }) {
  const config = useMemo(() => {
    const connectors: any[] = [
      injected({ target: 'metaMask', shimDisconnect: true }),
      injected({ target: 'rabby', shimDisconnect: true }),
      injected({ shimDisconnect: true }),
    ];

    // Mobile reliability: enable Coinbase by default unless explicitly disabled.
    if (process.env.NEXT_PUBLIC_ENABLE_COINBASE !== 'false') {
      connectors.push(coinbaseWallet({ appName: 'ClawdMarket' }));
    }

    // Keep WalletConnect available for mobile wallets even if env var is missing.
    const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'demo';
    connectors.push(
      walletConnect({
        projectId: walletConnectProjectId,
        showQrModal: true,
      })
    );

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
