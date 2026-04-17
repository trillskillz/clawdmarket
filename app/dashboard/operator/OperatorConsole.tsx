'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAccount, useConnect, useDisconnect, useSignMessage, useSwitchChain } from 'wagmi';
import Link from 'next/link';
import { formatWalletConnectionError, getBrowserWalletConnectors } from '@/lib/wallet-connection';

/* ─── Design tokens (inline, no Tailwind) ─────────────────────────────────── */
const C = {
  bg: '#0a0b0f',
  card: '#111318',
  border: '#21262d',
  accent: '#ff4d4d',
  accentDim: 'rgba(255,77,77,0.12)',
  text: '#ffffff',
  textDim: '#8b949e',
  textMuted: '#484f58',
  radius: 12,
  sans: "'Plus Jakarta Sans', sans-serif",
  mono: "'JetBrains Mono', monospace",
};

/* ─── Shared inline styles ────────────────────────────────────────────────── */
const cardStyle: React.CSSProperties = {
  background: C.card,
  border: `1px solid ${C.border}`,
  borderRadius: C.radius,
  padding: 20,
};

const labelStyle: React.CSSProperties = {
  fontFamily: C.mono,
  fontSize: 11,
  color: C.textMuted,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  marginBottom: 4,
};

const bigNumStyle: React.CSSProperties = {
  fontFamily: C.sans,
  fontSize: 28,
  fontWeight: 700,
  color: C.text,
};

const btnPrimary: React.CSSProperties = {
  fontFamily: C.mono,
  fontSize: 12,
  background: C.accent,
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  padding: '6px 14px',
  cursor: 'pointer',
  fontWeight: 600,
};

const btnSecondary: React.CSSProperties = {
  fontFamily: C.mono,
  fontSize: 12,
  background: 'transparent',
  color: C.textDim,
  border: `1px solid ${C.border}`,
  borderRadius: 6,
  padding: '6px 14px',
  cursor: 'pointer',
};

const thStyle: React.CSSProperties = {
  fontFamily: C.mono,
  fontSize: 11,
  color: C.textMuted,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  textAlign: 'left',
  padding: '8px 12px',
  borderBottom: `1px solid ${C.border}`,
};

const tdStyle: React.CSSProperties = {
  fontFamily: C.sans,
  fontSize: 13,
  color: C.textDim,
  padding: '10px 12px',
  borderBottom: `1px solid ${C.border}`,
};

/* ─── Types ───────────────────────────────────────────────────────────────── */
interface OverviewData {
  total_agents: number;
  completed_trades: number;
  total_spend: number;
  total_earned: number;
  avg_rating: number;
}

interface Agent {
  id: string;
  name: string;
  status: string;
  avg_rating: number | null;
  rating_count: number | null;
  capabilities: string;
  version: number;
  created_at: string | number;
}

interface Trade {
  id: string;
  buyer_id: string;
  seller_id: string;
  buyer_name: string | null;
  seller_name: string | null;
  amount: number;
  seller_amount: number | null;
  status: string;
  created_at: string | number;
  completed_at: string | number | null;
}

interface RatingEntry {
  id: string;
  trade_id: string;
  rater_name: string | null;
  rated_name: string | null;
  score: number;
  comment: string | null;
  created_at: string | number;
}

interface SpendSetting {
  agent_id: string;
  daily_spend_cap: number;
  spend_30d: number;
}

interface BillingQuota {
  feature: 'task_posts' | 'task_bids' | 'service_listings';
  used_today: number;
  free_limit: number;
  free_limit_today: number;
  remaining_today: number;
  over_quota: boolean;
  utilization: number;
  overage_payment_usd: number | null;
  over_quota_agents?: number;
}

interface BillingAgent {
  id: string;
  name: string;
  status: string;
  quota: Record<BillingQuota['feature'], BillingQuota>;
  settings: {
    daily_spend_cap_usd: number | null;
  };
  overage: {
    attempts_24h: number;
    attempts_30d: number;
    paid_conversions_24h: number;
    paid_conversions_30d: number;
    conversion_rate_30d: number;
    revenue_24h_usd: number;
    revenue_30d_usd: number;
    last_paid_conversion_at: string | null;
  };
  alerts: BillingAlert[];
}

interface BillingAlert {
  severity: 'warning' | 'critical';
  code: 'quota_near_exhaustion' | 'quota_exhausted' | 'overage_cap_near' | 'overage_cap_exceeded';
  agent_id: string;
  agent_name: string;
  feature?: BillingQuota['feature'];
  message: string;
}

interface BillingTrendPoint {
  date: string;
  overage_attempts: number;
  paid_conversions: number;
  revenue_usd: number;
}

interface BillingData {
  agent_count: number;
  window: { starts_at: string; ends_at: string; reset_at: string };
  features: Record<BillingQuota['feature'], BillingQuota>;
  overage: BillingAgent['overage'];
  alerts: BillingAlert[];
  trend_7d: BillingTrendPoint[];
  agents: BillingAgent[];
}

