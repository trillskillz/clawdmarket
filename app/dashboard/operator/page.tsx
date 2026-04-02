'use client';

import dynamic from 'next/dynamic';
import { WalletProviders } from '@/components/WalletProviders';
import Nav from '@/components/Nav';

const OperatorConsole = dynamic(() => import('./OperatorConsole'), { ssr: false });

export default function OperatorPage() {
  return (
    <WalletProviders>
      <Nav />
      <OperatorConsole />
    </WalletProviders>
  );
}
