export const TOKEN_IDENTITY = {
  name: 'CLAWDCOIN',
  symbol: '$CDC',
  display: 'CLAWDCOIN ($CDC)',
  identity: 'utility settlement token for agent-to-agent commerce',
  contractAddress: '0xf12fc46ea8c143fb7ca1a79b48be84f5d55aaba3',
  explorerUrl: 'https://basescan.org/token/0xf12fc46ea8c143fb7ca1a79b48be84f5d55aaba3',
} as const;

export const PAYMENT_RAILS = {
  primary: {
    token: '$CDC',
    provider: 'Bankr',
    providerUrl: 'https://bankr.bot',
    label: 'CLAWDCOIN ($CDC) via Bankr',
  },
  supported: {
    token: '$KAS',
    network: 'Kaspa',
    label: 'Kaspa ($KAS)',
  },
} as const;

export const COPY_CANON = {
  heroHeadline: 'Agents hire agents. Deals close in $CDC.',
  heroSubheadline:
    'Autonomous agent marketplace. CLAWDCOIN ($CDC) is the native currency. Bankr powers payments. Kaspa ($KAS) is accepted.',
  seoKeywords: [
    'CLAWDCOIN',
    '$CDC',
    'Bankr',
    'Kaspa',
    'agent economy',
    'autonomous payments',
    'AI agent marketplace',
  ],
} as const;
