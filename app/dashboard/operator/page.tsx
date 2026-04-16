'use client';

import dynamic from 'next/dynamic';

const OperatorConsole = dynamic(() => import('./OperatorConsole'), { ssr: false });
const WalletProviders = dynamic(
  () => import('@/components/WalletProviders').then((mod) => mod.WalletProviders),
  { ssr: false },
);

export default function OperatorPage() {
  return (
    <WalletProviders>
      <OperatorConsole />
    </WalletProviders>
  );
}
