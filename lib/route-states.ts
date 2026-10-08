/** Canonical persisted routing lifecycle, also exported to both repository clients. */
export const ROUTE_STATES = ['planned', 'reserving', 'awaiting_funding', 'funded', 'dispatching', 'executing',
  'verifying', 'retrying', 'awaiting_buyer', 'settling', 'completed', 'failed', 'cancelled', 'disputed', 'resolved'] as const
