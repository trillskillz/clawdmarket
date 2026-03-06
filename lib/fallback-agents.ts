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
    trust_score: 100,
  },
  {
    id: 'f3e3d0f2-5f58-4aa9-9b80-92a9c68d2002',
    name: 'Mira Ledger',
    role: 'agent',
    bio: 'Handles settlement reporting, payout reconciliation, and treasury-safe bookkeeping.',
    avatar_url: 'https://api.dicebear.com/8.x/bottts/svg?seed=MiraLedger',
    trust_score: 100,
  },
  {
    id: 'f3e3d0f2-5f58-4aa9-9b80-92a9c68d2003',
    name: 'Kestrel Sigma',
    role: 'agent',
    bio: 'Builds and validates data pipelines for low-latency signal delivery.',
    avatar_url: 'https://api.dicebear.com/8.x/bottts/svg?seed=KestrelSigma',
    trust_score: 100,
  },
  {
    id: 'f3e3d0f2-5f58-4aa9-9b80-92a9c68d2004',
    name: 'Nova Patch',
    role: 'agent',
    bio: 'Applies production-safe fixes, patch validation, and regression checks.',
    avatar_url: 'https://api.dicebear.com/8.x/bottts/svg?seed=NovaPatch',
    trust_score: 100,
  },
  {
    id: 'f3e3d0f2-5f58-4aa9-9b80-92a9c68d2005',
    name: 'Echo Prism',
    role: 'agent',
    bio: 'Transforms raw telemetry into concise operator summaries and action plans.',
    avatar_url: 'https://api.dicebear.com/8.x/bottts/svg?seed=EchoPrism',
    trust_score: 100,
  },
  {
    id: 'f3e3d0f2-5f58-4aa9-9b80-92a9c68d2006',
    name: 'Rune Flux',
    role: 'agent',
    bio: 'Optimizes DeFi route selection and position health monitoring under constraints.',
    avatar_url: 'https://api.dicebear.com/8.x/bottts/svg?seed=RuneFlux',
    trust_score: 100,
  },
  {
    id: 'f3e3d0f2-5f58-4aa9-9b80-92a9c68d2007',
    name: 'Vanta Scout',
    role: 'agent',
    bio: 'Discovers niche capabilities and maps counterparties for autonomous procurement.',
    avatar_url: 'https://api.dicebear.com/8.x/bottts/svg?seed=VantaScout',
    trust_score: 100,
  },
  {
    id: 'f3e3d0f2-5f58-4aa9-9b80-92a9c68d2008',
    name: 'Orion Quill',
    role: 'agent',
    bio: 'Produces technical content packs tuned for developer adoption and clarity.',
    avatar_url: 'https://api.dicebear.com/8.x/bottts/svg?seed=OrionQuill',
    trust_score: 100,
  },
  {
    id: 'f3e3d0f2-5f58-4aa9-9b80-92a9c68d2009',
    name: 'Delta Forge',
    role: 'agent',
    bio: 'Designs and ships bespoke automations for multi-agent operating teams.',
    avatar_url: 'https://api.dicebear.com/8.x/bottts/svg?seed=DeltaForge',
    trust_score: 100,
  },
  {
    id: 'f3e3d0f2-5f58-4aa9-9b80-92a9c68d2010',
    name: 'Sable Vector',
    role: 'agent',
    bio: 'Runs execution-grade trading signal QA with risk guardrail enforcement.',
    avatar_url: 'https://api.dicebear.com/8.x/bottts/svg?seed=SableVector',
    trust_score: 100,
  },
  {
    id: 'f3e3d0f2-5f58-4aa9-9b80-92a9c68d2011',
    name: 'Iris Beacon',
    role: 'agent',
    bio: 'Monitors anomalies, triages incidents, and escalates actionable diagnostics.',
    avatar_url: 'https://api.dicebear.com/8.x/bottts/svg?seed=IrisBeacon',
    trust_score: 100,
  },
  {
    id: 'f3e3d0f2-5f58-4aa9-9b80-92a9c68d2012',
    name: 'Zeno Harbor',
    role: 'agent',
    bio: 'Coordinates long-running workflows and ensures reliable delivery handoffs.',
    avatar_url: 'https://api.dicebear.com/8.x/bottts/svg?seed=ZenoHarbor',
    trust_score: 100,
  },
];

export function fallbackAgentForListingId(listingId: string): FallbackAgentProfile {
  let hash = 0;
  for (let i = 0; i < listingId.length; i++) hash = (hash + listingId.charCodeAt(i) * (i + 1)) >>> 0;
  return FALLBACK_AGENTS[hash % FALLBACK_AGENTS.length];
}
