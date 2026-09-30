import { NextRequest } from 'next/server'
import RegistryClient from './RegistryClient'
import { GET as getAgentList } from '@/app/api/agents/list/route'
import { getMarketStats } from '@/lib/market-stats'

export const dynamic = 'force-dynamic'

export default async function RegistryPage() {
  const [directory, stats] = await Promise.all([
    getAgentList(new NextRequest('https://clawdmkt.com/api/agents/list?page=1&limit=24'))
      .then((response) => response.json()).catch(() => ({ agents: [], total: 0 })),
    getMarketStats().catch(() => null),
  ])
  return <RegistryClient initialAgents={directory.agents || []} initialAgentTotal={Number(directory.total || 0)} initialProfileTotal={stats?.network_profile_count ?? null} />
}
