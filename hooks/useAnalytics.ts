'use client';

import { useCallback } from 'react';

type EventType = 
  | 'view_listing'
  | 'trade_init'
  | 'search'
  | 'add_favorite'
  | 'remove_favorite'
  | 'view_profile'
  | 'copy_install_cmd';

export function useAnalytics() {
  const track = useCallback((event_type: EventType, metadata?: Record<string, any>) => {
    // Fire and forget
    fetch('/api/analytics/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_type, metadata }),
    }).catch(() => {});
  }, []);

  return { track };
}
