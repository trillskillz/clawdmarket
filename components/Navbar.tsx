'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useState, useEffect } from 'react';
import WalletLoginPopup from '@/components/WalletLoginPopup';

export default function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showWalletLogin, setShowWalletLogin] = useState(false);
  const [isWalletLoggedIn, setIsWalletLoggedIn] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch('/api/auth/me', { credentials: 'include', cache: 'no-store' });
        setIsWalletLoggedIn(res.ok);
      } catch {
        setIsWalletLoggedIn(false);
      }
    };

    checkAuth();
    const onFocus = () => checkAuth();
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();

    window.addEventListener('focus', onFocus);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  return (
    <>
      <nav className={`fixed top-0 left-0 right-0 z-50 border-b transition-all duration-200 ${scrolled ? 'bg-bg/95 backdrop-blur-[12px] border-border' : 'bg-bg/80 backdrop-blur-md border-border'}`}>
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="text-2xl font-bold text-text hover:text-accent2 transition-colors">
            <Image src="/images/lobster-logo.png" alt="ClawdMarket" width={36} height={25} className="inline-block mr-2 align-middle object-contain" />
            Clawd<span className="text-accent2">Market</span>
          </Link>

          <div className="hidden md:flex items-center gap-6">
            <Link href="/marketplace" className="text-text-dim hover:text-text text-sm">Marketplace</Link>
            <Link href="/why" className="text-text-dim hover:text-text text-sm">Why ClawdMarket</Link>
            <Link href="/docs" className="text-text-dim hover:text-text text-sm">Docs</Link>
            <a href="https://bankr.bot" target="_blank" rel="noopener noreferrer" className="text-text-dim hover:text-text text-sm">Bankr Integration</a>
          </div>

          <div className="hidden md:flex items-center gap-3">
            {!isWalletLoggedIn && (
              <button onClick={() => setShowWalletLogin(true)} className="btn-secondary">Connect Wallet</button>
            )}
            <Link href="/marketplace" className="btn-primary">Enter App</Link>
          </div>

          <div className="md:hidden flex items-center gap-2">
            {!isWalletLoggedIn && (
              <button onClick={() => setShowWalletLogin(true)} className="btn-secondary text-xs py-1.5 px-2">Connect Wallet</button>
            )}
            <button className="text-text text-2xl" onClick={() => setMobileMenuOpen(!mobileMenuOpen)} aria-label="Menu">☰</button>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="md:hidden bg-bg2 border-t border-border">
            <div className="flex flex-col p-4 gap-3">
              <Link href="/marketplace" className="text-text-dim py-2">Marketplace</Link>
              <Link href="/why" className="text-text-dim py-2">Why ClawdMarket</Link>
              <Link href="/docs" className="text-text-dim py-2">Docs</Link>
              <a href="https://bankr.bot" target="_blank" rel="noopener noreferrer" className="text-text-dim py-2">Bankr Integration</a>
              {!isWalletLoggedIn ? (
                <button onClick={() => setShowWalletLogin(true)} className="btn-secondary text-center">Connect Wallet</button>
              ) : (
                <Link href="/dashboard" className="btn-secondary text-center">Dashboard</Link>
              )}
              <Link href="/marketplace" className="btn-primary text-center">Enter App</Link>
            </div>
          </div>
        )}
      </nav>

      {showWalletLogin && (
        <WalletLoginPopup
          forceShow
          redirectToDashboard={false}
          onAuthenticated={() => {
            setIsWalletLoggedIn(true);
            setShowWalletLogin(false);
            window.location.href = '/dashboard';
          }}
        />
      )}
    </>
  );
}
