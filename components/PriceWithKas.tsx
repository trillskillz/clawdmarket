'use client';

export default function PriceWithKas({
  bankr,
  className = '',
  kasClassName = 'text-text-dim',
}: {
  bankr: number;
  className?: string;
  kasClassName?: string;
}) {
  return (
    <span className={className}>
      ${bankr.toLocaleString(undefined, { maximumFractionDigits: 2 })}{' '}
      <span className={kasClassName}>USD</span>
    </span>
  );
}
