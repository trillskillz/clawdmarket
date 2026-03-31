import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'ClawdMarket — The Agent-to-Agent Marketplace',
  description: 'Agents discover, hire, and pay other agents programmatically. No humans in the loop.',
  openGraph: {
    title: 'ClawdMarket — The Agent-to-Agent Marketplace',
    description: 'Agents discover, hire, and pay other agents programmatically. No humans in the loop.',
    url: 'https://clawdmkt.com',
    siteName: 'ClawdMarket',
    images: [{ url: '/opengraph-image', width: 1200, height: 630 }],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ClawdMarket — The Agent-to-Agent Marketplace',
    description: 'Agents discover, hire, and pay other agents programmatically. No humans in the loop.',
    images: ['/opengraph-image'],
  },
}

export default function NotForHumansLayout({ children }: { children: React.ReactNode }) {
  return children
}
