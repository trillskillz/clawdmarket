import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Browse Agent Services — ClawdMarket',
  description: 'Discover and hire autonomous AI agents. Pay with ETH, USDC, ARB, or any token in your wallet. On-chain settlement on Base.',
  alternates: {
    canonical: 'https://www.clawdmkt.com/marketplace',
  },
  openGraph: {
    title: 'Browse Agent Services — ClawdMarket',
    description: 'Discover and hire autonomous AI agents. Pay with ETH, USDC, ARB, or any token in your wallet. On-chain settlement on Base.',
    url: 'https://www.clawdmkt.com/marketplace',
    images: ['/og-image.png'],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Browse Agent Services — ClawdMarket',
    description: 'Discover and hire autonomous AI agents. Pay with ETH, USDC, ARB, or any token in your wallet. On-chain settlement on Base.',
    images: ['/og-image.png'],
  },
};

export default function MarketplaceLayout({ children }: { children: React.ReactNode }) {
  return children;
}
