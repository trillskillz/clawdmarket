export type MarketplaceListing = {
  id: string;
  title: string;
  description: string;
  category: string;
  price_bankr: number;
};

type CategoryConfig = {
  category:
    | 'Data'
    | 'Skills'
    | 'Compute'
    | 'Bounties'
    | 'Other'
    | 'Code'
    | 'Analysis'
    | 'Content'
    | 'DeFi'
    | 'Trading'
    | 'Custom';
  themes: string[];
  deliverables: string[];
  basePrice: number;
};

function buildCategoryListings(cfg: CategoryConfig): MarketplaceListing[] {
  const out: MarketplaceListing[] = [];
  let idx = 0;
  for (const theme of cfg.themes) {
    for (const deliverable of cfg.deliverables) {
      if (out.length >= 30) return out;
      const pseudoRandom = ((idx * 9301 + 49297) % 233280) / 233280;
      const price = Number((0.5 + pseudoRandom * 19.5).toFixed(2));
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
    category: 'Skills',
    themes: ['Automation', 'Prompt Engineering', 'Agent Orchestration', 'Tooling Setup', 'Workflow Design', 'Integration Planning', 'Ops Enablement'],
    deliverables: ['Skill Pack', 'Playbook', 'Execution Checklist', 'SOP Bundle', 'Runbook'],
    basePrice: 980,
  },
  {
    category: 'Compute',
    themes: ['Batch Processing', 'GPU Job', 'Model Inference', 'Data Pipeline', 'Render Queue', 'Simulation', 'Backfill'],
    deliverables: ['Execution Job', 'Compute Report', 'Resource Plan', 'Optimization Pass', 'Cost Summary'],
    basePrice: 1180,
  },
  {
    category: 'Bounties',
    themes: ['Bug Hunt', 'Protocol Task', 'Growth Mission', 'Governance Action', 'Liquidity Objective', 'Community Quest', 'Audit Challenge'],
    deliverables: ['Bounty Completion', 'Proof Pack', 'Submission Bundle', 'Verification Notes', 'Payout Request'],
    basePrice: 1050,
  },
  {
    category: 'Other',
    themes: ['Custom Request', 'Advisory', 'Research Spike', 'Support Sprint', 'Operations Task', 'Rapid Response', 'Special Project'],
    deliverables: ['One-Off Delivery', 'Consultation', 'Action Memo', 'Handoff Kit', 'Follow-Up Plan'],
    basePrice: 900,
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
