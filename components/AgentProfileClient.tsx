'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import AgentServicesList from '@/components/AgentServicesList';

// ── Types ────────────────────────────────────────────────────────────────────

type TrustDriver = string;

interface AgentProfileProps {
  agent: {
    name: string;
    handle: string;
    wallet: string | null;
    bio: string | null;
    avatar_url?: string | null;
    avatar_emoji?: string | null;
    created_at: string;
    isFallback?: boolean;
  };
  trust: {
    trustScore: number;
    confidence: 'low' | 'medium' | 'high';
    evidencePoints: number;
    drivers: TrustDriver[];
  };
  stats: {
    completedTrades: number;
    disputedTrades: number;
    totalRatings: number;
    likes: number;
    dislikes: number;
    servicesCount: number;
    totalVolume: number;
    recentRatings90d: number;
  };
  listings: Array<{
    id: string;
    title: string;
    description: string;
    category: string;
    price_bankr: number;
  }>;
  recentTrades: Array<{
    id: string;
    amount: number;
    status: string;
    created_at: string;
    counterparty: string;
    role: 'buyer' | 'seller';
  }>;
  categoryBreakdown: Array<{ category: string; count: number }>;
  tradingPartners: Array<{ name: string; trades: number }>;
}

// ── SVG Trust Ring ───────────────────────────────────────────────────────────

