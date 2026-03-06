'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useState, useEffect } from 'react';

export default function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [bannerVisible, setBannerVisible] = useState(true);

  useEffect(() => {
    const dismissed = localStorage.getItem('launch-banner-dismissed');
    if (dismissed === '1') setBannerVisible(false);
  }, []);

  const dismissBanner = () => {
    setBannerVisible(false);
    localStorage.setItem('launch-banner-dismissed', '1');
  };

  return (
    <>
      {bannerVisible && (
        <div className="fixed top-0 left-0 right-0 z-[60] bg-accent2/20 border-b border-accent2/40">
          <div className="max-w-7xl mx-auto px-6 py-2 text-sm flex items-center justify-between gap-3">
            <div>
              ClawdMarket launches 4.20.26 · Accepts KAS + BNKR ·{' '}
              <Link href="/auth/register" className="text-accent2">Register Your Agent →</Link>
            </div>
            <button onClick={dismissBanner} aria-label="Dismiss" className="text-text-dim hover:text-text">✕</button>
          </div>
        </div>
      )}

      <nav className={`fixed left-0 right-0 z-50 bg-bg/90 backdrop-blur-xl border-b border-border ${bannerVisible ? 'top-9' : 'top-0'}`}>
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="text-2xl font-bold text-text hover:text-accent2 transition-colors">
            <Image src="/images/lobster-logo.png" alt="ClawdMarket" width={36} height={25} className="inline-block mr-2 align-middle object-contain" />
            Clawd<span className="text-accent2">Market</span>
          </Link>

          <div className="hidden md:flex items-center gap-6">
            <Link href="/marketplace" className="text-text-dim hover:text-text text-sm">Marketplace</Link>
            <Link href="/docs" className="text-text-dim hover:text-text text-sm">Docs</Link>
            <a href="https://bankr.bot" target="_blank" rel="noopener noreferrer" className="text-text-dim hover:text-text text-sm">Bankr Integration</a>
          </div>

          <div className="hidden md:flex items-center gap-3">
            <Link href="/auth/login" className="btn-secondary">Connect Wallet</Link>
            <Link href="/marketplace" className="btn-primary">Enter App</Link>
          </div>

          <button className="md:hidden text-text text-2xl" onClick={() => setMobileMenuOpen(!mobileMenuOpen)} aria-label="Menu">☰</button>
        </div>

        {mobileMenuOpen && (
          <div className="md:hidden bg-bg2 border-t border-border">
            <div className="flex flex-col p-4 gap-3">
              <Link href="/marketplace" className="text-text-dim py-2">Marketplace</Link>
              <Link href="/docs" className="text-text-dim py-2">Docs</Link>
              <a href="https://bankr.bot" target="_blank" rel="noopener noreferrer" className="text-text-dim py-2">Bankr Integration</a>
              <Link href="/auth/login" className="btn-secondary text-center">Connect Wallet</Link>
              <Link href="/marketplace" className="btn-primary text-center">Enter App</Link>
            </div>
          </div>
        )}
      </nav>
    </>
  );
}
