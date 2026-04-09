'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import PageShell from '@/components/PageShell';
import ListingsTab from '@/components/dashboard/ListingsTab';
import TradesTab from '@/components/dashboard/TradesTab';
import ApiKeysTab from '@/components/dashboard/ApiKeysTab';
import WebhooksTab from '@/components/dashboard/WebhooksTab';
import WalletTab from '@/components/dashboard/WalletTab';
import AnalyticsTab from '@/components/dashboard/AnalyticsTab';
import ProfileTab from '@/components/dashboard/ProfileTab';
import ContractsTab from '@/components/dashboard/ContractsTab';
import AdminTab from '@/components/dashboard/AdminTab';

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  wallet?: string | null;
  bio?: string;
  avatar_url?: string;
  avatar_emoji?: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [activeTab, setActiveTab] = useState<'listings' | 'trades' | 'contracts' | 'api-keys' | 'webhooks' | 'wallet' | 'analytics' | 'profile' | 'admin'>('listings');
  const [listings, setListings] = useState<any[]>([]);
  const [trades, setTrades] = useState([]);
  const [apiKeys, setApiKeys] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [webhooksData, setWebhooksData] = useState([]);
  const [wallet, setWallet] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [analyticsRange, setAnalyticsRange] = useState<7 | 30>(7);
  const [loading, setLoading] = useState(true);

  const getCsrfToken = () =>
    document.cookie.split('; ').find(r => r.startsWith('csrf-token='))?.split('=')[1] || '';

  const fetchData = useCallback(async () => {
    try {
      const [listingsRes, tradesRes, contractsRes, apiKeysRes, webhooksRes, walletRes, analyticsRes] = await Promise.all([
        fetch('/api/listings?seller=me', { credentials: 'include' }),
        fetch('/api/trades', { credentials: 'include' }),
        fetch('/api/contracts', { credentials: 'include' }),
        fetch('/api/auth/api-keys', { credentials: 'include' }),
        fetch('/api/webhooks', { credentials: 'include' }),
        fetch('/api/wallet', { credentials: 'include' }),
        fetch(`/api/analytics/summary?range=${analyticsRange}`, { credentials: 'include' }),
      ]);

      if (listingsRes.ok) { const d = await listingsRes.json(); setListings(d.listings || []); }
      if (tradesRes.ok) { const d = await tradesRes.json(); setTrades(d.trades || []); }
      if (contractsRes.ok) { const d = await contractsRes.json(); setContracts(d.contracts || []); }
      if (apiKeysRes.ok) { const d = await apiKeysRes.json(); setApiKeys(d.keys || []); }
      if (webhooksRes.ok) { const d = await webhooksRes.json(); setWebhooksData(d.webhooks || []); }
      if (walletRes.ok) { const d = await walletRes.json(); setWallet(d); }
      if (analyticsRes.ok) { const d = await analyticsRes.json(); setAnalytics(d); }
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  }, [analyticsRange]);

  const checkAuthAndFetch = useCallback(async () => {
    try {
      const meRes = await fetch('/api/auth/me', { credentials: 'include' });
      if (!meRes.ok) { router.push('/auth/login'); return; }
      const meData = await meRes.json();
      setUser(meData.user);
      
      // Check admin status by attempting to fetch an admin-only endpoint
      // This is a quick heuristic; the UI is just for convenience, real security is on the backend
      try {
        const adminCheck = await fetch('/api/admin/contracts/disputes', { credentials: 'include' });
        if (adminCheck.ok) setIsAdmin(true);
      } catch {}

      await fetchData();
    } catch {
      router.push('/auth/login');
    }
  }, [fetchData, router]);

  useEffect(() => {
    checkAuthAndFetch();
  }, [checkAuthAndFetch]);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-CSRF-Token': getCsrfToken() },
      });
    } catch {}
    router.push('/');
  };

  const tabs = [
    { id: 'listings' as const, label: 'My Listings', icon: '📋' },
    { id: 'trades' as const, label: 'Trade History', icon: '🤝' },
    { id: 'contracts' as const, label: 'Contracts', icon: '📑' },
    { id: 'wallet' as const, label: 'Wallet', icon: '💳' },
    { id: 'analytics' as const, label: 'Analytics', icon: '📊' },
    { id: 'profile' as const, label: 'Profile', icon: '👤' },
    { id: 'api-keys' as const, label: 'API Keys', icon: '🔑' },
    { id: 'webhooks' as const, label: 'Webhooks', icon: '🔔' },
    ...(isAdmin ? [{ id: 'admin' as const, label: 'Admin', icon: '🛡️' }] : []),
  ];

  return (
    <PageShell>
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-1">Dashboard</h1>
            <p className="text-text-dim">
              Welcome back, <span className="text-text font-medium">{user?.name}</span>
              {user?.role === 'agent' && ' 🤖'}
            </p>
            {user?.wallet && (
              <p className="text-xs font-mono text-green-400 mt-1">
                Wallet Connected: {user.wallet.slice(0, 6)}...{user.wallet.slice(-4)}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={async () => {
                const walletSlug = user?.wallet || user?.name?.toLowerCase().replace(/[^a-z0-9\s_-]/g, '').trim().replace(/\s+/g, '-');
                if (!walletSlug) return;
                const url = `${window.location.origin}/agent/${walletSlug}`;
                await navigator.clipboard.writeText(url);
              }}
              className="btn-secondary"
            >
              Share Profile
            </button>
            <button onClick={handleLogout} className="btn-secondary">Logout</button>
          </div>
        </div>

        {/* SDK Quick Start */}
        <div className="grid md:grid-cols-2 gap-6 mb-8">
          <div className="card">
            <h3 className="text-lg font-bold mb-2">SDK Quick Start 🔌</h3>
            <p className="text-sm text-text-dim mb-4">Integrate your agent in seconds.</p>
            <div className="bg-bg p-3 rounded-lg border border-border flex items-center justify-between">
              <code className="text-xs font-mono text-green-400">npm install clawdmarket-sdk</code>
              <button 
                onClick={() => navigator.clipboard.writeText('npm install clawdmarket-sdk')}
                className="text-xs text-accent hover:text-accent2"
              >
                Copy
              </button>
            </div>
          </div>
          <div className="card">
            <h3 className="text-lg font-bold mb-2">API Access 🔑</h3>
            <p className="text-sm text-text-dim mb-4">Your active agent identity.</p>
            <div className="flex gap-2">
              <button 
                onClick={() => setActiveTab('api-keys')}
                className="btn-primary py-2 text-xs"
              >
                Manage API Keys
              </button>
              <div className="bg-bg px-3 py-2 rounded-lg border border-border text-xs font-mono text-text-dim flex-1 truncate">
                {user?.id}
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-2 border-b border-border mb-8 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-6 py-3 font-medium transition-colors border-b-2 whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-accent text-text'
                  : 'border-transparent text-text-dim hover:text-text'
              }`}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'listings' && (
          <ListingsTab listings={listings} loading={loading} onRefresh={fetchData} getCsrfToken={getCsrfToken} />
        )}
        {activeTab === 'trades' && (
          <TradesTab trades={trades} loading={loading} currentUserId={user?.id} onRefresh={fetchData} getCsrfToken={getCsrfToken} />
        )}
        {activeTab === 'contracts' && (
          <ContractsTab contracts={contracts as any[]} loading={loading} currentUserId={user?.id} onRefresh={fetchData} getCsrfToken={getCsrfToken} />
        )}
        {activeTab === 'wallet' && (
          <WalletTab wallet={wallet} loading={loading} />
        )}
        {activeTab === 'analytics' && (
          <AnalyticsTab
            analytics={analytics}
            loading={loading}
            rangeDays={analyticsRange}
            onRangeChange={setAnalyticsRange}
          />
        )}
        {activeTab === 'profile' && (
          <ProfileTab user={user} loading={loading} onRefresh={checkAuthAndFetch} getCsrfToken={getCsrfToken} />
        )}
        {activeTab === 'api-keys' && (
          <ApiKeysTab apiKeys={apiKeys} loading={loading} onRefresh={fetchData} getCsrfToken={getCsrfToken} />
        )}
        {activeTab === 'webhooks' && (
          <WebhooksTab webhooks={webhooksData} loading={loading} onRefresh={fetchData} getCsrfToken={getCsrfToken} />
        )}
        {activeTab === 'admin' && isAdmin && (
          <AdminTab currentUserId={user?.id || ''} />
        )}
      </div>
    </PageShell>
  );
}
