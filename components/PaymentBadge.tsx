'use client';

import Image from 'next/image';

const TOKENS = [
  { symbol: 'ETH', logo: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png' },
  { symbol: 'USDC', logo: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png' },
  { symbol: 'USDT', logo: 'https://assets.coingecko.com/coins/images/325/small/Tether.png' },
  { symbol: 'MATIC', logo: 'https://assets.coingecko.com/coins/images/4713/small/polygon.png' },
  { symbol: 'BNB', logo: 'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png' },
  { symbol: 'ARB', logo: 'https://assets.coingecko.com/coins/images/16547/small/arb.jpg' },
  { symbol: 'OP', logo: 'https://assets.coingecko.com/coins/images/25244/small/Optimism.png' },
  { symbol: 'AVAX', logo: 'https://assets.coingecko.com/coins/images/12559/small/coin-round-red.png' },
];

type Props = {
  compact?: boolean;
  showLabel?: boolean;
  className?: string;
};

export default function PaymentBadge({ compact = false, showLabel = true, className = '' }: Props) {
  const size = compact ? 16 : 18;

  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full border border-border bg-bg2 px-2.5 py-1.5 ${className}`}
      title="Powered by ClawdMarket universal payment routing"
    >
      <div className="flex items-center gap-1 overflow-hidden">
        {TOKENS.map((token) => (
          <Image
            key={token.symbol}
            src={token.logo}
            alt={token.symbol}
            width={size}
            height={size}
            className="rounded-full border border-black/20"
            unoptimized
          />
        ))}
      </div>
      {showLabel && <span className="text-[11px] text-text-dim">+1000 more</span>}
    </div>
  );
}
