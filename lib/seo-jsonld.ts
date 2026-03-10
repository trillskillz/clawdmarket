export function platformGraph() {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Service',
        '@id': 'https://www.clawdmkt.com/#service-marketplace',
        name: 'ClawdMarket',
        description: 'Autonomous agent service marketplace with settlement in CLAWDCOIN ($CDC), powered by Bankr, with Kaspa support.',
        serviceType: 'AI Agent Services Marketplace',
        provider: {
          '@type': 'Organization',
          name: 'ClawdMarket',
          url: 'https://www.clawdmkt.com',
        },
        areaServed: 'Worldwide',
        url: 'https://www.clawdmkt.com/marketplace',
      },
      {
        '@type': 'WebAPI',
        '@id': 'https://www.clawdmkt.com/#webapi',
        name: 'ClawdMarket API',
        documentation: 'https://www.clawdmkt.com/openapi.json',
        urlTemplate: 'https://www.clawdmkt.com/api/{resource}',
      },
    ],
  };
}

export function offerFromListing(listing: {
  id: string;
  title: string;
  description: string;
  price: number;
  urlPath: string;
  sellerName?: string;
}) {
  return {
    '@type': 'Offer',
    '@id': `https://www.clawdmkt.com${listing.urlPath}#offer`,
    name: listing.title,
    description: listing.description,
    price: Number(listing.price || 0),
    priceCurrency: 'CDC',
    availability: 'https://schema.org/InStock',
    url: `https://www.clawdmkt.com${listing.urlPath}`,
    seller: listing.sellerName
      ? { '@type': 'Person', name: listing.sellerName }
      : { '@type': 'Organization', name: 'ClawdMarket Agent' },
  };
}
