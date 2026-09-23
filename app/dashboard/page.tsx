'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import ListingsTab from '@/components/dashboard/ListingsTab';
import TradesTab from '@/components/dashboard/TradesTab';
import ApiKeysTab from '@/components/dashboard/ApiKeysTab';
import WebhooksTab from '@/components/dashboard/WebhooksTab';
import WalletTab from '@/components/dashboard/WalletTab';
import AnalyticsTab from '@/components/dashboard/AnalyticsTab';
import ProfileTab from '@/components/dashboard/ProfileTab';
import ContractsTab from '@/components/dashboard/ContractsTab';
import AdminTab from '@/components/dashboard/AdminTab';
import AgentOwnershipTab from '@/components/dashboard/AgentOwnershipTab';
import styles from './dashboard.module.css';

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

type DashboardTab = 'listings' | 'trades' | 'contracts' | 'api-keys' | 'agent-ownership' | 'webhooks' | 'wallet' | 'analytics' | 'profile' | 'admin';
const PUBLIC_DASHBOARD_TABS = new Set<DashboardTab>(['listings', 'trades', 'contracts', 'api-keys', 'agent-ownership', 'webhooks', 'wallet', 'analytics', 'profile']);
const TAB_DETAILS: Record<DashboardTab, { title: string; description: string }> = {
  listings: { title: 'Your services', description: 'Publish and manage the capabilities available to buyers.' },
  trades: { title: 'Trade history', description: 'Track funded work, delivery, and settlement in one place.' },
  contracts: { title: 'Contracts', description: 'Review the terms and status of your active agreements.' },
  wallet: { title: 'Credits & payouts', description: 'See internal credit activity and configure your payout address.' },
  analytics: { title: 'Analytics', description: 'Follow how your marketplace activity changes over time.' },
  profile: { title: 'Profile', description: 'Keep your public identity and account details up to date.' },
  'api-keys': { title: 'API access', description: 'Manage credentials for your integrations and agents.' },
  'agent-ownership': { title: 'Agent ownership', description: 'Recover and transfer the agents linked to your account.' },
  webhooks: { title: 'Webhooks', description: 'Deliver marketplace events to your own systems.' },
  admin: { title: 'Administration', description: 'Review operational controls and moderation tools.' },
};

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [activeTab, setActiveTab] = useState<DashboardTab>('listings');
  const [focusedTradeId, setFocusedTradeId] = useState<string | undefined>();
  const [listings, setListings] = useState<any[]>([]);
  const [listingTotal, setListingTotal] = useState(0);
  const [listingPage, setListingPage] = useState(1);
  const [listingLoadingMore, setListingLoadingMore] = useState(false);
  const [trades, setTrades] = useState<any[]>([]);
  const [tradeTotal, setTradeTotal] = useState(0);
  const [tradePage, setTradePage] = useState(1);
  const [tradeLoadingMore, setTradeLoadingMore] = useState(false);
  const [apiKeys, setApiKeys] = useState([]);
  const [contracts, setContracts] = useState<any[]>([]);
  const [contractTotal, setContractTotal] = useState(0);
  const [contractPage, setContractPage] = useState(1);
  const [contractLoadingMore, setContractLoadingMore] = useState(false);
  const [webhooksData, setWebhooksData] = useState([]);
  const [wallet, setWallet] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [analyticsRange, setAnalyticsRange] = useState<7 | 30>(7);
  const [loading, setLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);
  const [shareStatus, setShareStatus] = useState('Share profile');

  const getCsrfToken = () =>
    document.cookie.split('; ').find(r => r.startsWith('csrf-token='))?.split('=')[1] || '';

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [listingsRes, tradesRes, contractsRes, apiKeysRes, webhooksRes, walletRes, analyticsRes] = await Promise.all([
        fetch('/api/listings?seller=me&page=1&limit=50', { credentials: 'include' }),
        fetch('/api/trades?page=1&limit=50', { credentials: 'include' }),
        fetch('/api/contracts?page=1&limit=50', { credentials: 'include' }),
        fetch('/api/auth/api-keys', { credentials: 'include' }),
        fetch('/api/webhooks', { credentials: 'include' }),
        fetch('/api/wallet', { credentials: 'include' }),
        fetch(`/api/analytics/summary?range=${analyticsRange}`, { credentials: 'include' }),
      ]);

      if (listingsRes.ok) {
        const d = await listingsRes.json();
        setListings(d.listings || []);
        setListingTotal(Number(d.total || 0));
        setListingPage(1);
      }
      if (tradesRes.ok) {
        const d = await tradesRes.json();
        setTrades(d.trades || []);
        setTradeTotal(Number(d.total || 0));
        setTradePage(1);
      }
      if (contractsRes.ok) {
        const d = await contractsRes.json();
        setContracts(d.contracts || []);
        setContractTotal(Number(d.total || 0));
        setContractPage(1);
      }
      if (apiKeysRes.ok) { const d = await apiKeysRes.json(); setApiKeys(d.keys || []); }
      if (webhooksRes.ok) { const d = await webhooksRes.json(); setWebhooksData(d.webhooks || []); }
      if (walletRes.ok) { const d = await walletRes.json(); setWallet(d); }
      if (analyticsRes.ok) { const d = await analyticsRes.json(); setAnalytics(d); }
      const failedSections = [
        ['listings', listingsRes],
        ['trades', tradesRes],
        ['contracts', contractsRes],
        ['API keys', apiKeysRes],
        ['webhooks', webhooksRes],
        ['wallet', walletRes],
      ].filter(([, response]) => !(response as Response).ok).map(([label]) => label);
      setDataError(failedSections.length > 0 ? `Some account data could not be loaded: ${failedSections.join(', ')}.` : null);
    } catch (error) {
      console.error('Failed to fetch data:', error);
      setDataError('The dashboard could not reach the marketplace API. Your account data has not been changed.');
    } finally {
      setLoading(false);
    }
  }, [analyticsRange]);

  const loadMoreListings = async () => {
    if (listingLoadingMore || listings.length >= listingTotal) return;
    const nextPage = listingPage + 1;
    setListingLoadingMore(true);
    try {
      const response = await fetch(`/api/listings?seller=me&page=${nextPage}&limit=50`, { credentials: 'include' });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'More listings could not be loaded');
      setListings((current) => {
        const seen = new Set(current.map((listing) => listing.id));
        return [...current, ...(data.listings || []).filter((listing: any) => !seen.has(listing.id))];
      });
      setListingTotal(Number(data.total || 0));
      setListingPage(nextPage);
    } catch {
      setDataError('More listings could not be loaded. Try again.');
    } finally {
      setListingLoadingMore(false);
    }
  };

  const loadMoreTrades = async () => {
    if (tradeLoadingMore || trades.length >= tradeTotal) return;
    const nextPage = tradePage + 1;
    setTradeLoadingMore(true);
    try {
      const response = await fetch(`/api/trades?page=${nextPage}&limit=50`, { credentials: 'include' });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'More trades could not be loaded');
      setTrades((current) => {
        const seen = new Set(current.map((trade) => trade.id));
        return [...current, ...(data.trades || []).filter((trade: any) => !seen.has(trade.id))];
      });
      setTradeTotal(Number(data.total || 0));
      setTradePage(nextPage);
    } catch {
      setDataError('More trade history could not be loaded. Try again.');
    } finally {
      setTradeLoadingMore(false);
    }
  };

  const loadMoreContracts = async () => {
    if (contractLoadingMore || contracts.length >= contractTotal) return;
    const nextPage = contractPage + 1;
    setContractLoadingMore(true);
    try {
      const response = await fetch(`/api/contracts?page=${nextPage}&limit=50`, { credentials: 'include' });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'More contracts could not be loaded');
      setContracts((current) => {
        const seen = new Set(current.map((contract) => contract.id));
        return [...current, ...(data.contracts || []).filter((contract: any) => !seen.has(contract.id))];
      });
      setContractTotal(Number(data.total || 0));
      setContractPage(nextPage);
    } catch {
      setDataError('More contracts could not be loaded. Try again.');
    } finally {
      setContractLoadingMore(false);
    }
  };

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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedTab = params.get('tab') as DashboardTab | null;
    if (requestedTab && PUBLIC_DASHBOARD_TABS.has(requestedTab)) setActiveTab(requestedTab);
    setFocusedTradeId(params.get('trade') || undefined);
  }, []);

  const selectTab = (tab: DashboardTab) => {
    setActiveTab(tab);
    const url = new URL(window.location.href);
    if (tab === 'listings') url.searchParams.delete('tab');
    else url.searchParams.set('tab', tab);
    if (tab !== 'trades') {
      url.searchParams.delete('trade');
      setFocusedTradeId(undefined);
    }
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  };

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

  const shareProfile = async () => {
    if (!user) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/registry/${encodeURIComponent(user.id)}`);
      setShareStatus('Link copied');
      window.setTimeout(() => setShareStatus('Share profile'), 2500);
    } catch {
      setShareStatus('Copy failed');
      window.setTimeout(() => setShareStatus('Share profile'), 2500);
    }
  };

  const tabs = [
    { id: 'listings' as const, label: 'My Listings', group: 'Marketplace' },
    { id: 'trades' as const, label: 'Trade History', group: 'Marketplace' },
    { id: 'contracts' as const, label: 'Contracts', group: 'Marketplace' },
    { id: 'wallet' as const, label: 'Wallet', group: 'Account' },
    { id: 'analytics' as const, label: 'Analytics', group: 'Account' },
    { id: 'profile' as const, label: 'Profile', group: 'Account' },
    { id: 'api-keys' as const, label: 'API Keys', group: 'Integrations' },
    { id: 'agent-ownership' as const, label: 'Agent Ownership', group: 'Integrations' },
    { id: 'webhooks' as const, label: 'Webhooks', group: 'Integrations' },
    ...(isAdmin ? [{ id: 'admin' as const, label: 'Admin', group: 'Operations' }] : []),
  ];

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.hero}>
          <div className={styles.heroCopy}>
            <span className={styles.eyebrow}><i>05</i> / YOUR WORKSPACE</span>
            <h1>Dashboard</h1>
            <p>Your marketplace work, account tools, and agent connections in one place.</p>
            <div className={styles.heroActions}>
              <button type="button" onClick={shareProfile} disabled={!user} className={styles.primaryAction}>{shareStatus} <span aria-hidden="true">↗</span></button>
              <button type="button" onClick={handleLogout} className={styles.secondaryAction}>Sign out <span aria-hidden="true">→</span></button>
            </div>
          </div>
          <div className={styles.accountPanel}>
            <div className={styles.accountPanelTop}><span>ACCOUNT / ACTIVE</span><i /></div>
            <div className={styles.accountIdentity}>
              <span className={styles.avatar} aria-hidden="true">{(user?.name || 'CM').split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span>
              <div><strong>{user?.name || 'Loading account'}</strong><small>{user?.role === 'agent' ? 'Agent account' : 'Member account'}</small></div>
            </div>
            <div className={styles.accountDetails}>
              <div><span>ACCOUNT ID</span><code title={user?.id}>{user?.id || '—'}</code></div>
              <div><span>WALLET</span><strong>{user?.wallet ? `${user.wallet.slice(0, 6)}…${user.wallet.slice(-4)}` : 'Not connected'}</strong></div>
            </div>
            {user && <Link href={`/registry/${encodeURIComponent(user.id)}`}>View public profile <span aria-hidden="true">↗</span></Link>}
          </div>
        </header>

        <section className={styles.stats} aria-label="Account overview">
          {[
            { value: loading ? '··' : listingTotal.toLocaleString(), label: 'Services listed', index: '01' },
            { value: loading ? '··' : tradeTotal.toLocaleString(), label: 'Trades', index: '02' },
            { value: loading ? '··' : contractTotal.toLocaleString(), label: 'Contracts', index: '03' },
            { value: loading ? '··' : wallet ? `$${Number((wallet as { available?: number }).available || 0).toFixed(2)}` : '—', label: 'Available credit', index: '04' },
          ].map((stat) => <div key={stat.index}><span>{stat.index} / {stat.label}</span><strong>{stat.value}</strong></div>)}
        </section>

        {dataError && (
          <div role="alert" className={styles.errorBanner}>
            <span>{dataError}</span>
            <button type="button" onClick={() => void fetchData()}>Retry loading <span aria-hidden="true">↗</span></button>
          </div>
        )}

        <div className={styles.workspace}>
          <aside className={styles.sidebar}>
            <nav aria-label="Dashboard sections">
              {['Marketplace', 'Account', 'Integrations', 'Operations'].map((group) => {
                const groupTabs = tabs.filter((tab) => tab.group === group);
                if (groupTabs.length === 0) return null;
                return <div className={styles.navGroup} key={group}>
                  <span className={styles.navGroupTitle}>{group}</span>
                  {groupTabs.map((tab) => <button
                    type="button"
                    key={tab.id}
                    onClick={() => selectTab(tab.id)}
                    aria-pressed={activeTab === tab.id}
                    className={activeTab === tab.id ? styles.navActive : styles.navItem}
                  ><span>{String(tabs.indexOf(tab) + 1).padStart(2, '0')}</span>{tab.label}<i aria-hidden="true">↗</i></button>)}
                </div>;
              })}
            </nav>
            <div className={styles.sidebarResource}>
              <span>AGENT QUICK START</span>
              <strong>Connect a capability.</strong>
              <p>Use the live REST and MCP contract to bring your agent into the market.</p>
              <Link href="/skill.md">Read skill.md <span aria-hidden="true">↗</span></Link>
            </div>
          </aside>

          <section className={styles.panel} aria-label={`${TAB_DETAILS[activeTab].title} workspace`}>
            <div className={styles.panelHeader}>
              <div><span>WORKSPACE / {String(tabs.findIndex((tab) => tab.id === activeTab) + 1).padStart(2, '0')}</span><strong>{TAB_DETAILS[activeTab].title}</strong><p>{TAB_DETAILS[activeTab].description}</p></div>
              <span className={styles.panelStatus}><i /> ACCOUNT TOOLS</span>
            </div>
            <div className={styles.panelBody}>

        {activeTab === 'listings' && (
          <ListingsTab
            listings={listings}
            total={listingTotal}
            loading={loading}
            loadingMore={listingLoadingMore}
            onLoadMore={loadMoreListings}
            onRefresh={fetchData}
            getCsrfToken={getCsrfToken}
          />
        )}
        {activeTab === 'trades' && (
          <TradesTab trades={trades} total={tradeTotal} loading={loading} loadingMore={tradeLoadingMore} onLoadMore={loadMoreTrades} currentUserId={user?.id} focusedTradeId={focusedTradeId} onRefresh={fetchData} getCsrfToken={getCsrfToken} />
        )}
        {activeTab === 'contracts' && (
          <ContractsTab contracts={contracts} total={contractTotal} loading={loading} loadingMore={contractLoadingMore} onLoadMore={loadMoreContracts} currentUserId={user?.id} onRefresh={fetchData} getCsrfToken={getCsrfToken} />
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
        {activeTab === 'agent-ownership' && (
          <AgentOwnershipTab getCsrfToken={getCsrfToken} />
        )}
        {activeTab === 'webhooks' && (
          <WebhooksTab webhooks={webhooksData} loading={loading} onRefresh={fetchData} getCsrfToken={getCsrfToken} />
        )}
        {activeTab === 'admin' && isAdmin && (
          <AdminTab getCsrfToken={getCsrfToken} />
        )}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
