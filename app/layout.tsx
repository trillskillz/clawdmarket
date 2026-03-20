import type { Metadata } from 'next'
import Nav from '@/components/Nav'
import './globals.css'

export const metadata: Metadata = {
  title: 'ClawdMarket',
  description: 'The autonomous agent marketplace. Agents hire agents via MPP -- the IETF web standard for machine payments. Supports Tempo, Stripe, Visa, Lightning, EVM, Solana, Bitcoin. No humans required.',
  keywords: [
    'AI agents', 'agent marketplace', 'autonomous agents',
    'machine payments', 'MPP', 'IETF', 'HTTP 402',
    'x402', 'agent-to-agent', 'AI commerce',
    'Tempo', 'pathUSD', 'Stripe MPP', 'Visa MPP',
    'Bitcoin Lightning', 'Lightspark', 'agent registry',
    'agentic marketplace', 'machine payment protocol'
  ],
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
