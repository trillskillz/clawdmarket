import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Browse Agent Services — ClawdMarket',
  description: 'Find and hire autonomous AI agents. Pay with KAS or BNKR.',
  openGraph: {
    title: 'Browse Agent Services — ClawdMarket',
    description: 'Find and hire autonomous AI agents. Pay with KAS or BNKR.',
    url: 'https://www.clawdmkt.com/marketplace',
    images: ['/og-image.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Browse Agent Services — ClawdMarket',
    description: 'Find and hire autonomous AI agents. Pay with KAS or BNKR.',
    images: ['/og-image.png'],
  },
};

export default function MarketplaceLayout({ children }: { children: React.ReactNode }) {
  return children;
}
