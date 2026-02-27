'use client';

interface AnalyticsSummary {
  range_days: 7 | 30;
  trade_by_status: { pending: number; completed: number; disputed: number };
  listing_funnel: { active: number; sold: number; expired: number; total: number };
  api_key_summary: { total: number; recently_used: number; never_used: number };
  analytics_events: {
    total: number;
    by_type: Record<string, number>;
    trend: { date: string; count: number }[];
  };
}

interface AnalyticsTabProps {
  analytics: AnalyticsSummary | null;
  loading: boolean;
  rangeDays: 7 | 30;
  onRangeChange: (days: 7 | 30) => void;
}

function Bar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-xs text-text-dim mb-1">
        <span>{label}</span>
        <span>{value}</span>
      </div>
      <div className="h-2 bg-bg rounded-full overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function AnalyticsTab({ analytics, loading, rangeDays, onRangeChange }: AnalyticsTabProps) {
  if (loading) {
    return (
      <div className="grid md:grid-cols-3 gap-6 animate-pulse">
        <div className="h-40 bg-surface rounded-xl" />
        <div className="h-40 bg-surface rounded-xl" />
        <div className="h-40 bg-surface rounded-xl" />
      </div>
    );
  }

  if (!analytics) {
    return <div className="text-center py-12 text-text-dim">Failed to load analytics data.</div>;
  }

  const tradeMax = Math.max(
    analytics.trade_by_status.pending,
    analytics.trade_by_status.completed,
    analytics.trade_by_status.disputed,
    1
  );

  const listingMax = Math.max(
    analytics.listing_funnel.active,
    analytics.listing_funnel.sold,
    analytics.listing_funnel.expired,
    1
  );

  const topEvents = Object.entries(analytics.analytics_events.by_type)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const trendMax = Math.max(...analytics.analytics_events.trend.map((d) => d.count), 1);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Operator Analytics</h2>
        <div className="flex gap-2">
          <button
            onClick={() => onRangeChange(7)}
            className={`px-3 py-1 rounded text-sm ${rangeDays === 7 ? 'bg-accent text-black' : 'bg-surface text-text-dim'}`}
          >
            7d
          </button>
          <button
            onClick={() => onRangeChange(30)}
            className={`px-3 py-1 rounded text-sm ${rangeDays === 30 ? 'bg-accent text-black' : 'bg-surface text-text-dim'}`}
          >
            30d
          </button>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-6 mb-8">
        <div className="card">
          <div className="text-xs uppercase text-text-dim mb-2">API Keys</div>
          <div className="text-3xl font-bold">{analytics.api_key_summary.total}</div>
          <div className="text-sm text-text-dim mt-2">
            {analytics.api_key_summary.recently_used} used in last 30d · {analytics.api_key_summary.never_used} never used
          </div>
        </div>

        <div className="card">
          <div className="text-xs uppercase text-text-dim mb-2">Listings</div>
          <div className="text-3xl font-bold">{analytics.listing_funnel.total}</div>
          <div className="text-sm text-text-dim mt-2">
            {analytics.listing_funnel.sold} sold · {analytics.listing_funnel.active} active · {analytics.listing_funnel.expired} expired
          </div>
        </div>

        <div className="card">
          <div className="text-xs uppercase text-text-dim mb-2">Events ({rangeDays}d)</div>
          <div className="text-3xl font-bold">{analytics.analytics_events.total}</div>
          <div className="text-sm text-text-dim mt-2">Tracked behavior events in past {rangeDays} days</div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="font-semibold mb-4">Trade Volume by Status</h3>
          <div className="space-y-3">
            <Bar label="Completed" value={analytics.trade_by_status.completed} max={tradeMax} color="bg-green-500" />
            <Bar label="Pending" value={analytics.trade_by_status.pending} max={tradeMax} color="bg-yellow-500" />
            <Bar label="Disputed" value={analytics.trade_by_status.disputed} max={tradeMax} color="bg-red-500" />
          </div>
        </div>

        <div className="card">
          <h3 className="font-semibold mb-4">Listing Conversion Funnel</h3>
          <div className="space-y-3 mb-6">
            <Bar label="Sold" value={analytics.listing_funnel.sold} max={listingMax} color="bg-accent" />
            <Bar label="Active" value={analytics.listing_funnel.active} max={listingMax} color="bg-blue-500" />
            <Bar label="Expired" value={analytics.listing_funnel.expired} max={listingMax} color="bg-gray-500" />
          </div>

          <h4 className="text-sm font-semibold text-text-dim uppercase">Event trend ({rangeDays}d)</h4>
          <div className="mt-2 grid grid-cols-10 gap-1 items-end h-16">
            {analytics.analytics_events.trend.slice(-10).map((point) => (
              <div key={point.date} className="bg-bg rounded-sm relative group" style={{ height: `${Math.max(8, Math.round((point.count / trendMax) * 100))}%` }}>
                <span className="hidden group-hover:block absolute -top-6 left-1/2 -translate-x-1/2 text-[10px] bg-black px-1 py-0.5 rounded">{point.count}</span>
              </div>
            ))}
          </div>

          <h4 className="text-sm font-semibold text-text-dim uppercase mt-6">Top events ({rangeDays}d)</h4>
          <div className="mt-2 space-y-1 text-sm">
            {topEvents.length === 0 ? (
              <div className="text-text-dim">No event data yet.</div>
            ) : (
              topEvents.map(([event, count]) => (
                <div key={event} className="flex justify-between">
                  <span className="text-text-dim">{event}</span>
                  <span className="font-mono">{count}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
