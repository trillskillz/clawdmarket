import Navbar from './Navbar';
import Footer from './Footer';
import { ReactNode } from 'react';

export default function PageShell({ children }: { children: ReactNode }) {
  return (
    <>
      <Navbar />
      <main className="min-h-screen pt-24 pb-16 px-6 animate-fade-in-up">
        {children}
      </main>
      <Footer />
    </>
  );
}
