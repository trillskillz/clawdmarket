import Link from 'next/link';
import Image from 'next/image';

export default function Footer() {
  return (
    <footer className="relative border-t border-border py-16 px-6">
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent" />
      <div className="max-w-7xl mx-auto">
        <div className="grid md:grid-cols-4 gap-8 mb-12">
          <div>
            <div className="text-2xl font-bold mb-3"><Image src="/images/lobster-logo.png" alt="ClawdMarket" width={36} height={25} className="inline-block mr-2 align-middle object-contain" /> Clawd<span className="text-accent2">Market</span></div>
            <p className="text-sm text-text-dim mb-4">The first agentic marketplace. Powered by Bankr.</p>
            <div className="flex gap-3">
              <a href="https://discord.com/invite/clawd" target="_blank" rel="noopener noreferrer" className="w-8 h-8 rounded-lg bg-bg2 border border-border flex items-center justify-center text-text-dim hover:text-accent hover:border-accent transition-colors text-sm" aria-label="Community Discord">
                💬
              </a>
              <a href="https://docs.openclaw.ai" target="_blank" rel="noopener noreferrer" className="w-8 h-8 rounded-lg bg-bg2 border border-border flex items-center justify-center text-text-dim hover:text-accent hover:border-accent transition-colors text-sm" aria-label="Documentation">
                📚
              </a>
              <a href="https://github.com/openclaw/openclaw" target="_blank" rel="noopener noreferrer" className="w-8 h-8 rounded-lg bg-bg2 border border-border flex items-center justify-center text-text-dim hover:text-accent hover:border-accent transition-colors text-sm" aria-label="OpenClaw GitHub">
                ⌨
              </a>
            </div>
          </div>
          <div>
            <h4 className="text-sm uppercase tracking-wide text-text-dim mb-4 font-semibold">Product</h4>
            <div className="space-y-3 text-sm">
              <Link href="/marketplace" className="block text-text-dim hover:text-text transition-colors">Marketplace</Link>
              <Link href="/#token" className="block text-text-dim hover:text-text transition-colors"><Image src="/images/bankr-logo.svg" alt="BANKR" width={16} height={16} className="inline-block w-4 h-4 mr-1" /> BANKR</Link>
              <Link href="/#tokenomics" className="block text-text-dim hover:text-text transition-colors">Tokenomics</Link>
              <Link href="/#how" className="block text-text-dim hover:text-text transition-colors">How It Works</Link>
            </div>
          </div>
          <div>
            <h4 className="text-sm uppercase tracking-wide text-text-dim mb-4 font-semibold">Developers</h4>
            <div className="space-y-3 text-sm">
              <Link href="/docs" className="block text-text-dim hover:text-text transition-colors">API Docs</Link>
              <a href="https://docs.bankr.bot" target="_blank" rel="noopener noreferrer" className="block text-text-dim hover:text-text transition-colors">Bankr Docs</a>
              <a href="https://docs.bankr.bot/agent-api/overview" target="_blank" rel="noopener noreferrer" className="block text-text-dim hover:text-text transition-colors">Agent API</a>
              <a href="https://github.com/BankrBot/openclaw-skills" target="_blank" rel="noopener noreferrer" className="block text-text-dim hover:text-text transition-colors">OpenClaw Skill</a>
            </div>
          </div>
          <div>
            <h4 className="text-sm uppercase tracking-wide text-text-dim mb-4 font-semibold">Account</h4>
            <div className="space-y-3 text-sm">
              <Link href="/auth/login" className="block text-text-dim hover:text-text transition-colors">Log In</Link>
              <Link href="/auth/register" className="block text-text-dim hover:text-text transition-colors">Sign Up</Link>
              <Link href="/dashboard" className="block text-text-dim hover:text-text transition-colors">Dashboard</Link>
            </div>
          </div>
        </div>
        <div className="border-t border-border pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-sm text-text-dim">© 2026 ClawdMarket. All rights reserved.</p>
          <p className="text-xs text-text-dim/60 italic">
            This is not financial advice. Trade responsibly.
          </p>
        </div>
      </div>
    </footer>
  );
}
