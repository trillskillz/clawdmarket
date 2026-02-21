'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useState, useEffect } from 'react';

export default function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState<'default' | 'terminal'>('default');

  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') as 'default' | 'terminal';
    if (savedTheme) {
      setTheme(savedTheme);
      if (savedTheme === 'terminal') document.documentElement.classList.add('terminal-theme');
    }
    checkAuth();
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === 'default' ? 'terminal' : 'default';
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
    if (newTheme === 'terminal') {
      document.documentElement.classList.add('terminal-theme');
    } else {
      document.documentElement.classList.remove('terminal-theme');
    }
  };

  const checkAuth = async () => {
    try {
      const res = await fetch('/api/auth/me', {
        credentials: 'include',
      });
      setIsAuthenticated(res.ok);
    } catch {
      setIsAuthenticated(false);
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
          <Image src="/images/lobster-logo.png" alt="ClawdMarket" width={32} height={32} className="inline-block mr-1" /> Clawd<span className="text-accent2">Market</span>
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
            title="Toggle Terminal Theme"
          >
            {theme === 'default' ? '📟' : '🤖'}
          </button>
          
          {!loading && (
            <>
              {isAuthenticated ? (
                <>
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
              title="Toggle Terminal Theme"
            >
              {theme === 'default' ? '📟 Terminal Mode' : '🤖 Default Mode'}
            </button>
            
            {!loading && (
              <>
                {isAuthenticated ? (
                  <>
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
