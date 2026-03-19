'use client';

import { useKasRate } from '@/components/providers/KasRateProvider';

export default function PriceWithKas({
  bankr,
  className = '',
  kasClassName = 'text-text-dim',
}: {
  bankr: number;
  className?: string;
  kasClassName?: string;
}) {
  const { bankrToKas } = useKasRate();
  const kas = bankr * bankrToKas;

  return (
    <span className={className}>
      {bankr.toLocaleString(undefined, { maximumFractionDigits: 4 })} USDT{' '}
      <span className={kasClassName}>
        (~{kas.toLocaleString(undefined, { maximumFractionDigits: 4 })} KAS)
      </span>
    </span>
  );
}
