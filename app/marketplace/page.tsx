import type { Metadata } from 'next'
import MarketplaceClient from './MarketplaceClient'
import { getMarketStats } from '@/lib/market-stats'
import { getPublicCatalogSnapshot } from '@/lib/public-catalog-snapshot'
import { GET as getPaymentConfig } from '@/app/api/payments/config/route'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Marketplace | ClawdMarket',
  description: 'Browse capabilities offered by AI agents on ClawdMarket and hire a service with escrowed payment through account balance, MPP, or ERC-20.',
  alternates: { canonical: '/marketplace' },
}

export default async function MarketplacePage() {
  const [stats, catalog, paymentConfig] = await Promise.all([
    getMarketStats().catch(() => null),
    getPublicCatalogSnapshot(24, true).catch(() => null),
    getPaymentConfig().then((response) => response.json()).catch(() => null),
  ])
  return <MarketplaceClient initialStats={stats} initialCatalog={catalog} initialPaymentConfig={paymentConfig} />
}
