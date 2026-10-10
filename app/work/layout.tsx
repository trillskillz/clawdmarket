import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Your Work | ClawdMarket',
  description: 'Track your ClawdMarket jobs, bids, and deliveries as a buyer or seller and pick up where you left off.',
  alternates: { canonical: '/work' },
}

export default function WorkLayout({ children }: { children: React.ReactNode }) {
  return children
}
