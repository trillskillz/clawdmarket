'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import WalletLoginPopup from '@/components/WalletLoginPopup';

export default function Navbar() {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showWalletLogin, setShowWalletLogin] = useState(false);
  const [isWalletLoggedIn, setIsWalletLoggedIn] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  const getCsrfToken = () => document.cookie.split('; ').find(r => r.startsWith('csrf-token='))?.split('=')[1] || '';

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-CSRF-Token': getCsrfToken() },
      });
    } catch {
      // Ignore and continue local logout UX
    }
    setIsWalletLoggedIn(false);
    setMobileMenuOpen(false);
    window.location.href = '/';
  };

  useEffect(() => {
    const isPublicMarketingRoute = pathname === '/' || pathname === '/why' || pathname === '/docs';

    const checkAuth = async () => {
      if (isPublicMarketingRoute) {
        setIsWalletLoggedIn(false);
        return;
      }

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
  }, [pathname]);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = mobileMenuOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileMenuOpen]);

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
            <a href="/openapi.json" target="_blank" rel="noopener noreferrer" className="text-text-dim hover:text-text text-sm">OpenAPI</a>
            <a href="https://bankr.bot" target="_blank" rel="noopener noreferrer" className="text-text-dim hover:text-text text-sm">Bankr Integration</a>
          </div>

          <div className="hidden md:flex items-center gap-3">
            {!isWalletLoggedIn ? (
              <button onClick={() => setShowWalletLogin(true)} className="btn-secondary">Connect Wallet</button>
            ) : (
              <>
                <Link href="/dashboard" className="btn-secondary">Dashboard</Link>
                <button onClick={handleLogout} className="btn-secondary">Logout</button>
              </>
            )}
            <Link href="/marketplace" className="btn-primary">Enter App</Link>
          </div>

          <div className="md:hidden flex items-center gap-2">
            {!isWalletLoggedIn && (
              <button onClick={() => setShowWalletLogin(true)} className="btn-secondary text-xs py-1.5 px-2">Connect Wallet</button>
            )}
            <button className="text-text text-2xl" onClick={() => setMobileMenuOpen(!mobileMenuOpen)} aria-label="Menu" aria-expanded={mobileMenuOpen}>{mobileMenuOpen ? '✕' : '☰'}</button>
          </div>
        </div>

        <div
          className={`md:hidden fixed inset-0 top-[73px] bg-black z-40 transition-opacity motion-safe:duration-200 motion-reduce:transition-none ${mobileMenuOpen ? 'opacity-60 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden
        />

        <div
          className={`md:hidden fixed top-[73px] left-0 z-50 h-[calc(100vh-73px)] w-[85%] max-w-sm bg-bg2 border-r border-border transform transition-all motion-safe:duration-200 motion-safe:ease-out motion-reduce:transition-none ${mobileMenuOpen ? 'translate-x-0 opacity-100 pointer-events-auto' : '-translate-x-full opacity-0 pointer-events-none'}`}
        >
          <div className="flex flex-col p-4 gap-3">
            <Link href="/marketplace" onClick={() => setMobileMenuOpen(false)} className="text-text-dim min-h-11 flex items-center py-2">Marketplace</Link>
            <Link href="/why" onClick={() => setMobileMenuOpen(false)} className="text-text-dim min-h-11 flex items-center py-2">Why ClawdMarket</Link>
            <Link href="/docs" onClick={() => setMobileMenuOpen(false)} className="text-text-dim min-h-11 flex items-center py-2">Docs</Link>
            <a href="/openapi.json" target="_blank" rel="noopener noreferrer" className="text-text-dim min-h-11 flex items-center py-2">OpenAPI</a>
            <a href="https://bankr.bot" target="_blank" rel="noopener noreferrer" className="text-text-dim min-h-11 flex items-center py-2">Bankr Integration</a>
            {!isWalletLoggedIn ? (
              <button onClick={() => { setShowWalletLogin(true); setMobileMenuOpen(false); }} className="btn-secondary text-center">Connect Wallet</button>
            ) : (
              <>
                <Link href="/dashboard" onClick={() => setMobileMenuOpen(false)} className="btn-secondary text-center">Dashboard</Link>
                <button onClick={handleLogout} className="btn-secondary text-center">Logout</button>
              </>
            )}
            <Link href="/marketplace" onClick={() => setMobileMenuOpen(false)} className="btn-primary text-center">Enter App</Link>
          </div>
        </div>
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
