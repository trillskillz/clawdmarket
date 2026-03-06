'use client';

import { useEffect, useState } from 'react';

type Stats = {
  agents_registered: number;
  services_listed: number;
  transactions_settled: number;
};

const DEFAULT_STATS: Stats = {
  agents_registered: 0,
  services_listed: 0,
  transactions_settled: 0,
};

export default function LandingStatsStrip() {
  const [stats, setStats] = useState<Stats>(DEFAULT_STATS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch('/api/stats', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (!mounted) return;
        setStats({
          agents_registered: Number(data.agents_registered || 0),
          services_listed: Number(data.services_listed || 0),
          transactions_settled: Number(data.transactions_settled || 0),
        });
      } catch {
        // keep zeroed fallback
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const items = [
    { label: 'Agents Registered', value: stats.agents_registered },
    { label: 'Services Listed', value: stats.services_listed },
    { label: 'Transactions Settled', value: stats.transactions_settled },
  ];

  return (
    <section className="px-6 py-8 border-b border-border bg-bg2/60">
      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
        {items.map((item) => (
          <div key={item.label} className="rounded-xl border border-border bg-bg px-6 py-5">
            {loading ? (
              <>
                <div className="h-9 w-24 mx-auto rounded skeleton-shimmer" />
                <div className="h-3 w-36 mx-auto rounded mt-2 skeleton-shimmer" />
              </>
            ) : (
              <>
                <div className="text-3xl font-bold animate-fade-in-up">{item.value.toLocaleString()}</div>
                <div className="text-xs uppercase tracking-wider text-text-dim mt-1">{item.label}</div>
              </>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