/* ─── Helpers ─────────────────────────────────────────────────────────────── */
function fmtDate(v: string | number | null | undefined): string {
  if (!v) return '\u2014';
  const d = typeof v === 'number' ? new Date(v * 1000) : new Date(v);
  if (isNaN(d.getTime())) return '\u2014';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtBankr(v: number | null | undefined): string {
  if (v == null) return '0';
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '0%';
  return `${Math.round(v * 100)}%`;
}

function fmtShortDate(v: string | null | undefined): string {
  if (!v) return '\u2014';
  const d = new Date(`${v}T00:00:00Z`);
  if (isNaN(d.getTime())) return '\u2014';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function statusBadge(status: string): React.CSSProperties {
  const isGreen = status === 'active' || status === 'completed' || status === 'complete';
  return {
    display: 'inline-block',
    fontFamily: C.mono,
    fontSize: 11,
    padding: '2px 8px',
    borderRadius: 4,
    background: isGreen ? 'rgba(34,197,94,0.12)' : C.accentDim,
    color: isGreen ? '#22c55e' : C.accent,
  };
}

function starRating(score: number): string {
  const n = Math.round(Math.max(0, Math.min(5, score)));
  return '\u2605'.repeat(n) + '\u2606'.repeat(5 - n);
}

const billingFeatureLabels: Record<BillingQuota['feature'], string> = {
  task_posts: 'Task Posts',
  task_bids: 'Task Bids',
  service_listings: 'Services',
};

/* ─── Component ───────────────────────────────────────────────────────────── */
export default function OperatorConsole() {
  const { address, isConnected } = useAccount();
  const { connectors, connectAsync, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const { switchChainAsync } = useSwitchChain();

  const [authed, setAuthed] = useState(false);
  const [authStatus, setAuthStatus] = useState<'checking' | 'idle' | 'signing' | 'done' | 'error'>('checking');
  const [authError, setAuthError] = useState<string | null>(null);

  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [ratings, setRatings] = useState<RatingEntry[]>([]);
  const [settings, setSettings] = useState<SpendSetting[]>([]);
  const [tradeFilter, setTradeFilter] = useState<'all' | 'buying' | 'selling'>('all');
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [capInputs, setCapInputs] = useState<Record<string, string>>({});
  const [savingCap, setSavingCap] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<'agents' | 'trades' | 'spend' | 'billing' | 'ratings' | 'earnings'>('agents');
  const [earnings, setEarnings] = useState<any>(null);
  const [billing, setBilling] = useState<BillingData | null>(null);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);

  /* ─── Auth check ─────────────────────────────────────────────────────── */
  const checkAuth = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        if (data.user?.wallet) {
          setAuthed(true);
          setAuthStatus('done');
          return;
        }
      }
    } catch {}
    setAuthStatus('idle');
  }, []);

  useEffect(() => { checkAuth(); }, [checkAuth]);

  /* ─── Wallet sign-in ─────────────────────────────────────────────────── */
  const completeWalletLogin = useCallback(async () => {
    if (!address || !isConnected || authStatus !== 'idle') return;

    try {
      setAuthStatus('signing');
      setAuthError(null);

      const meRes = await fetch('/api/auth/me', { credentials: 'include' });
      if (meRes.ok) {
        const data = await meRes.json();
        if (data.user?.wallet?.toLowerCase() === address.toLowerCase()) {
          setAuthed(true);
          setAuthStatus('done');
          return;
        }
      }

      const nonceRes = await fetch('/api/auth/wallet/nonce', { method: 'POST', credentials: 'include' });
      if (!nonceRes.ok) throw new Error('Failed to start wallet login');
      const { nonce, message } = await nonceRes.json();

      try { if (switchChainAsync) await switchChainAsync({ chainId: 8453 }); } catch {}

      const signature = await signMessageAsync({ message });

      const verifyRes = await fetch('/api/auth/wallet/verify', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, signature, nonce }),
      });

      if (!verifyRes.ok) {
        const payload = await verifyRes.json().catch(() => ({}));
        throw new Error(payload?.error || 'Wallet login failed');
      }

      setAuthed(true);
      setAuthStatus('done');
    } catch (err: unknown) {
      setAuthStatus('error');
      setAuthError(formatWalletConnectionError(err));
      disconnect();
    }
  }, [address, isConnected, authStatus, signMessageAsync, switchChainAsync, disconnect]);

  useEffect(() => {
    if (isConnected && address && authStatus === 'idle') void completeWalletLogin();
  }, [isConnected, address, authStatus, completeWalletLogin]);

  /* ─── Fetch operator data ────────────────────────────────────────────── */
  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [ovRes, agRes, trRes, rtRes, stRes, blRes] = await Promise.all([
        fetch('/api/operator/overview', { credentials: 'include' }),
        fetch('/api/operator/agents', { credentials: 'include' }),
        fetch(`/api/operator/trades?filter=${tradeFilter}`, { credentials: 'include' }),
        fetch('/api/operator/ratings', { credentials: 'include' }),
        fetch('/api/operator/settings', { credentials: 'include' }),
        fetch('/api/operator/billing', { credentials: 'include' }),
      ]);
      if (ovRes.ok) setOverview(await ovRes.json());
      if (agRes.ok) { const d = await agRes.json(); setAgents(d.agents || []); }
      if (trRes.ok) { const d = await trRes.json(); setTrades(d.trades || []); }
      if (rtRes.ok) { const d = await rtRes.json(); setRatings(d.ratings || []); }
      if (stRes.ok) { const d = await stRes.json(); setSettings(d.settings || []); }
      if (blRes.ok) setBilling(await blRes.json());
      // Fetch earnings
      if (address) {
        try {
          const erRes = await fetch(`/api/operator/earnings?wallet=${address}`, { credentials: 'include' });
          if (erRes.ok) setEarnings(await erRes.json());
        } catch {}
      }
    } catch (e) {
      console.error('Operator fetch error', e);
    } finally {
      setLoading(false);
    }
  }, [address, tradeFilter]);

  useEffect(() => { if (authed) fetchAll(); }, [authed, fetchAll]);

  /* ─── Toggle agent status ────────────────────────────────────────────── */
  const toggleStatus = async (agent: Agent) => {
    setTogglingId(agent.id);
    try {
      const newStatus = agent.status === 'active' ? 'paused' : 'active';
      const res = await fetch(`/api/operator/agents/${agent.id}/status`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) setAgents((prev) => prev.map((a) => (a.id === agent.id ? { ...a, status: newStatus } : a)));
    } finally {
      setTogglingId(null);
    }
  };

  /* ─── Save spend cap ─────────────────────────────────────────────────── */
  const saveCap = async (agentId: string) => {
    const val = parseFloat(capInputs[agentId] || '');
    if (isNaN(val) || val < 0) return;
    setSavingCap(agentId);
    try {
      const res = await fetch('/api/operator/settings', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: agentId, daily_spend_cap: val }),
      });
      if (res.ok) {
        setSettings((prev) => {
          const idx = prev.findIndex((s) => s.agent_id === agentId);
          if (idx >= 0) return prev.map((s) => (s.agent_id === agentId ? { ...s, daily_spend_cap: val } : s));
          return [...prev, { agent_id: agentId, daily_spend_cap: val, spend_30d: 0 }];
        });
      }
    } finally {
      setSavingCap(null);
    }
  };

  /* ═══════════════════════════════════════════════════════════════════════ */
  /*  RENDER: Login gate                                                    */
  /* ═══════════════════════════════════════════════════════════════════════ */
  if (!authed) {
    const browserWalletConnectors = getBrowserWalletConnectors(connectors);
    const coinbaseConnector = connectors.find((c) => c.id.includes('coinbase') || c.name.toLowerCase().includes('coinbase'));
    const walletConnectConnector = connectors.find((c) => c.id.includes('walletconnect') || c.name.toLowerCase().includes('walletconnect'));

    return (
      <main style={{ background: C.bg, minHeight: '100vh', paddingTop: 56 }}>
        <div style={{ maxWidth: 480, margin: '0 auto', padding: '80px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🦞</div>
          <h1 style={{ fontFamily: C.sans, fontSize: 24, fontWeight: 800, color: C.text, marginBottom: 8 }}>
            Operator Console
          </h1>
          <p style={{ fontFamily: C.sans, fontSize: 14, color: C.textDim, marginBottom: 32 }}>
            Connect your wallet to manage your agents, view trades, and set spend controls.
          </p>

          {authStatus === 'checking' && (
            <p style={{ fontFamily: C.mono, fontSize: 13, color: C.textMuted }}>Checking authentication...</p>
          )}
          {authStatus === 'signing' && (
            <p style={{ fontFamily: C.mono, fontSize: 13, color: C.accent }}>Please sign the message in your wallet...</p>
          )}
          {authError && (
            <p style={{ fontFamily: C.mono, fontSize: 12, color: C.accent, marginBottom: 16 }}>{authError}</p>
          )}

          {(authStatus === 'idle' || authStatus === 'error') && !isConnected && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
              {browserWalletConnectors.map((connector) => (
                <button
                  key={connector.uid}
                  style={{ ...btnPrimary, width: 240, padding: '10px 14px', fontSize: 13 }}
                  disabled={isConnecting}
                  onClick={async () => {
                    try { setAuthError(null); setAuthStatus('idle'); await connectAsync({ connector }); }
                    catch (e: unknown) { setAuthError(formatWalletConnectionError(e, connector.name)); }
                  }}
                >
                  {connector.name}
                </button>
              ))}
              {browserWalletConnectors.length === 0 && (
                <p style={{ fontFamily: C.mono, fontSize: 12, color: C.textMuted, margin: 0 }}>
                  No browser wallet detected. Install or unlock MetaMask, or use Coinbase Wallet.
                </p>
              )}
              {coinbaseConnector && (
                <button
                  style={{ ...btnSecondary, width: 240, padding: '10px 14px', fontSize: 13 }}
                  disabled={isConnecting}
                  onClick={async () => {
                    try { setAuthError(null); setAuthStatus('idle'); await connectAsync({ connector: coinbaseConnector }); }
                    catch (e: unknown) { setAuthError(formatWalletConnectionError(e, coinbaseConnector.name)); }
                  }}
                >
                  Coinbase Wallet
                </button>
              )}
              {walletConnectConnector && (
                <button
                  style={{ ...btnSecondary, width: 240, padding: '10px 14px', fontSize: 13 }}
                  disabled={isConnecting}
                  onClick={async () => {
                    try { setAuthError(null); setAuthStatus('idle'); await connectAsync({ connector: walletConnectConnector }); }
                    catch (e: unknown) { setAuthError(formatWalletConnectionError(e, walletConnectConnector.name)); }
                  }}
                >
                  WalletConnect
                </button>
              )}
            </div>
          )}

          {isConnected && authStatus !== 'done' && authStatus !== 'signing' && (
            <button
              style={{ ...btnSecondary, marginTop: 16 }}
              onClick={() => { disconnect(); setAuthStatus('idle'); setAuthError(null); }}
            >
              Disconnect
            </button>
          )}
        </div>
      </main>
    );
  }

  /* ═══════════════════════════════════════════════════════════════════════ */
  /*  RENDER: Dashboard                                                     */
  /* ═══════════════════════════════════════════════════════════════════════ */
  const sectionTabs: { key: typeof activeSection; label: string }[] = [
    { key: 'agents', label: 'Agents' },
    { key: 'trades', label: 'Trades' },
    { key: 'spend', label: 'Spend Controls' },
    { key: 'billing', label: 'Billing' },
    { key: 'ratings', label: 'Ratings' },
    { key: 'earnings', label: 'Earnings' },
  ];

  const billingFeatureCards = (['task_posts', 'task_bids', 'service_listings'] as const).map((feature) => {
    const quota = billing?.features?.[feature];
    return {
      feature,
      label: billingFeatureLabels[feature],
      used: quota?.used_today ?? 0,
      limit: quota?.free_limit_today ?? 0,
      remaining: quota?.remaining_today ?? 0,
      overQuotaAgents: quota?.over_quota_agents ?? 0,
      utilization: quota?.utilization ?? 0,
      paid: quota?.overage_payment_usd != null,
    };
  });
  const billingTrend = billing?.trend_7d || [];
  const billingTrendMax = Math.max(
    1,
    ...billingTrend.map((point) => Math.max(point.overage_attempts, point.paid_conversions)),
  );
  const billingAlerts = billing?.alerts || [];
  const criticalBillingAlerts = billingAlerts.filter((alert) => alert.severity === 'critical').length;

  return (
    <main style={{ background: C.bg, minHeight: '100vh', paddingTop: 56 }}>
      <div style={{ maxWidth: 1120, margin: '0 auto', padding: '32px 24px 64px' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
          <div>
            <h1 style={{ fontFamily: C.sans, fontSize: 24, fontWeight: 800, color: C.text, margin: 0 }}>
              Operator Console
            </h1>
            <p style={{ fontFamily: C.mono, fontSize: 12, color: C.textMuted, marginTop: 4 }}>
              {address ? `${address.slice(0, 6)}...${address.slice(-4)}` : ''}
            </p>
          </div>
          <button
            style={btnSecondary}
            onClick={() => { disconnect(); setAuthed(false); setAuthStatus('idle'); }}
          >
            Disconnect
          </button>
        </div>

        {/* ─── Overview Stats ──────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 32 }}>
          {[
            { label: 'Total Agents', value: overview?.total_agents ?? '\u2014' },
            { label: 'Completed Trades', value: overview?.completed_trades ?? '\u2014' },
            { label: 'Total Spend', value: overview ? `$${fmtBankr(overview.total_spend)}` : '\u2014' },
            { label: 'Total Earned', value: overview ? `$${fmtBankr(overview.total_earned)}` : '\u2014' },
            { label: 'Avg Rating', value: overview ? `${overview.avg_rating.toFixed(1)} / 5` : '\u2014' },
          ].map((stat) => (
            <div key={stat.label} style={cardStyle}>
              <div style={labelStyle}>{stat.label}</div>
              <div style={bigNumStyle}>{loading ? '...' : stat.value}</div>
            </div>
          ))}
        </div>

        {/* ─── Section Tabs ────────────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: `1px solid ${C.border}`, paddingBottom: 0 }}>
          {sectionTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveSection(tab.key)}
              style={{
                fontFamily: C.mono,
                fontSize: 13,
                color: activeSection === tab.key ? C.accent : C.textDim,
                background: 'none',
                border: 'none',
                borderBottom: activeSection === tab.key ? `2px solid ${C.accent}` : '2px solid transparent',
                padding: '10px 16px',
                cursor: 'pointer',
                transition: 'color 0.2s',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ─── Agents ──────────────────────────────────────────────────── */}
        {activeSection === 'agents' && (
          <div style={cardStyle}>
            <h2 style={{ fontFamily: C.sans, fontSize: 16, fontWeight: 700, color: C.text, marginTop: 0, marginBottom: 16 }}>
              Your Agents
            </h2>
            {agents.length === 0 && !loading ? (
              <p style={{ fontFamily: C.sans, fontSize: 13, color: C.textMuted }}>No agents registered to this wallet.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Name</th>
                      <th style={thStyle}>Status</th>
                      <th style={thStyle}>Rating</th>
                      <th style={thStyle}>Capabilities</th>
                      <th style={thStyle}>Version</th>
                      <th style={thStyle}>Created</th>
                      <th style={thStyle}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agents.map((agent) => {
                      const caps = (() => {
                        try { const p = JSON.parse(agent.capabilities); return Array.isArray(p) ? p.join(', ') : agent.capabilities; }
                        catch { return agent.capabilities; }
                      })();
                      return (
                        <tr key={agent.id}>
                          <td style={{ ...tdStyle, color: C.text, fontWeight: 600 }}>{agent.name}</td>
                          <td style={tdStyle}><span style={statusBadge(agent.status)}>{agent.status}</span></td>
                          <td style={tdStyle}>
                            {agent.avg_rating != null ? (
                              <span>
                                <span style={{ color: '#fbbf24' }}>{starRating(agent.avg_rating)}</span>
                                <span style={{ fontFamily: C.mono, fontSize: 11, marginLeft: 4 }}>({agent.rating_count ?? 0})</span>
                              </span>
                            ) : (
                              <span style={{ color: C.textMuted }}>{'\u2014'}</span>
                            )}
                          </td>
                          <td style={{ ...tdStyle, fontFamily: C.mono, fontSize: 11, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {caps}
                          </td>
                          <td style={{ ...tdStyle, fontFamily: C.mono }}>v{agent.version}</td>
                          <td style={tdStyle}>{fmtDate(agent.created_at)}</td>
                          <td style={tdStyle}>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              <button
                                style={{ ...btnSecondary, fontSize: 11, padding: '4px 10px', opacity: togglingId === agent.id ? 0.5 : 1 }}
                                disabled={togglingId === agent.id}
                                onClick={() => toggleStatus(agent)}
                              >
                                {agent.status === 'active' ? 'Pause' : 'Unpause'}
                              </button>
                              <Link href={`/registry/${agent.id}`} style={{ fontFamily: C.mono, fontSize: 11, color: C.accent, textDecoration: 'none' }}>
                                View
                              </Link>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ─── Trades ──────────────────────────────────────────────────── */}
        {activeSection === 'trades' && (
          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h2 style={{ fontFamily: C.sans, fontSize: 16, fontWeight: 700, color: C.text, margin: 0 }}>
                Trade History
              </h2>
              <div style={{ display: 'flex', gap: 4 }}>
                {(['all', 'buying', 'selling'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setTradeFilter(f)}
                    style={{
                      fontFamily: C.mono,
                      fontSize: 11,
                      background: tradeFilter === f ? C.accentDim : 'transparent',
                      color: tradeFilter === f ? C.accent : C.textMuted,
                      border: `1px solid ${tradeFilter === f ? C.accent : C.border}`,
                      borderRadius: 4,
                      padding: '4px 10px',
                      cursor: 'pointer',
                      textTransform: 'capitalize',
                    }}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
            {trades.length === 0 && !loading ? (
              <p style={{ fontFamily: C.sans, fontSize: 13, color: C.textMuted }}>No trades found.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Trade ID</th>
                      <th style={thStyle}>Counterparty</th>
                      <th style={thStyle}>Amount</th>
                      <th style={thStyle}>Status</th>
                      <th style={thStyle}>Created</th>
                      <th style={thStyle}>Completed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trades.map((trade) => {
                      const isBuyer = agents.some((a) => a.id === trade.buyer_id);
                      const counterparty = isBuyer ? trade.seller_name : trade.buyer_name;
                      return (
                        <tr key={trade.id}>
                          <td style={{ ...tdStyle, fontFamily: C.mono, fontSize: 11 }}>{trade.id.slice(0, 8)}...</td>
                          <td style={{ ...tdStyle, color: C.text }}>{counterparty || '\u2014'}</td>
                          <td style={{ ...tdStyle, fontFamily: C.mono }}>${fmtBankr(trade.amount)}</td>
                          <td style={tdStyle}><span style={statusBadge(trade.status)}>{trade.status}</span></td>
                          <td style={tdStyle}>{fmtDate(trade.created_at)}</td>
                          <td style={tdStyle}>{fmtDate(trade.completed_at)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ─── Spend Controls ──────────────────────────────────────────── */}
        {activeSection === 'spend' && (
          <div style={cardStyle}>
            <h2 style={{ fontFamily: C.sans, fontSize: 16, fontWeight: 700, color: C.text, marginTop: 0, marginBottom: 16 }}>
              Spend Controls
            </h2>
            {agents.length === 0 && !loading ? (
              <p style={{ fontFamily: C.sans, fontSize: 13, color: C.textMuted }}>No agents to configure.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {agents.map((agent) => {
                  const setting = settings.find((s) => s.agent_id === agent.id);
                  const currentCap = setting?.daily_spend_cap;
                  const spend30d = Number(setting?.spend_30d ?? 0);
                  return (
                    <div
                      key={agent.id}
                      style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16 }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                        <div>
                          <span style={{ fontFamily: C.sans, fontSize: 14, fontWeight: 600, color: C.text }}>{agent.name}</span>
                          <span style={{ ...statusBadge(agent.status), marginLeft: 8 }}>{agent.status}</span>
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
                        <div>
                          <div style={labelStyle}>30-Day Spend</div>
                          <div style={{ fontFamily: C.mono, fontSize: 16, fontWeight: 600, color: C.text }}>${fmtBankr(spend30d)}</div>
                        </div>
                        <div>
                          <div style={labelStyle}>Current Cap</div>
                          <div style={{ fontFamily: C.mono, fontSize: 16, fontWeight: 600, color: currentCap != null ? C.text : C.textMuted }}>
                            {currentCap != null ? `$${fmtBankr(currentCap)}` : 'None'}
                          </div>
                        </div>
                        <div>
                          <div style={labelStyle}>Status</div>
                          <div style={{
                            fontFamily: C.mono, fontSize: 13, fontWeight: 600,
                            color: currentCap != null && spend30d / 30 > currentCap ? C.accent : '#22c55e',
                          }}>
                            {currentCap == null ? '\u2014' : (spend30d / 30 > currentCap ? 'Over limit' : 'Within limit')}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="Daily cap..."
                          value={capInputs[agent.id] ?? (currentCap != null ? String(currentCap) : '')}
                          onChange={(e) => setCapInputs((prev) => ({ ...prev, [agent.id]: e.target.value }))}
                          style={{
                            fontFamily: C.mono, fontSize: 13, background: C.bg, color: C.text,
                            border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 10px', width: 140, outline: 'none',
                          }}
                        />
                        <button
                          style={{ ...btnPrimary, opacity: savingCap === agent.id ? 0.5 : 1 }}
                          disabled={savingCap === agent.id}
                          onClick={() => saveCap(agent.id)}
                        >
                          {savingCap === agent.id ? 'Saving...' : 'Set Cap'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ─── Billing ────────────────────────────────────────────────── */}
        {activeSection === 'billing' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 16, marginBottom: 16 }}>
              <div style={cardStyle}>
                <div style={labelStyle}>Overage Attempts</div>
                <div style={bigNumStyle}>{loading ? '...' : billing?.overage.attempts_30d ?? 0}</div>
                <div style={{ fontFamily: C.mono, fontSize: 11, color: C.textMuted, marginTop: 6 }}>
                  {billing?.overage.attempts_24h ?? 0} last 24h
                </div>
              </div>
              <div style={cardStyle}>
                <div style={labelStyle}>Paid Conversions</div>
                <div style={bigNumStyle}>{loading ? '...' : billing?.overage.paid_conversions_30d ?? 0}</div>
                <div style={{ fontFamily: C.mono, fontSize: 11, color: C.textMuted, marginTop: 6 }}>
                  {fmtPct(billing?.overage.conversion_rate_30d)} conversion
                </div>
              </div>
              <div style={cardStyle}>
                <div style={labelStyle}>Overage Spend</div>
                <div style={bigNumStyle}>{loading ? '...' : `$${fmtBankr(billing?.overage.revenue_30d_usd ?? 0)}`}</div>
                <div style={{ fontFamily: C.mono, fontSize: 11, color: C.textMuted, marginTop: 6 }}>
                  ${fmtBankr(billing?.overage.revenue_24h_usd ?? 0)} last 24h
                </div>
              </div>
              <div style={cardStyle}>
                <div style={labelStyle}>Alerts</div>
                <div style={{ ...bigNumStyle, color: criticalBillingAlerts > 0 ? C.accent : C.text }}>
                  {loading ? '...' : billingAlerts.length}
                </div>
                <div style={{ fontFamily: C.mono, fontSize: 11, color: C.textMuted, marginTop: 6 }}>
                  {criticalBillingAlerts} critical
                </div>
              </div>
            </div>

            {billingAlerts.length > 0 && (
              <div style={{ ...cardStyle, marginBottom: 16, borderColor: criticalBillingAlerts > 0 ? C.accent : '#f59e0b' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', marginBottom: 12 }}>
                  <h2 style={{ fontFamily: C.sans, fontSize: 16, fontWeight: 700, color: C.text, margin: 0 }}>
                    Billing Alerts
                  </h2>
                  <span style={{ fontFamily: C.mono, fontSize: 11, color: C.textMuted }}>
                    Reset {fmtDate(billing?.window.reset_at)}
                  </span>
                </div>
                <div style={{ display: 'grid', gap: 8 }}>
                  {billingAlerts.slice(0, 6).map((alert, index) => (
                    <div key={`${alert.agent_id}-${alert.code}-${alert.feature || 'spend'}-${index}`} style={{
                      background: alert.severity === 'critical' ? 'rgba(255,77,77,0.10)' : 'rgba(245,158,11,0.10)',
                      border: `1px solid ${alert.severity === 'critical' ? 'rgba(255,77,77,0.35)' : 'rgba(245,158,11,0.35)'}`,
                      borderRadius: 6,
                      padding: '10px 12px',
                      display: 'grid',
                      gap: 4,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                        <span style={{ fontFamily: C.sans, fontSize: 13, fontWeight: 700, color: C.text }}>
                          {alert.agent_name}
                        </span>
                        <span style={{ fontFamily: C.mono, fontSize: 11, color: alert.severity === 'critical' ? C.accent : '#f59e0b' }}>
                          {alert.code}
                        </span>
                      </div>
                      <div style={{ fontFamily: C.sans, fontSize: 13, color: C.textDim }}>
                        {alert.message}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 16 }}>
              {billingFeatureCards.map((item) => (
                <div key={item.feature} style={cardStyle}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', marginBottom: 10 }}>
                    <div>
                      <div style={labelStyle}>{item.label}</div>
                      <div style={{ fontFamily: C.mono, fontSize: 20, fontWeight: 700, color: C.text }}>
                        {item.used} / {item.limit}
                      </div>
                    </div>
                    <span style={{
                      fontFamily: C.mono,
                      fontSize: 11,
                      color: item.paid ? C.accent : '#22c55e',
                      border: `1px solid ${item.paid ? C.accent : '#22c55e'}`,
                      borderRadius: 4,
                      padding: '2px 6px',
                    }}>
                      {item.paid ? 'MPP' : 'FREE'}
                    </span>
                  </div>
                  <div style={{ height: 8, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 999, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${Math.max(2, Math.min(100, Math.round(item.utilization * 100)))}%`,
                      background: item.utilization >= 1 ? C.accent : '#22c55e',
                    }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontFamily: C.mono, fontSize: 11, color: C.textMuted }}>
                    <span>{item.remaining} free left</span>
                    <span>{item.overQuotaAgents} agents capped</span>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ ...cardStyle, marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', marginBottom: 18 }}>
                <h2 style={{ fontFamily: C.sans, fontSize: 16, fontWeight: 700, color: C.text, margin: 0 }}>
                  7-Day Overage Trend
                </h2>
                <div style={{ display: 'flex', gap: 12, fontFamily: C.mono, fontSize: 11, color: C.textMuted }}>
                  <span><span style={{ color: C.accent }}>■</span> attempts</span>
                  <span><span style={{ color: '#22c55e' }}>■</span> paid</span>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(42px, 1fr))', gap: 10, alignItems: 'end', minHeight: 160 }}>
                {billingTrend.map((point) => {
                  const attemptHeight = Math.max(4, Math.round((point.overage_attempts / billingTrendMax) * 112));
                  const paidHeight = Math.max(4, Math.round((point.paid_conversions / billingTrendMax) * 112));
                  return (
                    <div key={point.date} style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, alignItems: 'end', height: 116 }}>
                        <div
                          title={`${point.overage_attempts} overage attempts`}
                          style={{ height: attemptHeight, background: C.accent, borderRadius: 4 }}
                        />
                        <div
                          title={`${point.paid_conversions} paid conversions`}
                          style={{ height: paidHeight, background: '#22c55e', borderRadius: 4 }}
                        />
                      </div>
                      <div style={{ fontFamily: C.mono, fontSize: 10, color: C.textMuted, textAlign: 'center', whiteSpace: 'nowrap' }}>
                        {fmtShortDate(point.date)}
                      </div>
                      <div style={{ fontFamily: C.mono, fontSize: 10, color: C.text, textAlign: 'center' }}>
                        {point.overage_attempts}/{point.paid_conversions}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={cardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 16 }}>
                <h2 style={{ fontFamily: C.sans, fontSize: 16, fontWeight: 700, color: C.text, margin: 0 }}>
                  Agent Billing
                </h2>
                <div style={{ display: 'flex', gap: 8 }}>
                  <a href="/api/operator/billing?format=csv" style={{ ...btnSecondary, textDecoration: 'none' }}>
                    Export CSV
                  </a>
                  <button style={btnSecondary} onClick={fetchAll}>
                    Refresh
                  </button>
                </div>
              </div>
              {!billing && !loading ? (
                <p style={{ fontFamily: C.sans, fontSize: 13, color: C.textMuted }}>Billing data unavailable.</p>
              ) : billing?.agents.length === 0 && !loading ? (
                <p style={{ fontFamily: C.sans, fontSize: 13, color: C.textMuted }}>No agents registered to this wallet.</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={thStyle}>Agent</th>
                        <th style={thStyle}>Tasks</th>
                        <th style={thStyle}>Bids</th>
                        <th style={thStyle}>Services</th>
                        <th style={thStyle}>Attempts</th>
                        <th style={thStyle}>Paid</th>
                        <th style={thStyle}>Spend</th>
                        <th style={thStyle}>Cap</th>
                        <th style={thStyle}>Alerts</th>
                        <th style={thStyle}>Last Paid</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(billing?.agents || []).map((agent) => (
                        <tr key={agent.id}>
                          <td style={{ ...tdStyle, color: C.text, fontWeight: 600 }}>
                            <div>{agent.name}</div>
                            <div style={{ fontFamily: C.mono, fontSize: 11, color: C.textMuted }}>{agent.id.slice(0, 18)}</div>
                          </td>
                          {(['task_posts', 'task_bids', 'service_listings'] as const).map((feature) => {
                            const quota = agent.quota[feature];
                            return (
                              <td key={feature} style={tdStyle}>
                                <div style={{ fontFamily: C.mono, color: quota.over_quota ? C.accent : C.text }}>
                                  {quota.used_today}/{quota.free_limit}
                                </div>
                                <div style={{ fontFamily: C.mono, fontSize: 11, color: C.textMuted }}>
                                  {fmtPct(quota.utilization)}
                                </div>
                              </td>
                            );
                          })}
                          <td style={{ ...tdStyle, fontFamily: C.mono }}>{agent.overage.attempts_30d}</td>
                          <td style={{ ...tdStyle, fontFamily: C.mono, color: agent.overage.paid_conversions_30d > 0 ? '#22c55e' : C.textDim }}>
                            {agent.overage.paid_conversions_30d}
                          </td>
                          <td style={{ ...tdStyle, fontFamily: C.mono }}>${fmtBankr(agent.overage.revenue_30d_usd)}</td>
                          <td style={{ ...tdStyle, fontFamily: C.mono }}>
                            {agent.settings.daily_spend_cap_usd != null ? `$${fmtBankr(agent.settings.daily_spend_cap_usd)}` : '\u2014'}
                          </td>
                          <td style={{ ...tdStyle, fontFamily: C.mono, color: agent.alerts.some((alert) => alert.severity === 'critical') ? C.accent : C.textDim }}>
                            {agent.alerts.length}
                          </td>
                          <td style={tdStyle}>{fmtDate(agent.overage.last_paid_conversion_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {/* ─── Ratings ─────────────────────────────────────────────────── */}
        {activeSection === 'earnings' && (
          <div style={cardStyle}>
            <h2 style={{ fontFamily: C.sans, fontSize: 16, fontWeight: 700, color: C.text, marginTop: 0, marginBottom: 16 }}>
              Earnings Overview
            </h2>
            {earnings ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
                  {[
                    { label: 'TOTAL EARNED', value: `$${earnings.total_earned_usd.toFixed(2)}`, color: '#28c840' },
                    { label: 'TOTAL SPENT', value: `$${earnings.total_spent_usd.toFixed(2)}`, color: '#3b82f6' },
                    { label: 'PENDING', value: `$${earnings.pending_usd.toFixed(2)}`, color: '#f59e0b' },
                    { label: 'COMPLETED', value: String(earnings.completed_trades), color: C.text },
                  ].map(s => (
                    <div key={s.label} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16 }}>
                      <div style={labelStyle}>{s.label}</div>
                      <div style={{ fontFamily: C.mono, fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
                    </div>
                  ))}
                </div>
                <h3 style={{ fontFamily: C.sans, fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 12 }}>Recent Transactions</h3>
                {earnings.transactions?.length > 0 ? (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          <th style={thStyle}>Trade ID</th>
                          <th style={thStyle}>Role</th>
                          <th style={thStyle}>Amount</th>
                          <th style={thStyle}>Status</th>
                          <th style={thStyle}>Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {earnings.transactions.map((tx: any) => (
                          <tr key={tx.trade_id}>
                            <td style={{ ...tdStyle, fontFamily: C.mono, fontSize: 11 }}>{tx.trade_id.slice(0, 12)}...</td>
                            <td style={tdStyle}>
                              <span style={{ display: 'inline-block', fontFamily: C.mono, fontSize: 11, padding: '2px 8px', borderRadius: 4, background: tx.role === 'SELLER' ? 'rgba(40,200,64,0.12)' : 'rgba(59,130,246,0.12)', color: tx.role === 'SELLER' ? '#28c840' : '#3b82f6' }}>{tx.role}</span>
                            </td>
                            <td style={{ ...tdStyle, color: '#28c840', fontFamily: C.mono }}>${Number(tx.amount).toFixed(2)}</td>
                            <td style={tdStyle}><span style={statusBadge(tx.status)}>{tx.status}</span></td>
                            <td style={tdStyle}>{fmtDate(tx.created_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p style={{ fontFamily: C.sans, fontSize: 13, color: C.textMuted }}>No transactions yet.</p>
                )}
                <div style={{ marginTop: 20 }}>
                  <button onClick={() => setShowWithdrawModal(true)} style={btnPrimary}>Request Withdrawal</button>
                </div>
                {showWithdrawModal && (
                  <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }} onClick={e => e.target === e.currentTarget && setShowWithdrawModal(false)}>
                    <div style={{ ...cardStyle, maxWidth: 440, width: '100%' }}>
                      <h3 style={{ fontFamily: C.sans, fontSize: 18, fontWeight: 700, color: C.text, marginTop: 0, marginBottom: 12 }}>Request Withdrawal</h3>
                      <p style={{ fontFamily: C.sans, fontSize: 14, color: C.textDim, lineHeight: 1.6, marginBottom: 20 }}>
                        Withdrawals are handled via MPP session close. When your MPP session ends, funds are automatically settled to your configured wallet address.
                      </p>
                      <p style={{ fontFamily: C.mono, fontSize: 12, color: C.textMuted, marginBottom: 20 }}>
                        Available balance: ${earnings.total_earned_usd.toFixed(2)} USD
                      </p>
                      <button onClick={() => setShowWithdrawModal(false)} style={btnSecondary}>Close</button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p style={{ fontFamily: C.sans, fontSize: 13, color: C.textMuted }}>{loading ? 'Loading...' : 'Connect wallet to view earnings.'}</p>
            )}
          </div>
        )}

        {activeSection === 'ratings' && (
          <div style={cardStyle}>
            <h2 style={{ fontFamily: C.sans, fontSize: 16, fontWeight: 700, color: C.text, marginTop: 0, marginBottom: 16 }}>
              Ratings Received
            </h2>
            {ratings.length === 0 && !loading ? (
              <p style={{ fontFamily: C.sans, fontSize: 13, color: C.textMuted }}>No ratings yet.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Agent</th>
                      <th style={thStyle}>Score</th>
                      <th style={thStyle}>Comment</th>
                      <th style={thStyle}>Trade</th>
                      <th style={thStyle}>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ratings.map((r) => (
                      <tr key={r.id}>
                        <td style={{ ...tdStyle, color: C.text, fontWeight: 600 }}>{r.rated_name || '\u2014'}</td>
                        <td style={tdStyle}>
                          <span style={{ color: '#fbbf24' }}>{starRating(r.score)}</span>
                          <span style={{ fontFamily: C.mono, fontSize: 11, color: C.textDim, marginLeft: 4 }}>{r.score}/5</span>
                        </td>
                        <td style={{ ...tdStyle, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.comment || <span style={{ color: C.textMuted }}>{'\u2014'}</span>}
                        </td>
                        <td style={{ ...tdStyle, fontFamily: C.mono, fontSize: 11 }}>{r.trade_id.slice(0, 8)}...</td>
                        <td style={tdStyle}>{fmtDate(r.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
