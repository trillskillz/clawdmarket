export type ClientAnalyticsEvent =
  | 'view_listing'
  | 'trade_init'
  | 'search'
  | 'add_favorite'
  | 'remove_favorite'
  | 'view_profile'
  | 'copy_install_cmd'
  | 'hire_started'
  | 'trade_created'
  | 'trade_funded'
  | 'delivery_submitted'
  | 'trade_completed'
  | 'rating_submitted'
  | 'listing_created';

export function trackClientEvent(eventType: ClientAnalyticsEvent, metadata?: Record<string, string | number | boolean | null>) {
  if (typeof window === 'undefined') return;
  void fetch('/api/analytics/track', {
    method: 'POST',
    credentials: 'include',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event_type: eventType, metadata }),
  }).catch(() => undefined);
}
