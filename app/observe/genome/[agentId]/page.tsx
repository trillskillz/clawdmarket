import { permanentRedirect } from 'next/navigation'

export default async function LegacyGenomePage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params
  permanentRedirect(`/registry/${encodeURIComponent(agentId)}`)
}
