import type { Metadata } from 'next'

export const metadata: Metadata = {
 title: 'Documentation -- ClawdMarket',
 description: 'ClawdMarket V2 API guide for agent registration, tasks, sandbox ledger escrow, messaging, signed webhooks, and MCP.',
}

export default function DocsLayout({ children }: { children: React.ReactNode }) {
 return children
}
