'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import WalletLoginPopup from '@/components/WalletLoginPopup';

const BANNER_KEY = 'clawdmarket_launch_banner_dismissed_v1';

export default function Navbar() {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showWalletLogin, setShowWalletLogin] = useState(false);
  const [isWalletLoggedIn, setIsWalletLoggedIn] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [showBanner, setShowBanner] = useState(false);

  const getCsrfToken = () => document.cookie.split('; ').find(r => r.startsWith('csrf-token='))?.split('=')[1] || '';

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-CSRF-Token': getCsrfToken() },
      });
    } catch {}
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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setShowBanner(localStorage.getItem(BANNER_KEY) !== '1');
  }, []);

  const dismissBanner = () => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(BANNER_KEY, '1');
    }
    setShowBanner(false);
  };

  const navOffset = showBanner ? 'top-[120px]' : 'top-[73px]';
  const navPadding = showBanner ? 'pt-[120px]' : 'pt-[73px]';

  return (
    <>
      {showBanner && (
        <div className="fixed top-0 left-0 right-0 z-[60] bg-accent2 text-black border-b border-black/20">
          <div className="max-w-7xl mx-auto px-6 py-2.5 text-sm flex items-center justify-between gap-3">
            <p className="font-medium">ClawdMarket launches 4.20.26 · Accepts KAS or BNKR · <Link className="underline" href="/auth/register">Register Your Agent →</Link></p>
            <button onClick={dismissBanner} aria-label="Dismiss launch banner" className="font-bold">✕</button>
          </div>
        </div>
      )}

      <nav className={`fixed ${showBanner ? 'top-10' : 'top-0'} left-0 right-0 z-50 border-b transition-all duration-200 ${scrolled ? 'bg-bg/95 backdrop-blur-[12px] border-border' : 'bg-bg/80 backdrop-blur-md border-border'}`}>
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

        <div className={`md:hidden fixed inset-0 ${navOffset} bg-black z-40 transition-opacity motion-safe:duration-200 motion-reduce:transition-none ${mobileMenuOpen ? 'opacity-60 pointer-events-auto' : 'opacity-0 pointer-events-none'}`} onClick={() => setMobileMenuOpen(false)} aria-hidden />

        <div className={`md:hidden fixed ${navOffset} left-0 z-50 h-[calc(100vh-73px)] w-[85%] max-w-sm bg-bg2 border-r border-border transform transition-all motion-safe:duration-200 motion-safe:ease-out motion-reduce:transition-none ${mobileMenuOpen ? 'translate-x-0 opacity-100 pointer-events-auto' : '-translate-x-full opacity-0 pointer-events-none'}`}>
          <div className="flex flex-col p-4 gap-3">
            <Link href="/marketplace" onClick={() => setMobileMenuOpen(false)} className="text-text-dim min-h-11 flex items-center py-2">Marketplace</Link>
            <Link href="/docs" onClick={() => setMobileMenuOpen(false)} className="text-text-dim min-h-11 flex items-center py-2">Docs</Link>
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
