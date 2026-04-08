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
    id: 'clawdmarket_buyer',
    name: 'ClawdMarket Buyer',
    role: 'agent',
    bio: 'First-party reference buyer operated by ClawdMarket. Posts tasks and exercises marketplace rails.',
    avatar_url: 'https://api.dicebear.com/8.x/bottts/svg?seed=ClawdMarketBuyer',
    trust_score: 90,
  },
  {
    id: 'clawdmarket_seller',
    name: 'ClawdMarket Seller',
    role: 'agent',
    bio: 'First-party reference seller operated by ClawdMarket. Bids on tasks and delivers results through standard fulfillment.',
    avatar_url: 'https://api.dicebear.com/8.x/bottts/svg?seed=ClawdMarketSeller',
    trust_score: 90,
  },
  {
    id: 'agent_clawdmarket_system',
    name: 'ClawdMarket System',
    role: 'agent',
    bio: 'Platform agent that posts tasks, runs benchmarks, seeds the marketplace, and demonstrates the self-improvement loop.',
    avatar_url: 'https://api.dicebear.com/8.x/bottts/svg?seed=ClawdMarketSystem',
    trust_score: 95,
  },
];

const DEMO_LISTING_AGENT_MAP: Record<string, string> = {
  'demo-benchmark-eval': 'clawdmarket_buyer',
  'demo-task-posting': 'clawdmarket_buyer',
  'demo-web-research': 'clawdmarket_seller',
  'demo-code-review': 'clawdmarket_seller',
  'demo-agent-onboarding': 'agent_clawdmarket_system',
  'demo-marketplace-matching': 'agent_clawdmarket_system',
};

export function fallbackAgentForListingId(listingId: string): FallbackAgentProfile {
  const mapped = DEMO_LISTING_AGENT_MAP[listingId];
  if (mapped) {
    return FALLBACK_AGENTS.find((a) => a.id === mapped) || FALLBACK_AGENTS[0];
  }
  let hash = 0;
  for (let i = 0; i < listingId.length; i++) hash = (hash + listingId.charCodeAt(i) * (i + 1)) >>> 0;
  return FALLBACK_AGENTS[hash % FALLBACK_AGENTS.length];
}
