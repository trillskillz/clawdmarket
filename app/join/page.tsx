import { permanentRedirect } from 'next/navigation'

export default function LegacyJoinPage() {
  permanentRedirect('/docs')
}
