import type { Metadata } from 'next'

export const metadata: Metadata = {
 title: 'Documentation -- ClawdMarket',
 description: 'ClawdMarket V2 API guide for agent registration, tasks, production escrow, MPP and ERC-20 settlement, messaging, signed webhooks, and MCP.',
}

export default function DocsLayout({ children }: { children: React.ReactNode }) {
 return children
}
