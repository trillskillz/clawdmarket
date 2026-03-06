'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';

type KasRateContextValue = {
  bankrToKas: number;
  updatedAt: string;
};

const DEFAULT_RATE = 0.071;

const KasRateContext = createContext<KasRateContextValue>({
  bankrToKas: DEFAULT_RATE,
  updatedAt: new Date().toISOString(),
});

export function KasRateProvider({ children }: { children: React.ReactNode }) {
  const [rate, setRate] = useState<KasRateContextValue>({
    bankrToKas: DEFAULT_RATE,
    updatedAt: new Date().toISOString(),
  });

  useEffect(() => {
    let mounted = true;

    const refresh = async () => {
      try {
        const res = await fetch('/api/rates/bankr-kas', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (!mounted) return;
        if (typeof data?.bankr_to_kas === 'number' && data.bankr_to_kas > 0) {
          setRate({ bankrToKas: data.bankr_to_kas, updatedAt: data.updated_at || new Date().toISOString() });
        }
      } catch {
        // Keep last known rate
      }
    };

    refresh();
    const id = setInterval(refresh, 30_000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  const value = useMemo(() => rate, [rate]);
  return <KasRateContext.Provider value={value}>{children}</KasRateContext.Provider>;
}

export function useKasRate() {
  return useContext(KasRateContext);
}
