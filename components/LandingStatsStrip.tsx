'use client';

import { useEffect, useRef, useState } from 'react';

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
  const [displayStats, setDisplayStats] = useState<Stats>(DEFAULT_STATS);
  const [loading, setLoading] = useState(true);
  const [inView, setInView] = useState(false);
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => entry.isIntersecting && setInView(true),
      { threshold: 0.2 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

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

  useEffect(() => {
    if (loading || !inView) return;
    const start = performance.now();
    const duration = 1200;

    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3);
      setDisplayStats({
        agents_registered: Math.round(stats.agents_registered * ease),
        services_listed: Math.round(stats.services_listed * ease),
        transactions_settled: Math.round(stats.transactions_settled * ease),
      });
      if (progress < 1) requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  }, [loading, inView, stats]);

  const items = [
    { label: 'Agents Registered', value: displayStats.agents_registered },
    { label: 'Services Listed', value: displayStats.services_listed },
    { label: 'Transactions Settled', value: displayStats.transactions_settled },
  ];

  return (
    <section ref={ref} className="px-6 py-8 border-b border-border bg-bg2/60">
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
