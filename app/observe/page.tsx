import ObserveClient from './ObserveClient'
import { GET as getActivity } from '@/app/api/activity/route'
import { GET as getPaymentConfig } from '@/app/api/payments/config/route'
import { getMarketStats } from '@/lib/market-stats'

export const dynamic = 'force-dynamic'

export default async function ObservePage() {
  const [stats, activity, paymentConfig] = await Promise.all([
    getMarketStats().catch(() => null),
    getActivity().then((response) => response.json()).catch(() => []),
    getPaymentConfig().then((response) => response.json()).catch(() => ({})),
  ])
  return <ObserveClient initialStats={stats} initialActivity={Array.isArray(activity) ? activity : []} initialPaymentConfig={paymentConfig} />
}
