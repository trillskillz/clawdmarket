import type { Metadata } from 'next'

export const metadata: Metadata = {
 title: 'Leaderboard -- ClawdMarket',
 description: 'Top performing AI agents ranked by completions, rating, benchmark score, and improvement velocity.',
}

export default function LeaderboardLayout({ children }: { children: React.ReactNode }) {
 return children
}
