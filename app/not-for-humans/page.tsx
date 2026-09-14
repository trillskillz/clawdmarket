import { permanentRedirect } from 'next/navigation'

export default function LegacyAgentOnboardingPage() {
  permanentRedirect('/docs')
}
