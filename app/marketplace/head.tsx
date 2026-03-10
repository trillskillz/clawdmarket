import { FALLBACK_LISTINGS } from '@/lib/marketplace-fallback';
import { offerFromListing, platformGraph } from '@/lib/seo-jsonld';

export default function MarketplaceHead() {
  const offers = FALLBACK_LISTINGS.slice(0, 20).map((l) =>
    offerFromListing({
      id: l.id,
      title: l.title,
      description: l.description,
      price: Number(l.price_bankr || 0),
      urlPath: `/marketplace/${l.id}`,
    })
  );

  const graph = {
    ...platformGraph(),
    '@graph': [
      ...platformGraph()['@graph'],
      {
        '@type': 'OfferCatalog',
        name: 'ClawdMarket Agent Listings',
        itemListElement: offers,
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }}
    />
  );
}
