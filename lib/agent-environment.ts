export type FailureMode = {
  code: string;
  description: string;
  deterministic_resolution: string;
};

export const AGENT_ENV_VERSION = '2026-02-26.1';

export const ACTIONS = [
  {
    action: 'wallet.get',
    endpoint: 'GET /api/wallet',
    parameters: {},
    atomic: true,
    notes: 'Returns exact settled balance + escrow + recent transaction ledger.',
  },
  {
    action: 'listing.get',
    endpoint: 'GET /api/listings/{id}',
    parameters: { id: 'uuid' },
    atomic: true,
    notes: 'Returns listing state with source + timestamp.',
  },
  {
    action: 'session.init',
    endpoint: 'POST /api/agent/session',
    parameters: {
      declared_parameters: 'object',
      ttl_seconds: 'number<=86400',
    },
    atomic: true,
    notes: 'Returns immutable session hash used to detect counterparty deviation.',
  },
  {
    action: 'trade.create',
    endpoint: 'POST /api/trades',
    parameters: {
      listing_id: 'uuid',
      amount: 'number',
      allow_partial_fill: 'boolean=false',
      headers: 'x-agent-nonce, x-agent-timestamp, optional session headers',
    },
    atomic: true,
    notes: 'Trade + escrow lock + fee are committed atomically or rejected.',
  },
  {
    action: 'trade.updateStatus',
    endpoint: 'PATCH /api/trades/{id}',
    parameters: { id: 'uuid', status: 'completed|disputed' },
    atomic: true,
    notes: 'Status transition and escrow release path are atomic.',
  },
  {
    action: 'reconcile.snapshot',
    endpoint: 'GET /api/agent/environment?snapshot=1',
    parameters: {},
    atomic: true,
    notes: 'Full user-scoped snapshot for reconciliation and gap detection.',
  },
] as const;

export const SUBSCRIPTIONS = [
  {
    name: 'balance.changed',
    delivery: 'webhook push',
    current_support: true,
  },
  {
    name: 'trade.created',
    delivery: 'webhook push',
    current_support: true,
  },
  {
    name: 'trade.completed',
    delivery: 'webhook push',
    current_support: true,
  },
  {
    name: 'listing.sold',
    delivery: 'webhook push',
    current_support: true,
  },
] as const;

export const LATENCY_BENCHMARKS_MS = {
  push_p50: 250,
  push_p95: 1500,
  reconcile_snapshot: 800,
};

export const FAILURE_MODES: FailureMode[] = [
  {
    code: 'UNAUTHORIZED',
    description: 'Instruction source could not be authenticated.',
    deterministic_resolution: 'Refresh credentials and retry with verified token.',
  },
  {
    code: 'VALIDATION_FAILED',
    description: 'Input payload failed schema validation.',
    deterministic_resolution: 'Correct payload according to schema and retry once.',
  },
  {
    code: 'LISTING_NOT_ACTIVE',
    description: 'Listing cannot be traded in current state.',
    deterministic_resolution: 'Abort; fetch latest listing state.',
  },
  {
    code: 'INSUFFICIENT_FUNDS',
    description: 'Wallet settled balance cannot fund amount+fee.',
    deterministic_resolution: 'Abort or reduce amount; then retry.',
  },
  {
    code: 'PARTIAL_FILL_NOT_SUPPORTED',
    description: 'Partial fill requested where not explicitly supported.',
    deterministic_resolution: 'Resubmit full-fill order only.',
  },
  {
    code: 'TRADE_STATE_CONFLICT',
    description: 'Trade status transition conflicts with current state.',
    deterministic_resolution: 'Reconcile and stop transition attempt.',
  },
  {
    code: 'RATE_LIMITED',
    description: 'Request exceeded rate limits.',
    deterministic_resolution: 'Wait for reset and retry.',
  },
  {
    code: 'INTERNAL_ERROR',
    description: 'Unexpected server-side failure.',
    deterministic_resolution: 'Reconcile, then retry with backoff.',
  },
];

export function envMeta(source: string) {
  return {
    source,
    timestamp: new Date().toISOString(),
    environment_version: AGENT_ENV_VERSION,
  };
}
