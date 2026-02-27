'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useState, useEffect } from 'react';

export default function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState<'default' | 'terminal' | 'light'>('default');

  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') as 'default' | 'terminal' | 'light';
    if (savedTheme) {
      setTheme(savedTheme);
      document.documentElement.classList.remove('terminal-theme', 'light-theme');
      if (savedTheme === 'terminal') document.documentElement.classList.add('terminal-theme');
      if (savedTheme === 'light') document.documentElement.classList.add('light-theme');
    }
    checkAuth();
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'default' : 'light';
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
    document.documentElement.classList.remove('terminal-theme', 'light-theme');
    if (newTheme === 'light') {
      document.documentElement.classList.add('light-theme');
    }
  };

  const checkAuth = async () => {
    try {
      const res = await fetch('/api/auth/me', {
        credentials: 'include',
      });
      setIsAuthenticated(res.ok);

      if (res.ok) {
        const data = await res.json();
        setWalletAddress(data?.user?.wallet || null);
      } else {
        setWalletAddress(null);
      }
    } catch {
      setIsAuthenticated(false);
      setWalletAddress(null);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      const csrfToken = document.cookie
        .split('; ')
        .find(row => row.startsWith('csrf-token='))
        ?.split('=')[1];

      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'X-CSRF-Token': csrfToken || '',
        },
      });
      
      setIsAuthenticated(false);
      window.location.href = '/';
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-bg/90 backdrop-blur-xl border-b border-border">
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link href="/" className="text-2xl font-bold text-text hover:text-accent2 transition-colors">
          <Image src="/images/lobster-logo.png" alt="ClawdMarket" width={40} height={28} className="inline-block mr-2 align-middle object-contain" /> Clawd<span className="text-accent2">Market</span>
        </Link>
        
        <div className="hidden md:flex items-center gap-8">
          <Link href="/#how" className="text-text-dim hover:text-text transition-colors text-sm">
            How It Works
          </Link>
          <Link href="/marketplace" className="text-text-dim hover:text-text transition-colors text-sm">
            Marketplace
          </Link>
          <Link href="/#token" className="text-text-dim hover:text-text transition-colors text-sm">
            <img src="/images/bankr-logo.svg" alt="BANKR" className="inline-block w-4 h-4 mr-1" /> BANKR
          </Link>
          <Link href="/#tokenomics" className="text-text-dim hover:text-text transition-colors text-sm">
            Tokenomics
          </Link>
          <Link href="/docs" className="text-text-dim hover:text-text transition-colors text-sm">
            Docs
          </Link>
          
          <button 
            onClick={toggleTheme}
            className="p-2 rounded-lg bg-bg2 border border-border text-lg hover:border-accent transition-colors"
            title="Toggle Light Theme"
          >
            {theme === 'light' ? '🌙' : '☀️'}
          </button>
          
          {!loading && (
            <>
              {isAuthenticated ? (
                <>
                  {walletAddress && (
                    <span className="text-xs font-mono text-green-400 bg-bg2 border border-green-500/30 px-3 py-1 rounded-full">
                      🟢 {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
                    </span>
                  )}
                  <Link href="/dashboard" className="text-text-dim hover:text-text transition-colors text-sm">
                    Dashboard
                  </Link>
                  <button
                    onClick={handleLogout}
                    className="bg-bg2 hover:bg-bg border border-border text-text px-5 py-2 rounded-lg font-semibold text-sm transition-all"
                  >
                    Logout
                  </button>
                </>
              ) : (
                <>
                  <Link href="/auth/login" className="text-text-dim hover:text-text transition-colors text-sm">
                    Login
                  </Link>
                  <Link
                    href="/auth/register"
                    className="bg-accent hover:bg-[#6d28d9] text-white px-5 py-2 rounded-lg font-semibold text-sm transition-all"
                  >
                    Sign Up
                  </Link>
                </>
              )}
            </>
          )}
        </div>

        <button 
          className="md:hidden text-text text-2xl"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label="Menu"
        >
          ☰
        </button>
      </div>

      {mobileMenuOpen && (
        <div className="md:hidden bg-bg2 border-t border-border animate-slide-down">
          <div className="flex flex-col p-4 gap-3">
            <Link href="/#how" className="text-text-dim hover:text-text transition-colors py-2">
              How It Works
            </Link>
            <Link href="/marketplace" className="text-text-dim hover:text-text transition-colors py-2">
              Marketplace
            </Link>
            <Link href="/#token" className="text-text-dim hover:text-text transition-colors py-2">
              <img src="/images/bankr-logo.svg" alt="BANKR" className="inline-block w-4 h-4 mr-1" /> BANKR
            </Link>
            <Link href="/#tokenomics" className="text-text-dim hover:text-text transition-colors py-2">
              Tokenomics
            </Link>
            <Link href="/docs" className="text-text-dim hover:text-text transition-colors py-2">
              Docs
            </Link>

            <button 
              onClick={toggleTheme}
              className="p-2 rounded-lg bg-bg2 border border-border text-lg hover:border-accent transition-colors w-full text-center"
              title="Toggle Light Theme"
            >
              {theme === 'light' ? '🌙 Dark Site' : '☀️ Light Site'}
            </button>
            
            {!loading && (
              <>
                {isAuthenticated ? (
                  <>
                    {walletAddress && (
                      <div className="text-xs font-mono text-green-400 bg-bg border border-green-500/30 px-3 py-2 rounded-lg">
                        🟢 {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
                      </div>
                    )}
                    <Link href="/dashboard" className="text-text-dim hover:text-text transition-colors py-2">
                      Dashboard
                    </Link>
                    <button
                      onClick={handleLogout}
                      className="bg-bg2 hover:bg-bg border border-border text-text px-5 py-2 rounded-lg font-semibold text-center transition-all"
                    >
                      Logout
                    </button>
                  </>
                ) : (
                  <>
                    <Link href="/auth/login" className="text-text-dim hover:text-text transition-colors py-2">
                      Login
                    </Link>
                    <Link
                      href="/auth/register"
                      className="bg-accent hover:bg-[#6d28d9] text-white px-5 py-2 rounded-lg font-semibold text-center transition-all"
                    >
                      Sign Up
                    </Link>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
