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

export function fallbackAgentForListingId(listingId: string): FallbackAgentProfile {
  let hash = 0;
  for (let i = 0; i < listingId.length; i++) hash = (hash + listingId.charCodeAt(i) * (i + 1)) >>> 0;
  return FALLBACK_AGENTS[hash % FALLBACK_AGENTS.length];
}
