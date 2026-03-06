'use client';

import { useEffect, useMemo, useState } from 'react';

type PriceState = {
  price: number | null;
  change24h: number | null;
  loading: boolean;
  pulse: boolean;
};

export default function KasPriceWidget() {
  const [state, setState] = useState<PriceState>({
    price: null,
    change24h: null,
    loading: true,
    pulse: false,
  });
  const [lastKnownPrice, setLastKnownPrice] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;

    const fetchPrice = async () => {
      try {
        const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=kaspa&vs_currencies=usd&include_24hr_change=true');
        if (!res.ok) throw new Error('price fetch failed');
        const data = await res.json();
        const p = Number(data?.kaspa?.usd);
        const c = Number(data?.kaspa?.usd_24h_change);

        if (!mounted) return;
        setLastKnownPrice(Number.isFinite(p) ? p : lastKnownPrice);
        setState({
          price: Number.isFinite(p) ? p : null,
          change24h: Number.isFinite(c) ? c : null,
          loading: false,
          pulse: true,
        });
        setTimeout(() => mounted && setState((prev) => ({ ...prev, pulse: false })), 500);
      } catch {
        if (!mounted) return;
        setState((prev) => ({
          ...prev,
          price: lastKnownPrice,
          loading: false,
          pulse: false,
        }));
      }
    };

    fetchPrice();
    const t = setInterval(fetchPrice, 60_000);

    return () => {
      mounted = false;
      clearInterval(t);
    };
  }, [lastKnownPrice]);

  const changeClass = useMemo(() => {
    if (state.change24h == null) return 'text-text-dim';
    if (state.change24h > 0) return 'text-green-400';
    if (state.change24h < 0) return 'text-red-400';
    return 'text-text-dim';
  }, [state.change24h]);

  const priceLabel = state.price != null ? `$${state.price.toFixed(state.price < 0.1 ? 5 : 3)}` : '—';
  const changeLabel =
    state.change24h != null
      ? `${state.change24h > 0 ? '+' : ''}${state.change24h.toFixed(2)}%`
      : '';

  if (state.loading) {
    return <div className="h-9 w-36 rounded-full border border-border skeleton-shimmer" />;
  }

  return (
    <div className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-bg2 text-sm ${state.pulse ? 'animate-pulse' : ''}`}>
      <span className="text-text-dim">KAS</span>
      <span className="font-semibold">{state.price == null && lastKnownPrice != null ? `~$${lastKnownPrice.toFixed(5)}` : priceLabel}</span>
      {changeLabel && <span className={changeClass}>{changeLabel}</span>}
    </div>
  );
}
