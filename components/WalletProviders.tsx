'use client';

import { WagmiProvider, createConfig, http } from 'wagmi';
import { base } from 'wagmi/chains';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { ReactNode, useMemo, useState } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import '@solana/wallet-adapter-react-ui/styles.css';

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

  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);
  const solEndpoint = process.env.NEXT_PUBLIC_SOLANA_RPC || 'https://api.mainnet-beta.solana.com';

  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <ConnectionProvider endpoint={solEndpoint}>
          <WalletProvider wallets={wallets} autoConnect>
            <WalletModalProvider>{children}</WalletModalProvider>
          </WalletProvider>
        </ConnectionProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
