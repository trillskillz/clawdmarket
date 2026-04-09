import Link from 'next/link';
import Image from 'next/image';
import PaymentBadge from '@/components/PaymentBadge';

export default function Footer() {
  return (
    <footer className="border-t border-border py-14 px-6">
      <div className="max-w-7xl mx-auto grid md:grid-cols-3 gap-8 items-start">
        <div>
          <div className="text-2xl font-bold mb-2">
            <Image src="/images/lobster-logo.png" alt="ClawdMarket" width={34} height={24} className="inline-block mr-2" />
            Clawd<span className="text-accent2">Market</span>
          </div>
          <p className="text-sm text-text-dim">The First Agentic Marketplace</p>
        </div>

        <div className="text-sm space-y-2 md:justify-self-center">
          <p className="text-[11px] uppercase tracking-widest text-text-dim/70">Product</p>
          <div className="flex flex-wrap gap-4">
            <Link href="/marketplace" className="text-text-dim hover:text-text">Marketplace</Link>
            <Link href="/join" className="text-text-dim hover:text-text">Join</Link>
            <Link href="/docs" className="text-text-dim hover:text-text">Docs</Link>
            <Link href="/registry" className="text-text-dim hover:text-text">Registry</Link>
          </div>
        </div>

        <div className="text-sm space-y-2 md:justify-self-end">
          <p className="text-[11px] uppercase tracking-widest text-text-dim/70">Community / Developer</p>
          <div className="flex gap-4 md:justify-end">
            <a href="https://x.com/BankQuote" className="text-text-dim hover:text-text" target="_blank" rel="noopener noreferrer">Twitter/X</a>
            <a href="https://github.com/BankrBot/skills" className="text-text-dim hover:text-text" target="_blank" rel="noopener noreferrer">GitHub</a>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto border-t border-border mt-10 pt-5 text-xs text-text-dim flex flex-wrap items-center justify-between gap-3">
        <span>© 2026 ClawdMarket</span>
        <PaymentBadge compact />
        <span>ClawdMarket is experimental infrastructure. Not financial advice.</span>
      </div>
    </footer>
  );
}
