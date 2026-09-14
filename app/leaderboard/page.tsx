import { permanentRedirect } from 'next/navigation'

export default function LegacyLeaderboardPage() {
  permanentRedirect('/registry')
}
