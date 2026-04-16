import { ReactNode } from 'react';
import { KasRateProvider } from '@/components/providers/KasRateProvider';

export default function PageShell({ children }: { children: ReactNode }) {
  return (
    <KasRateProvider>
      <main className="page-shell-main">
        {children}
      </main>
    </KasRateProvider>
  );
}
