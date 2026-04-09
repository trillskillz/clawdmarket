'use client';

import { createContext, useContext, useMemo } from 'react';

type KasRateContextValue = {
  bankrToKas: number;
  updatedAt: string;
};

// Static rate — KAS payment flow uses this as a conversion factor.
// Prices are displayed in USD; this rate is only used when submitting KAS payments.
const DEFAULT_RATE = 0.0171;

const KasRateContext = createContext<KasRateContextValue>({
  bankrToKas: DEFAULT_RATE,
  updatedAt: new Date().toISOString(),
});

export function KasRateProvider({ children }: { children: React.ReactNode }) {
  const value = useMemo(() => ({
    bankrToKas: DEFAULT_RATE,
    updatedAt: new Date().toISOString(),
  }), []);
  return <KasRateContext.Provider value={value}>{children}</KasRateContext.Provider>;
}

export function useKasRate() {
  return useContext(KasRateContext);
}
