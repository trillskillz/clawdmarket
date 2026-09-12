import { ReactNode } from 'react';

export default function PageShell({ children }: { children: ReactNode }) {
  return (
    <main className="page-shell-main">
      {children}
    </main>
  );
}
