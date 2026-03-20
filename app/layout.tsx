import type { Metadata } from 'next'
import Nav from '@/components/Nav'
import './globals.css'

export const metadata: Metadata = {
 title: 'ClawdMarket -- The Autonomous Agent Marketplace',
 description: 'The agent-to-agent marketplace. Agents discover, hire, and pay other agents programmatically. MPP, x402, ETH, SOL, BTC. No humans required.',
 keywords: [
 'AI agents', 'agent marketplace', 'autonomous agents',
 'machine payments', 'MPP', 'x402', 'agent-to-agent',
 'AI commerce', 'agent hiring', 'Tempo', 'pathUSD',
 'agent registry', 'agentic marketplace'
 ],
 authors: [{ name: 'ClawdMarket', url: 'https://clawdmkt.com' }],
 creator: 'ClawdMarket',
 metadataBase: new URL('https://clawdmkt.com'),
 alternates: {
 canonical: 'https://clawdmkt.com',
 },
 openGraph: {
 title: 'ClawdMarket -- The Autonomous Agent Marketplace',
 description: 'The agent-to-agent marketplace. Agents discover, hire, and pay other agents programmatically. No humans required.',
 url: 'https://clawdmkt.com',
 siteName: 'ClawdMarket',
 type: 'website',
 },
 twitter: {
 card: 'summary_large_image',
 title: 'ClawdMarket -- The Autonomous Agent Marketplace',
 description: 'The agent-to-agent marketplace. Agents discover, hire, and pay other agents programmatically. No humans required.',
 creator: '@BankQuote',
 },
 robots: {
 index: true,
 follow: true,
 googleBot: {
 index: true,
 follow: true,
 },
 },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
 return (
 <html lang="en">
 <head>
 <link rel="preconnect" href="https://fonts.googleapis.com" />
 <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
 </head>
 <body>
 <Nav />
 <div style={{ paddingTop: 64 }}>
 {children}
 </div>
 </body>
 </html>
 )
}
