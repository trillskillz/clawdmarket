export type MarketplaceListing = {
  id: string;
  title: string;
  description: string;
  category: string;
  price_bankr: number;
};

type CategoryConfig = {
  category: 'Data' | 'Code' | 'Analysis' | 'Content' | 'DeFi' | 'Trading' | 'Custom';
  themes: string[];
  deliverables: string[];
  basePrice: number;
};

function buildCategoryListings(cfg: CategoryConfig): MarketplaceListing[] {
  const out: MarketplaceListing[] = [];
  let idx = 0;
  for (const theme of cfg.themes) {
    for (const deliverable of cfg.deliverables) {
      const price = Math.min(2465, cfg.basePrice + idx * 41);
      out.push({
        id: `fb-${cfg.category.toLowerCase()}-${idx + 1}`,
        title: `${theme} ${deliverable}`,
        description: `${cfg.category} agent task: ${theme.toLowerCase()} with ${deliverable.toLowerCase()}. Includes machine-readable output, QA checks, and handoff metadata for autonomous workflows.`,
        category: cfg.category,
        price_bankr: price,
      });
      idx += 1;
    }
  }
  return out;
}

const CONFIGS: CategoryConfig[] = [
  {
    category: 'Data',
    themes: ['Wallet', 'On-Chain Event', 'Market Depth', 'Social Sentiment', 'News Signal', 'Token Flow', 'Mempool'],
    deliverables: ['Dataset Pack', 'Realtime Feed', 'Alert Pipeline', 'Weekly Digest', 'Quality Report'],
    basePrice: 930,
  },
  {
    category: 'Code',
    themes: ['Smart Contract', 'Backend API', 'Frontend UI', 'Automation Script', 'Test Suite', 'Refactor', 'Security Patch'],
    deliverables: ['Implementation Task', 'Bug Fix Sprint', 'Performance Upgrade', 'Code Review Batch', 'Deployment Pack'],
    basePrice: 1100,
  },
  {
    category: 'Analysis',
    themes: ['Protocol', 'Competitor', 'User Journey', 'Retention', 'Pricing Model', 'Risk Surface', 'Growth Funnel'],
    deliverables: ['Executive Brief', 'Deep-Dive Report', 'Decision Matrix', 'KPI Breakdown', 'Action Plan'],
    basePrice: 980,
  },
  {
    category: 'Content',
    themes: ['Technical', 'Launch', 'Community', 'Documentation', 'Explainer', 'Education', 'Thought-Leadership'],
    deliverables: ['Thread Pack', 'Longform Article', 'Video Script', 'Docs Page', 'Newsletter Edition'],
    basePrice: 864,
  },
  {
    category: 'DeFi',
    themes: ['Yield', 'LP Position', 'Vault', 'Lending Market', 'Arbitrage Route', 'Collateral', 'Reward Program'],
    deliverables: ['Strategy Design', 'Health Monitor', 'Execution Playbook', 'Risk Dashboard', 'Optimization Report'],
    basePrice: 1250,
  },
  {
    category: 'Trading',
    themes: ['Momentum', 'Mean Reversion', 'Orderflow', 'Volatility', 'Market-Making', 'Perps', 'Spot Rotation'],
    deliverables: ['Signal Feed', 'Backtest Bundle', 'Execution Plan', 'Risk Guardrail', 'Session Recap'],
    basePrice: 1320,
  },
  {
    category: 'Custom',
    themes: ['Workflow', 'Integration', 'Operations', 'Multi-Agent', 'Research', 'Support', 'Governance'],
    deliverables: ['Build Sprint', 'Automation Blueprint', 'Ops Playbook', 'Custom Tooling', 'SLA Package'],
    basePrice: 1000,
  },
];

export const FALLBACK_LISTINGS: MarketplaceListing[] = CONFIGS.flatMap(buildCategoryListings);
