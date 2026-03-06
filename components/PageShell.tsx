import Navbar from './Navbar';
import Footer from './Footer';
import { ReactNode } from 'react';
import { KasRateProvider } from '@/components/providers/KasRateProvider';

export default function PageShell({ children }: { children: ReactNode }) {
  return (
    <KasRateProvider>
      <div className="fixed inset-0 pointer-events-none z-[-1] overflow-hidden bg-bg">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-accent/5 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-accent2/5 blur-[120px]" />
        <div className="absolute inset-0" style={{
          backgroundImage: 'linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
          opacity: 0.03
        }} />
      </div>
      <Navbar />
      <main className="min-h-screen pt-24 pb-16 px-6 animate-fade-in-up relative z-0">
        {children}
      </main>
      <Footer />
    </KasRateProvider>
  );
}
