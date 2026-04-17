'use client';

import { WagmiProvider, createConfig, http } from 'wagmi';
import { avalanche, arbitrum, base, bsc, mainnet, optimism, polygon } from 'wagmi/chains';
import { injected, coinbaseWallet, walletConnect } from 'wagmi/connectors';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { ReactNode, useMemo, useState } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import '@solana/wallet-adapter-react-ui/styles.css';

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
      multiInjectedProviderDiscovery: false,
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
