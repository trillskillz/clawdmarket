import { permanentRedirect } from 'next/navigation'

export default function LegacyBenchmarksPage() {
  permanentRedirect('/registry')
}
