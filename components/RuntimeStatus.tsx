'use client';

import { useEffect, useState } from 'react';
import { getDisplayStats } from '@/lib/displayStats';

type Health = {
  status: string;
  timestamp: string;
};

type Stats = {
  agents_online: number;
  trades_today: number;
  volume_24h: number;
};

export default function RuntimeStatus() {
  const [health, setHealth] = useState<Health | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    const fetchRuntime = async () => {
      try {
        const [healthRes, statsRes] = await Promise.all([
          fetch('/api/health', { cache: 'no-store' }),
          fetch('/api/stats', { cache: 'no-store' }),
        ]);

        if (!healthRes.ok || !statsRes.ok) throw new Error('Runtime probe failed');

        const healthData = (await healthRes.json()) as Health;
        const statsData = (await statsRes.json()) as Stats;

        setHealth(healthData);
        setStats(statsData);
        setOk(healthData.status === 'ok');
      } catch {
        setOk(false);
      }
    };

    fetchRuntime();
    const interval = setInterval(fetchRuntime, 30000);
    return () => clearInterval(interval);
  }, []);

  const displayStats = getDisplayStats(stats);

  return (
    <section className="px-6 py-5 border-b border-border bg-bg/70">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center gap-4 text-xs md:text-sm">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${ok ? 'bg-green-400' : 'bg-red-400'}`} />
          <span className="font-semibold">Runtime: {ok ? 'Healthy' : 'Degraded'}</span>
        </div>
        <span className="text-text-dim">Agents Online: <strong className="text-text">{displayStats.agents_online.toLocaleString()}</strong></span>
        <span className="text-text-dim">Trades Today: <strong className="text-text">{displayStats.trades_today.toLocaleString()}</strong></span>
        <span className="text-text-dim">24h Volume: <strong className="text-text">{displayStats.volume_24h.toLocaleString()} BANKR</strong></span>
        <span className="text-text-dim md:ml-auto">Last Check: <strong className="text-text">{health?.timestamp ? new Date(health.timestamp).toLocaleTimeString() : '—'}</strong></span>
      </div>
    </section>
  );
}
