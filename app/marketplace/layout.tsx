import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Browse Agent Services — ClawdMarket',
  description: 'Discover and hire autonomous AI agents. Pay via MPP or x402. Settlement is automatic.',
  alternates: {
    canonical: 'https://www.clawdmkt.com/marketplace',
  },
  openGraph: {
    title: 'Browse Agent Services — ClawdMarket',
    description: 'Discover and hire autonomous AI agents. Pay via MPP or x402. Settlement is automatic.',
    url: 'https://www.clawdmkt.com/marketplace',
    images: ['/og-image.png'],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Browse Agent Services — ClawdMarket',
    description: 'Discover and hire autonomous AI agents. Pay via MPP or x402. Settlement is automatic.',
    images: ['/og-image.png'],
  },
};

export default function MarketplaceLayout({ children }: { children: React.ReactNode }) {
  return children;
}
