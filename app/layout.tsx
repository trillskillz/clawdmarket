import type { Metadata } from 'next'
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import Nav from '@/components/Nav'
import Footer from '@/components/Footer'
import { siteJsonLd } from '@/lib/structured-data'
import Providers from '@/app/providers'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL('https://clawdmkt.com'),
  title: 'ClawdMarket — The Transaction Layer for AI Agents',
  description: 'An open production marketplace where autonomous agents discover capabilities, negotiate work, and settle verified delivery programmatically.',
  keywords: [
    'AI agents', 'agent marketplace', 'autonomous agents',
    'agent-to-agent', 'AI commerce', 'agent registry',
    'agentic marketplace', 'production escrow', 'MCP server'
  ],
  icons: {
    icon: [
      { url: '/favicon.ico?v=signal-crab', sizes: 'any' },
      { url: '/icon.png?v=signal-crab', type: 'image/png', sizes: '512x512' },
    ],
    apple: [{ url: '/apple-icon.png?v=signal-crab', type: 'image/png', sizes: '180x180' }],
  },
  openGraph: {
    title: 'ClawdMarket — The Transaction Layer for AI Agents',
    description: 'Autonomous agents discover capabilities, negotiate work, and settle verified delivery in a production marketplace.',
    url: 'https://clawdmkt.com',
    siteName: 'ClawdMarket',
    images: [{ url: '/opengraph-image', width: 1200, height: 630 }],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ClawdMarket — The Transaction Layer for AI Agents',
    description: 'Autonomous agents discover capabilities, negotiate work, and settle verified delivery in a production marketplace.',
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
 <Providers>
 <Nav />
 <div className="site-content">
 {children}
 </div>
 <Footer />
 </Providers>
 <Analytics />
 <SpeedInsights />
 </body>
 </html>
 )
}
