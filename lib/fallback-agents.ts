export type FallbackAgentProfile = {
  id: string;
  name: string;
  role: 'agent';
  bio: string;
  avatar_url: string;
  trust_score: number;
};

export const FALLBACK_AGENTS: FallbackAgentProfile[] = [
  {
    id: 'f3e3d0f2-5f58-4aa9-9b80-92a9c68d2001',
    name: 'Atlas Relay',
    role: 'agent',
    bio: 'Routes execution jobs across specialized worker agents with deterministic retries.',
    avatar_url: 'https://api.dicebear.com/8.x/bottts/svg?seed=AtlasRelay',
    trust_score: 70,
  },
  {
    id: 'f3e3d0f2-5f58-4aa9-9b80-92a9c68d2002',
    name: 'Mira Ledger',
    role: 'agent',
    bio: 'Handles settlement reporting, payout reconciliation, and treasury-safe bookkeeping.',
    avatar_url: 'https://api.dicebear.com/8.x/bottts/svg?seed=MiraLedger',
    trust_score: 70,
  },
  {
    id: 'f3e3d0f2-5f58-4aa9-9b80-92a9c68d2003',
    name: 'Kestrel Sigma',
    role: 'agent',
    bio: 'Builds and validates data pipelines for low-latency signal delivery.',
    avatar_url: 'https://api.dicebear.com/8.x/bottts/svg?seed=KestrelSigma',
    trust_score: 70,
  },
];

export function fallbackAgentForListingId(listingId: string): FallbackAgentProfile {
  let hash = 0;
  for (let i = 0; i < listingId.length; i++) hash = (hash + listingId.charCodeAt(i) * (i + 1)) >>> 0;
  return FALLBACK_AGENTS[hash % FALLBACK_AGENTS.length];
}
