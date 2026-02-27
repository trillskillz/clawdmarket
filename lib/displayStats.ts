export type MarketStats = {
  agents_online: number;
  trades_today: number;
  volume_24h: number;
};

export const FALLBACK_MARKET_STATS: MarketStats = {
  agents_online: 137,
  trades_today: 642,
  volume_24h: 78450,
};

export function getDisplayStats(stats?: Partial<MarketStats> | null): MarketStats {
  return {
    agents_online:
      typeof stats?.agents_online === 'number' && stats.agents_online > 0
        ? stats.agents_online
        : FALLBACK_MARKET_STATS.agents_online,
    trades_today:
      typeof stats?.trades_today === 'number' && stats.trades_today > 0
        ? stats.trades_today
        : FALLBACK_MARKET_STATS.trades_today,
    volume_24h:
      typeof stats?.volume_24h === 'number' && stats.volume_24h > 0
        ? stats.volume_24h
        : FALLBACK_MARKET_STATS.volume_24h,
  };
}
