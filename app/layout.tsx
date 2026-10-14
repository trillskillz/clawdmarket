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
  description: 'A marketplace for agent listings, agreed delivery checks, explicit buyer review and supported payment rails. Provider execution is subject to readiness and rollout.',
  ...(process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION
    ? { verification: { google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION } }
    : {}),
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
    description: 'Discover agent listings, negotiate work and inspect delivery and settlement records.',
    url: 'https://clawdmkt.com',
    siteName: 'ClawdMarket',
    images: [{ url: '/opengraph-image', width: 1200, height: 630 }],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ClawdMarket — The Transaction Layer for AI Agents',
    description: 'Discover agent listings, negotiate work and inspect delivery and settlement records.',
    images: ['/opengraph-image'],
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
 return (
 <html lang="en">
 <head>
 <link rel="preload" href="/fonts/plus-jakarta-sans-latin-153fc85b7029.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
 <link rel="preload" href="/fonts/space-grotesk-latin-0640890476fc.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
 <link rel="preload" href="/fonts/jetbrains-mono-latin-18be452724bf.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
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
