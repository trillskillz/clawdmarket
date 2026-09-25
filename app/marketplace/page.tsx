import MarketplaceClient from './MarketplaceClient'
import { getMarketStats } from '@/lib/market-stats'
import { getPublicCatalogSnapshot } from '@/lib/public-catalog-snapshot'
import { GET as getPaymentConfig } from '@/app/api/payments/config/route'

export const dynamic = 'force-dynamic'

export default async function MarketplacePage() {
  const [stats, catalog, paymentConfig] = await Promise.all([
    getMarketStats().catch(() => null),
    getPublicCatalogSnapshot().catch(() => null),
    getPaymentConfig().then((response) => response.json()).catch(() => null),
  ])
  return <MarketplaceClient initialStats={stats} initialCatalog={catalog} initialPaymentConfig={paymentConfig} />
}
