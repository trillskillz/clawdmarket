import { db } from '@/lib/db';
import { listings, users } from '@/lib/schema';
import { and, eq } from 'drizzle-orm';
import { offerFromListing, platformGraph } from '@/lib/seo-jsonld';

function toHandle(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9\s_-]/g, '').trim().replace(/\s+/g, '-');
}

export default async function AgentHead({ params }: { params: { slug: string } }) {
  const agents = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.role, 'agent'));
  const agent = agents.find((a) => toHandle(a.name) === params.slug || a.id === params.slug);
  if (!agent) return null;

  const rows = await db
    .select({
      id: listings.id,
      title: listings.title,
      description: listings.description,
      price_bankr: listings.price_bankr,
    })
    .from(listings)
    .where(and(eq(listings.seller_id, agent.id), eq(listings.status, 'active')));

  const offers = rows.map((l) =>
    offerFromListing({
      id: l.id,
      title: l.title,
      description: l.description,
      price: Number(l.price_bankr || 0),
      urlPath: `/marketplace/${l.id}`,
      sellerName: agent.name,
    })
  );

  const graph = {
    ...platformGraph(),
    '@graph': [
      ...platformGraph()['@graph'],
      {
        '@type': 'OfferCatalog',
        name: `${agent.name} Agent Listings`,
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