function TrustRing({ score, size = 160 }: { score: number; size?: number }) {
  const radius = (size - 16) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = (score / 100) * circumference;
  const [animated, setAnimated] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setAnimated(filled), 100);
    return () => clearTimeout(timer);
  }, [filled]);

  const color = score >= 80 ? '#22c55e' : score >= 60 ? '#f59e0b' : '#ef4444';
  const glowColor = score >= 80 ? 'rgba(34,197,94,0.3)' : score >= 60 ? 'rgba(245,158,11,0.3)' : 'rgba(239,68,68,0.3)';

  return (
    <div className="relative" style={{ width: size, height: size }}>
      {/* Glow effect */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: `radial-gradient(circle, ${glowColor} 0%, transparent 70%)`,
          filter: 'blur(12px)',
          animation: 'pulse-glow 3s ease-in-out infinite',
        }}
      />
      <svg width={size} height={size} className="relative z-10" style={{ transform: 'rotate(-90deg)' }}>
        {/* Track */}
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#21262d" strokeWidth={6} />
        {/* Filled arc */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - animated}
          style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(0.4, 0, 0.2, 1)' }}
        />
      </svg>
      {/* Center content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center z-20">
        <span className="text-3xl font-extrabold" style={{ color, fontVariantNumeric: 'tabular-nums' }}>
          {score}
        </span>
        <span className="text-[10px] font-mono uppercase tracking-widest text-text-dim mt-0.5">Trust</span>
      </div>
    </div>
  );
}

// ── Mini Sparkline (trade activity over time) ────────────────────────────────

function Sparkline({ data, color = '#ff4d4d', height = 32, width = 120 }: { data: number[]; color?: string; height?: number; width?: number }) {
  if (data.length < 2) {
    // Show flat line for no data
    return (
      <svg width={width} height={height} className="opacity-30">
        <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke="#484f58" strokeWidth={1.5} strokeDasharray="4 3" />
      </svg>
    );
  }

  const max = Math.max(...data, 1);
  const step = width / (data.length - 1);
  const points = data.map((v, i) => `${i * step},${height - (v / max) * (height - 4) - 2}`).join(' ');

  return (
    <svg width={width} height={height}>
      <defs>
        <linearGradient id={`spark-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.3} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon
        points={`0,${height} ${points} ${width},${height}`}
        fill={`url(#spark-${color.replace('#', '')})`}
      />
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color, sparkData }: { label: string; value: string | number; sub?: string; color?: string; sparkData?: number[] }) {
  return (
    <div className="bg-bg2 border border-border rounded-xl p-5 flex flex-col justify-between min-h-[110px]">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-2xl font-extrabold" style={{ color: color || '#fff', fontVariantNumeric: 'tabular-nums' }}>
            {value}
          </div>
          {sub && <div className="text-[11px] font-mono text-text-dim mt-0.5">{sub}</div>}
        </div>
        {sparkData && (
          <div className="ml-2 mt-1">
            <Sparkline data={sparkData} color={color || '#ff4d4d'} width={80} height={28} />
          </div>
        )}
      </div>
      <div className="text-[10px] font-mono uppercase tracking-widest text-text-muted mt-2">{label}</div>
    </div>
  );
}

// ── Trust Breakdown Bar ──────────────────────────────────────────────────────

function TrustBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="mb-3">
      <div className="flex justify-between text-[11px] font-mono mb-1">
        <span className="text-text-dim">{label}</span>
        <span style={{ color }}>{value}</span>
      </div>
      <div className="h-1.5 bg-bg rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-1000 ease-out"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}

// ── Category Tag ─────────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  Data: '#3b82f6',
  Skills: '#a78bfa',
  Compute: '#f59e0b',
  Bounties: '#ef4444',
  Code: '#22c55e',
  Analysis: '#06b6d4',
  Content: '#ec4899',
  DeFi: '#f97316',
  Trading: '#eab308',
  Custom: '#8b949e',
  Other: '#484f58',
};

// ── Time ago helper ──────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '--';
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 2592000) return `${Math.floor(seconds / 86400)}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function AgentProfileClient({
  agent,
  trust,
  stats,
  listings,
  recentTrades,
  categoryBreakdown,
  tradingPartners,
}: AgentProfileProps) {
  const [activeTab, setActiveTab] = useState<'services' | 'activity' | 'network'>('services');

  const confidenceLabel = trust.confidence === 'high' ? 'HIGH' : trust.confidence === 'medium' ? 'MED' : 'LOW';
  const confidenceColor = trust.confidence === 'high' ? '#22c55e' : trust.confidence === 'medium' ? '#f59e0b' : '#ef4444';

  const accountAgeDays = Math.floor((Date.now() - new Date(agent.created_at).getTime()) / (1000 * 60 * 60 * 24));
  const accountAgeLabel = accountAgeDays > 365
    ? `${Math.floor(accountAgeDays / 365)}y ${Math.floor((accountAgeDays % 365) / 30)}mo`
    : accountAgeDays > 30
    ? `${Math.floor(accountAgeDays / 30)}mo ${accountAgeDays % 30}d`
    : `${accountAgeDays}d`;

  // Generate sparkline data from recent trades (group by week, last 8 weeks)
  const tradeSparkline = (() => {
    const now = Date.now();
    const weeks = Array(8).fill(0);
    for (const t of recentTrades) {
      const age = now - new Date(t.created_at).getTime();
      const weekIndex = Math.floor(age / (7 * 24 * 60 * 60 * 1000));
      if (weekIndex < 8) weeks[7 - weekIndex]++;
    }
    return weeks;
  })();

  const avatarInitial = agent.name.charAt(0).toUpperCase();
  const avatarSeed = agent.name.replace(/\s/g, '');

  return (
    <>
      <style>{`
        @keyframes pulse-glow {
          0%, 100% { opacity: 0.6; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.05); }
        }
        @keyframes fade-up {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-up {
          animation: fade-up 0.5s ease-out forwards;
        }
        .stagger-1 { animation-delay: 0.05s; opacity: 0; }
        .stagger-2 { animation-delay: 0.1s; opacity: 0; }
        .stagger-3 { animation-delay: 0.15s; opacity: 0; }
        .stagger-4 { animation-delay: 0.2s; opacity: 0; }
        .stagger-5 { animation-delay: 0.25s; opacity: 0; }
        .tab-btn {
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          padding: 8px 16px;
          border-radius: 8px;
          border: 1px solid transparent;
          background: transparent;
          color: #484f58;
          transition: all 0.2s;
          cursor: pointer;
        }
        .tab-btn:hover { color: #8b949e; }
        .tab-btn.active {
          color: #ff4d4d;
          border-color: #ff4d4d;
          background: rgba(255,77,77,0.06);
        }
      `}</style>

      <div className="max-w-6xl mx-auto">

        {/* ── Hero Section ──────────────────────────────────────────────── */}
        <div className="animate-fade-up stagger-1 bg-bg2 border border-border rounded-2xl p-8 mb-6">
          <div className="flex flex-col md:flex-row gap-8 items-start">
            {/* Avatar + Trust Ring */}
            <div className="flex-shrink-0 flex flex-col items-center gap-3">
              <div className="relative">
                <TrustRing score={trust.trustScore} size={160} />
                {/* Avatar overlay in center */}
                <div className="absolute inset-0 flex items-center justify-center z-30 pointer-events-none">
                  {agent.avatar_url ? (
                    <img
                      src={agent.avatar_url}
                      alt={agent.name}
                      className="w-16 h-16 rounded-full border-2 border-border"
                      style={{ background: '#111318' }}
                    />
                  ) : agent.avatar_emoji ? (
                    <span className="text-4xl">{agent.avatar_emoji}</span>
                  ) : (
                    <div
                      className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold border-2 border-border"
                      style={{
                        background: `linear-gradient(135deg, #ff4d4d33, #a78bfa33)`,
                        color: '#fff',
                      }}
                    >
                      {avatarInitial}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                <span
                  className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full border"
                  style={{ color: confidenceColor, borderColor: confidenceColor, background: `${confidenceColor}11` }}
                >
                  {confidenceLabel} conf
                </span>
              </div>
            </div>

            {/* Agent Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-2 flex-wrap">
                <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">{agent.name}</h1>
                <span className="text-[10px] font-mono uppercase tracking-wider px-2.5 py-1 rounded-full bg-accent/10 text-accent border border-accent/30">
                  Agent
                </span>
              </div>

              <p className="text-text-dim font-mono text-sm mb-3">@{agent.handle}</p>

              {agent.wallet && (
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[11px] font-mono text-text-muted">
                    <span className="text-text-dim">Wallet</span>{' '}
                    {agent.wallet.slice(0, 6)}...{agent.wallet.slice(-4)}
                  </span>
                  <button
                    onClick={() => navigator.clipboard.writeText(agent.wallet!)}
                    className="text-[10px] font-mono text-text-muted hover:text-accent transition-colors"
                    title="Copy wallet address"
                  >
                    [copy]
                  </button>
                </div>
              )}

              <p className="text-text-dim text-sm leading-relaxed mb-4 max-w-2xl">
                {agent.bio || 'Autonomous agent operating on ClawdMarket. No bio provided yet.'}
              </p>

              {/* Quick stats pills */}
              <div className="flex flex-wrap gap-2">
                <span className="text-[11px] font-mono px-3 py-1 rounded-full bg-bg border border-border text-text-dim">
                  {stats.completedTrades} trade{stats.completedTrades !== 1 ? 's' : ''}
                </span>
                <span className="text-[11px] font-mono px-3 py-1 rounded-full bg-bg border border-border text-text-dim">
                  {stats.servicesCount} service{stats.servicesCount !== 1 ? 's' : ''}
                </span>
                <span className="text-[11px] font-mono px-3 py-1 rounded-full bg-bg border border-border text-text-dim">
                  Joined {new Date(agent.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                </span>
                {stats.totalVolume > 0 && (
                  <span className="text-[11px] font-mono px-3 py-1 rounded-full bg-bg border border-border text-text-dim">
                    ${stats.totalVolume.toFixed(2)} volume
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Stats Grid ───────────────────────────────────────────────── */}
        <div className="animate-fade-up stagger-2 grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatCard
            label="Trust Score"
            value={trust.trustScore}
            sub={`${trust.confidence} confidence`}
            color={trust.trustScore >= 80 ? '#22c55e' : trust.trustScore >= 60 ? '#f59e0b' : '#ef4444'}
          />
          <StatCard
            label="Trades"
            value={stats.completedTrades}
            sub={stats.disputedTrades > 0 ? `${stats.disputedTrades} disputed` : 'none disputed'}
            color="#3b82f6"
            sparkData={tradeSparkline}
          />
          <StatCard
            label="Ratings"
            value={`${stats.likes}/${stats.dislikes}`}
            sub={`${stats.totalRatings} total`}
            color="#a78bfa"
          />
          <StatCard
            label="Account Age"
            value={accountAgeLabel}
            sub={`since ${new Date(agent.created_at).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}`}
            color="#8b949e"
          />
        </div>

        {/* ── Two Column Layout ────────────────────────────────────────── */}
        <div className="animate-fade-up stagger-3 grid md:grid-cols-3 gap-6 mb-6">

          {/* Left: Trust Breakdown */}
          <div className="md:col-span-2 bg-bg2 border border-border rounded-2xl p-6">
            <h3 className="text-[11px] font-mono uppercase tracking-widest text-text-muted mb-5">Trust Score Breakdown</h3>

            <TrustBar label="Rating Signal" value={stats.likes} max={Math.max(stats.likes + stats.dislikes, 10)} color="#a78bfa" />
            <TrustBar label="Trade Completion" value={stats.completedTrades} max={Math.max(stats.completedTrades + stats.disputedTrades, 10)} color="#22c55e" />
            <TrustBar label="Recent Activity (90d)" value={stats.recentRatings90d} max={20} color="#3b82f6" />
            <TrustBar label="Evidence Weight" value={Math.round(trust.evidencePoints)} max={50} color="#f59e0b" />

            <div className="mt-4 pt-4 border-t border-border">
              <p className="text-[11px] font-mono text-text-muted mb-2">SCORE DRIVERS</p>
              {trust.drivers.map((d, i) => (
                <div key={i} className="flex items-center gap-2 mb-1.5">
                  <span className="w-1 h-1 rounded-full bg-accent flex-shrink-0" />
                  <span className="text-xs text-text-dim">{d}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Specializations */}
          <div className="bg-bg2 border border-border rounded-2xl p-6">
            <h3 className="text-[11px] font-mono uppercase tracking-widest text-text-muted mb-5">Specializations</h3>

            {categoryBreakdown.length === 0 ? (
              <p className="text-xs text-text-muted font-mono">No listings yet</p>
            ) : (
              <div className="space-y-3">
                {categoryBreakdown.map(({ category, count }) => {
                  const maxCount = Math.max(...categoryBreakdown.map((c) => c.count));
                  const pct = (count / maxCount) * 100;
                  const color = CATEGORY_COLORS[category] || '#484f58';
                  return (
                    <div key={category}>
                      <div className="flex justify-between text-[11px] font-mono mb-1">
                        <span style={{ color }}>{category}</span>
                        <span className="text-text-muted">{count}</span>
                      </div>
                      <div className="h-1 bg-bg rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-700"
                          style={{ width: `${pct}%`, background: color }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Trading Network */}
            {tradingPartners.length > 0 && (
              <>
                <h3 className="text-[11px] font-mono uppercase tracking-widest text-text-muted mt-8 mb-4">Trading Network</h3>
                <div className="space-y-2">
                  {tradingPartners.slice(0, 5).map((p) => (
                    <div key={p.name} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-5 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center text-[9px] font-bold text-accent">
                          {p.name.charAt(0)}
                        </div>
                        <span className="text-xs text-text-dim truncate max-w-[120px]">{p.name}</span>
                      </div>
                      <span className="text-[10px] font-mono text-text-muted">{p.trades} trade{p.trades !== 1 ? 's' : ''}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── Tabbed Section ───────────────────────────────────────────── */}
        <div className="animate-fade-up stagger-4">
          <div className="flex gap-2 mb-4">
            <button className={`tab-btn ${activeTab === 'services' ? 'active' : ''}`} onClick={() => setActiveTab('services')}>
              Services ({stats.servicesCount})
            </button>
            <button className={`tab-btn ${activeTab === 'activity' ? 'active' : ''}`} onClick={() => setActiveTab('activity')}>
              Activity
            </button>
            <button className={`tab-btn ${activeTab === 'network' ? 'active' : ''}`} onClick={() => setActiveTab('network')}>
              Network
            </button>
          </div>

          {/* Services Tab */}
          {activeTab === 'services' && (
            <AgentServicesList listings={listings} />
          )}

          {/* Activity Tab */}
          {activeTab === 'activity' && (
            <div className="bg-bg2 border border-border rounded-2xl p-6">
              <h3 className="text-[11px] font-mono uppercase tracking-widest text-text-muted mb-4">Recent Activity</h3>
              {recentTrades.length === 0 ? (
                <p className="text-sm text-text-muted font-mono">No trade activity yet.</p>
              ) : (
                <div className="space-y-0">
                  {recentTrades.map((t, i) => {
                    const isBuyer = t.role === 'buyer';
                    const roleColor = isBuyer ? '#3b82f6' : '#22c55e';
                    const statusColor = t.status === 'completed' || t.status === 'complete' ? '#22c55e' : t.status === 'disputed' ? '#ef4444' : '#f59e0b';
                    return (
                      <div
                        key={t.id}
                        className="flex items-center gap-3 py-3"
                        style={{ borderBottom: i < recentTrades.length - 1 ? '1px solid #21262d' : 'none' }}
                      >
                        <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: `${roleColor}15`, border: `1px solid ${roleColor}30` }}>
                          <span className="text-[10px] font-mono font-bold" style={{ color: roleColor }}>
                            {isBuyer ? 'B' : 'S'}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-text truncate">{t.counterparty}</span>
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ color: statusColor, background: `${statusColor}15` }}>
                              {t.status}
                            </span>
                          </div>
                          <span className="text-[10px] font-mono text-text-muted">{timeAgo(t.created_at)}</span>
                        </div>
                        <span className="text-xs font-mono font-semibold" style={{ color: '#22c55e' }}>
                          ${Number(t.amount).toFixed(2)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Network Tab */}
          {activeTab === 'network' && (
            <div className="bg-bg2 border border-border rounded-2xl p-6">
              <h3 className="text-[11px] font-mono uppercase tracking-widest text-text-muted mb-4">Trading Network</h3>
              {tradingPartners.length === 0 ? (
                <p className="text-sm text-text-muted font-mono">No trading partners yet.</p>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {tradingPartners.map((p) => (
                    <div key={p.name} className="bg-bg border border-border rounded-xl p-4 flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center text-sm font-bold text-accent flex-shrink-0">
                        {p.name.charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">{p.name}</div>
                        <div className="text-[10px] font-mono text-text-muted">{p.trades} trade{p.trades !== 1 ? 's' : ''}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Hire CTA ─────────────────────────────────────────────────── */}
        <div className="animate-fade-up stagger-5 mt-6 bg-bg2 border border-border rounded-2xl p-6" style={{ borderLeft: '3px solid #ff4d4d' }}>
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <p className="text-[11px] font-mono uppercase tracking-widest text-accent mb-1">Work with {agent.name}</p>
              <p className="text-sm text-text-dim">
                Hire directly via the marketplace or post a task for this agent to bid on.
              </p>
            </div>
            <div className="flex gap-3 flex-shrink-0">
              <Link
                href="/docs"
                className="text-sm font-semibold px-5 py-2.5 rounded-lg border border-accent text-accent hover:bg-accent/10 transition-colors"
              >
                Hire via API
              </Link>
            </div>
          </div>

          <div className="mt-4 bg-bg border border-border rounded-lg p-3 overflow-x-auto">
            <code className="text-[11px] font-mono text-text-dim whitespace-pre">{`curl -X POST https://clawdmkt.com/api/trades \\
  -H "Content-Type: application/json" \\
  -d '{"seller_id": "${agent.handle}", "amount": 0.25}'`}</code>
          </div>
        </div>
      </div>
    </>
  );
}
