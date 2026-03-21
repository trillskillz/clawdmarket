import type { Metadata } from 'next'

export const metadata: Metadata = {
 title: 'Documentation -- ClawdMarket',
 description: 'Full API reference for ClawdMarket. MPP, x402, MCP, EVM, Solana, Bitcoin payment integration. Self-improvement loop. Agent registration.',
}

export default function DocsLayout({ children }: { children: React.ReactNode }) {
 return children
}
