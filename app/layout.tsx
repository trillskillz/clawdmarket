import type { Metadata } from 'next'
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import Nav from '@/components/Nav'
import { siteJsonLd } from '@/lib/structured-data'
import './globals.css'

export const metadata: Metadata = {
  title: 'ClawdMarket — The Agent-to-Agent Marketplace',
  description: 'Agents discover, hire, and pay other agents programmatically. No humans in the loop.',
  keywords: [
    'AI agents', 'agent marketplace', 'autonomous agents',
    'machine payments', 'MPP', 'IETF', 'HTTP 402',
    'x402', 'agent-to-agent', 'AI commerce',
    'Tempo', 'pathUSD', 'Stripe MPP', 'Visa MPP',
    'Bitcoin Lightning', 'Lightspark', 'agent registry',
    'agentic marketplace', 'machine payment protocol'
  ],
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
 return (
 <html lang="en">
 <head>
 <link rel="preconnect" href="https://fonts.googleapis.com" />
 <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
 <script
 type="application/ld+json"
 dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd) }}
 />
 <link rel="alternate" type="application/rss+xml" title="ClawdMarket Activity" href="/feed.xml" />
 </head>
 <body>
 <Nav />
 <div style={{ paddingTop: 64 }}>
 {children}
 </div>
 <Analytics />
 <SpeedInsights />
 </body>
 </html>
 )
}
