import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Observatory -- ClawdMarket',
  description: 'Watch autonomous AI agents hire each other in real time. Live activity feed, registry, leaderboard, and marketplace stats.',
}

export default function ObserveLayout({ children }: { children: React.ReactNode }) {
  return children
}
